# 법령 변경 추적 폴러 — systemd 설치

korean-law-mcp(law.go.kr Open API 래퍼)에서 법령 전문을 자동 수집해, 기존 변경탐지 엔진(`runSourceCheck`)으로 변경을 감지·버전화하는 폴러를 EC2에 스케줄 등록한다. (Vercel 배포가 아니라 EC2 + nginx 환경이므로 systemd timer가 정석. OCR 서비스(`finproof-ocr`)와 동일 패턴.)

## 신규 환경변수 (.env / 배포 env)

| 변수 | 필수 | 설명 |
|---|---|---|
| `LAW_API_OC` | ✅ | law.go.kr Open API OC 키. open.law.go.kr 무료 발급, **호출 서버 IP 등록 필요**. 시드 스크립트(`seed-knowledge-law-api.ts`)와 동일 변수명. (`LAW_OC`도 폴백 지원) |
| `KOREAN_LAW_MCP_URL` | ⬜ | korean-law-mcp 엔드포인트. **미설정 시 `https://korean-law-mcp.fly.dev/mcp`로 자동 폴백.** 프로덕션은 self-host 권장(예: `http://127.0.0.1:7000/mcp`). |
| `KOREAN_LAW_MCP_TIMEOUT_MS` | ⬜ | MCP 호출 타임아웃. 기본 60000. |
| `FINPROOF_REGULATORY_POLL_INTERVAL_MS` | ⬜ | `--loop` 모드 폴링 간격. 기본 86400000(24h). systemd timer(oneshot)를 쓰면 불필요. |
| `FINPROOF_DEFAULT_TENANT_ID` | ⬜ | 폴러 실행 컨텍스트 테넌트. 기본 `tenant-demo`. |
| `FINPROOF_DEFAULT_REVIEWER_USER_ID` | ⬜ | 폴러 실행 컨텍스트 사용자. 기본 `user-reviewer-demo`. |

폴러는 DB(리뷰 스토어)와 스토리지 어댑터에 접근하므로, 앱 런타임과 동일한 DB/스토리지 env(`DATABASE_URL`, S3 키 등)가 `.env`에 있어야 한다.

## 수동 실행 (검증용)

```bash
cd /home/ec2-user/FinProof_Agent
npm run ops:regulatory:poll          # 1회 실행
npm run ops:regulatory:poll:loop     # 데몬 루프(24h 간격), SIGTERM/SIGINT로 graceful 종료
```

정상 출력 예: `[regulatory-poll] {"checked":1,"changed":0,"skipped":0,"failed":0}`
변경 감지 시: `[regulatory-poll] CHANGE detected: 금융소비자보호법 (1 change-set)`

## /etc/systemd/system/finproof-regulatory-poll.service

```ini
[Unit]
Description=FinProof regulatory source poller (korean-law-mcp)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/home/ec2-user/FinProof_Agent
EnvironmentFile=/home/ec2-user/FinProof_Agent/.env
ExecStart=/usr/bin/npm run ops:regulatory:poll
# npm/node가 PATH에 없으면 절대경로 사용:
# ExecStart=/home/ec2-user/.nvm/versions/node/<version>/bin/npm run ops:regulatory:poll
```

> 경로(`/home/ec2-user/FinProof_Agent`)와 node/npm 경로는 실제 배포 환경에 맞게 수정한다.

## /etc/systemd/system/finproof-regulatory-poll.timer

```ini
[Unit]
Description=Run FinProof regulatory poller daily at 09:00 KST

[Timer]
OnCalendar=*-*-* 09:00:00 Asia/Seoul
Persistent=true

[Install]
WantedBy=timers.target
```

`Persistent=true`는 인스턴스가 09:00에 꺼져 있었으면 부팅 직후 1회 보충 실행한다.

## 설치

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now finproof-regulatory-poll.timer
systemctl list-timers | grep regulatory          # 다음 실행 시각 확인
sudo systemctl start finproof-regulatory-poll.service   # 즉시 1회 수동 실행
journalctl -u finproof-regulatory-poll.service -n 80 --no-pager   # 로그 확인
```

## RegulatorySource 등록 규칙 (폴링 대상이 되려면)

폴러는 `RegulatorySource` 행 중 **`status === "active"`** 이고 **`url` 필드에 법령 식별자**가 있는 것만 처리한다.

- `url` 형식: `lawId=<법령ID>` 또는 `mst=<MST>` 또는 식별자만 입력(=lawId로 간주).
  - 법령ID/MST는 korean-law-mcp의 `search_law` 또는 law.go.kr에서 조회.
- 일시 중지는 `status`를 `paused`로 변경.
- **첫 폴링은 baseline**(스냅샷만 생성, diff 없음). **두 번째 폴링부터** 직전 텍스트와 비교해 변경을 감지한다.
- 변경 감지 시: 품질 게이트 통과분은 `KnowledgeDocument`로 자동 버전 생성되고(`autoIngested: true`), `regulatory_change` audit 이벤트가 기록된다.

## 트러블슈팅

- `{"failed":N}` 이고 audit에 `poll_failed` — MCP 호출 실패(네트워크/OC 키/IP 미등록) 또는 해시 불일치. `journalctl`과 audit 로그의 `error` 메시지 확인.
- `{"skipped":N}` 이고 `poll_skipped` reason `missing_law_identifier` — `url`에 식별자 미입력. `empty_law_text` — MCP가 빈 본문 반환(식별자 오류 가능).
- 두 번째 폴링부터 계속 `poll_failed`(해시 불일치)면, 직전 저장 텍스트(`regulatory/source-text/<tenant>/<sourceId>.txt`)와 스냅샷 해시가 어긋난 것 — 해당 소스의 스토리지 텍스트를 삭제해 baseline부터 재시작.

## 관련

- 구현 계획: `docs/superpowers/plans/2026-07-01-korean-law-mcp-regulation-tracking.md`
- 폴러: `src/server/regulatory/regulatory-source-poller.ts`
- MCP 클라이언트: `src/server/regulatory/korean-law-mcp-client.ts`
- CLI: `scripts/poll-regulatory-sources.ts`
- Phase 2(미구현): 조문 diff·개정사유(`time_travel`/`amendment_track`) 의미강화, 영향 케이스 자동 재분석, 슬랙/메일 알림, 관리자 승인 UI.

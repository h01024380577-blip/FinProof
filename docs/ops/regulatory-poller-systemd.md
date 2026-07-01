# 법령 변경 추적 폴러 — systemd 설치

korean-law-mcp(law.go.kr Open API 래퍼)에서 법령 전문을 자동 수집해, 기존 변경탐지 엔진(`runSourceCheck`)으로 변경을 감지·버전화하는 폴러를 EC2에 스케줄 등록한다. (Vercel 배포가 아니라 EC2 + nginx 환경이므로 systemd timer가 정석. OCR 서비스(`finproof-ocr`)와 동일 패턴.)

**추적 대상**: 폴러는 **이미 지식베이스에 등록된 법령 지식문서**(`documentType: "law"`, 승인·최신본)만 감시한다. 별도 감시목록을 손으로 등록할 필요가 없다 — 지식문서로 등록해 둔 법령이 곧 추적 대상이다. 각 문서의 law.go.kr 식별자는 이름으로 `search_law` 자동 해석 후 캐시된다.

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

## 추적 대상 규칙 (어떤 문서가 폴링되나)

폴러는 **지식문서(`KnowledgeDocument`)** 중 아래를 모두 만족하는 것만 대상으로 삼는다:
- `documentType === "law"`
- `approvalStatus === "approved"`
- `lifecycleStatus !== "superseded"` (최신본)
- `autoIngested !== true` (자동 생성된 버전 자기 자신은 제외)

동작:
- 대상 문서는 `stableRegulatorySourceId`로 그룹화되어 `RegulatorySource` 행이 자동 생성된다(수동 등록 불필요).
- 법령 식별자(lawId/MST)는 **문서 title로 `search_law` 자동 해석 → storage에 캐시**된다. 최초 해석은 `regulatory_source.law_id_resolved` audit에 남아 검증 가능(어떤 title이 어떤 ID로 매칭됐는지).
- **첫 폴링은 baseline**(현행 관보 텍스트로 스냅샷만 생성, diff 없음). **두 번째 폴링부터** 직전 텍스트와 비교해 변경을 감지한다.
- 변경 감지 시: 품질 게이트 통과분은 `KnowledgeDocument`로 자동 버전 생성되고(`autoIngested: true`), `regulatory_change` audit 이벤트가 기록된다.
- 특정 법령을 추적하려면 **그 법령을 승인된 law-type 지식문서로 등록**하면 된다(예: `npm run db:seed:knowledge:law`).

## 트러블슈팅

- `{"failed":N}` 이고 audit에 `poll_failed` — MCP 호출 실패(네트워크/OC 키/IP 미등록) 또는 해시 불일치. `journalctl`과 audit 로그의 `error` 메시지 확인.
- `{"skipped":N}` 이고 `poll_skipped`:
  - `law_id_unresolved` — `search_law`/`search_admin_rule`가 title로 법령/행정규칙을 못 찾음(등록 title을 정식 명칭에 맞춰 조정).
  - `ambiguous_match` — 검색 1위가 문서 title과 정식명이 다름(예: 은행업감독규정↔상호저축은행업감독규정). **안전을 위해 추적하지 않음**; audit의 `matchedTitle`을 보고 정식명으로 title을 맞추거나 수동 매핑.
  - `empty_law_text` — MCP가 빈 본문 반환(식별자 오류 가능).

## 법령 vs 행정규칙 · 알려진 제약

- 문서 title에 `규정/고시/훈령/예규/지침/세칙`이 포함되면 **행정규칙**으로 보고 `search_admin_rule`/`get_admin_rule` 경로로 조회한다(감독규정·시행세칙·심의규정·심사지침 등). 그 외는 법령으로 `search_law`/`get_law_text`.
- **정확명 일치 가드**: 검색 결과 title이 정규화(괄호그룹·공백·가운뎃점 제거) 후 문서 title과 정확히 일치할 때만 추적한다. 유사명 오매칭으로 엉뚱한 법을 baseline 잡는 것을 방지.
- `get_admin_rule` 응답은 **약 50KB(50,030자) 상한**으로 보인다 — 초대형 행정규칙은 그 이후 개정이 감지 범위 밖일 수 있다(대부분 조문 개정은 범위 내).
- 공개 `korean-law-mcp.fly.dev`는 **rate-limit**이 있다 — 다수 법령 일괄 폴링/재조회 시 self-host(`KOREAN_LAW_MCP_URL`) 권장.

## 배포 전 검증 (프로덕션 무변형 드라이런)

DB/스토리지 쓰기를 스텁하고 실제 MCP 조회만 수행해, 등록 법령별로 무엇이 baseline으로 잡힐지 미리 본다:

```bash
npx tsx scripts/verify-mcp-fetch.ts "금융소비자 보호에 관한 법률"   # 단건 페치 연결 확인
npx tsx scripts/verify-regulatory-poll.ts                          # 전체 dry-run(쓰기 없음)
```
- 두 번째 폴링부터 계속 `poll_failed`면 직전 저장 텍스트와 최신 스냅샷 해시가 어긋난 것(예: EC2 리부트로 `/tmp` 초기화돼 텍스트 파일은 사라졌는데 DB 스냅샷은 남은 경우, 또는 스냅샷 생성 후 텍스트 저장 전에 중단된 경우). 에러 메시지는 `previousNormalizedText is required...`(파일 없음) 또는 `does not match the latest snapshot`(내용 불일치)로 나뉜다.
  - **복구: 스토리지 텍스트가 아니라 해당 소스의 최신 `RegulatorySnapshot` DB 레코드를 삭제**한다. 그러면 다음 폴링에서 `getLatestRegulatorySnapshot`이 null을 반환해 `baselineOnly`로 새 스냅샷+텍스트 파일을 다시 만들고 정상화된다. (스토리지 텍스트 파일만 지우면 DB 스냅샷이 남아 `previousNormalizedText is required` 로 계속 실패하므로 금물.)

## 관련

- 구현 계획: `docs/superpowers/plans/2026-07-01-korean-law-mcp-regulation-tracking.md`
- 폴러: `src/server/regulatory/regulatory-source-poller.ts`
- MCP 클라이언트: `src/server/regulatory/korean-law-mcp-client.ts`
- CLI: `scripts/poll-regulatory-sources.ts`
- Phase 2(미구현): 조문 diff·개정사유(`time_travel`/`amendment_track`) 의미강화, 영향 케이스 자동 재분석, 슬랙/메일 알림, 관리자 승인 UI.

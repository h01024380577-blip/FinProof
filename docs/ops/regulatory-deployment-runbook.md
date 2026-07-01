# 법령 변경 추적 — 실제 운영 개시 런북 (EC2)

이 문서는 코드가 준비된 상태에서 **프로덕션 폴러를 켜기 위한 순서**다. 모든 명령은 **EC2 프로덕션 서버(finproof-seoul, 52.78.86.72)** 에서 실행한다. 로컬에서 폴을 돌리면 안 된다(DB와 텍스트 캐시가 분리됨).

관련: 설치 세부는 `docs/ops/regulatory-poller-systemd.md`, 동작 원리는 `docs/superpowers/plans/2026-07-01-korean-law-mcp-regulation-tracking.md`.

---

## A3. law.go.kr OC 키 IP 등록 (사람이 직접, 1회)

OC 키는 **호출 서버 IP에 바인딩**된다. EC2에서 나가는 공인 IP를 등록해야 MCP가 law.go.kr를 호출할 수 있다.

1. EC2의 공인 IP 확인: `curl -s https://checkip.amazonaws.com` (보통 52.78.86.72)
2. https://open.law.go.kr → 마이페이지 → OPEN API 신청/관리 → 해당 OC 키의 **허용 IP에 위 IP 추가**.
   - self-host MCP면 EC2 IP, 공개 fly.dev를 쓰면 fly.dev의 egress IP가 잡혀 **실패할 수 있음** → self-host 권장(A4).

## A4. korean-law-mcp self-host (권장)

공개 `fly.dev`는 rate-limit + 제3자 의존 + IP 문제가 있다. EC2에서 직접 구동한다.

```bash
# Node 18+ 필요
npm i -g korean-law-mcp        # 또는 npx로 매번 실행
# HTTP 서버 모드로 구동 (포트는 예시)
LAW_OC=<OC_KEY> korean-law-mcp --http --port 7000 &
# 헬스체크
curl -s -X POST "http://127.0.0.1:7000/mcp" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -c 200
```
> self-host가 어려우면 임시로 fly.dev(`KOREAN_LAW_MCP_URL` 미설정 시 자동 폴백)를 쓰되, A3의 IP 바인딩 문제로 실패 가능. 운영은 self-host 확정.

## A1. 스토리지 내구성 (필수 — 안 하면 재부팅 후 폴 전건 실패)

폴러는 baseline 원문을 저장해 다음 폴에서 비교한다. **`/tmp`는 재부팅 시 삭제**되므로 반드시 내구성 스토리지를 쓴다. 택1:

- **S3 (권장)**: `.env`에
  ```
  FINPROOF_STORAGE_ADAPTER=s3
  FINPROOF_S3_BUCKET=finproof-s3-seoul
  AWS_REGION=ap-northeast-2
  ```
- **로컬 영속 경로**: `FINPROOF_LOCAL_UPLOAD_DIR=/home/ec2-user/finproof-data` (mkdir 해둘 것)

CLI는 실행 시 휘발성 경로면 경고한다. **강제 차단**하려면(오설정 방지):
```
FINPROOF_REGULATORY_REQUIRE_DURABLE_STORAGE=1
```
을 `.env`/systemd EnvironmentFile에 넣으면, `/tmp` 구성일 때 폴러가 즉시 종료한다.

## 신규 .env 항목 총정리 (EC2)

```
# --- 법령 변경 추적 폴러 ---
KOREAN_LAW_MCP_URL=http://127.0.0.1:7000/mcp
LAW_API_OC=<OC_KEY>                              # A3에서 IP 등록된 키
FINPROOF_REGULATORY_REQUIRE_DURABLE_STORAGE=1    # 휘발성 스토리지면 폴 중단
# 스토리지(A1) — S3 또는 영속 로컬 중 하나
FINPROOF_STORAGE_ADAPTER=s3
FINPROOF_S3_BUCKET=finproof-s3-seoul
AWS_REGION=ap-northeast-2
# 실행 컨텍스트(이미 있으면 생략)
FINPROOF_DEFAULT_TENANT_ID=...
FINPROOF_DEFAULT_REVIEWER_USER_ID=...
```

## A2. 첫 baseline 폴 (EC2에서 수동 1회)

```bash
cd /home/ec2-user/FinProof_Agent
npm run ops:regulatory:poll
```
기대 출력: `[regulatory-poll] {"checked":N,"changed":0,"skipped":M,"failed":0}`
- `failed:0` 이어야 정상. `failed>0`면 audit(`poll_failed`)의 error 확인(대개 OC IP 미등록/네트워크).
- 스토리지 경고가 뜨면 A1 미완료 — 고치고 재실행.
- baseline이라 `changed:0`이 정상.

검증(선택, 읽기전용): `npx tsx scripts/verify-regulatory-poll.ts` 로 무엇이 잡히는지 미리보기.

## A5. systemd 타이머 설치 (매일 자동)

`docs/ops/regulatory-poller-systemd.md`의 service/timer 유닛 사용. 핵심:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now finproof-regulatory-poll.timer
systemctl list-timers | grep regulatory        # 다음 실행 확인
sudo systemctl start finproof-regulatory-poll.service   # 즉시 1회
journalctl -u finproof-regulatory-poll.service -n 80 --no-pager
```
> service 유닛의 `EnvironmentFile` 이 위 .env를 가리키는지 확인.

---

## 개시 후 확인

- 앱의 **알림 벨**에 심의자/관리자로 로그인 시, 변경 감지분이 "법령 변경이 감지되었습니다"로 표시됨.
- 규제 대시보드의 **"변경 추적" 버튼**은 이제 즉석 폴을 백그라운드로 실행(결과는 알림/재조회로 확인).
- 매일 09:00 KST 자동 폴 → 법령이 바뀌면 changeset 생성 + 지식문서 자동 버전 + 알림.

## 롤백

문제가 생기면 폴러가 만든 소스/스냅샷만 안전 삭제(지식문서·기존 소스 불변):
```bash
npx tsx scripts/cleanup-mcp-regulatory.ts            # 미리보기
npx tsx scripts/cleanup-mcp-regulatory.ts --execute  # 삭제
sudo systemctl disable --now finproof-regulatory-poll.timer
```

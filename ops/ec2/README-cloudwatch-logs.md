# CloudWatch Logs — finproof-agent (경량, 로그만)

`finproof-agent`(Next.js)와 `finproof-agent-analysis-worker`의 stdout/stderr를
CloudWatch Logs로 보내 한 콘솔에서 추적한다. AI 분석 진행 중 워커가 찍는
per-iteration JSON, `[Worker]`/`[GeminiOCR]` 등 태그 로그가 여기로 모인다.

동작 방식: systemd 드롭인이 각 유닛의 stdout/stderr를 `/var/log/finproof/*.log`로
떨어뜨리고, CloudWatch Agent가 그 파일을 tail 해 로그 그룹으로 push한다.
(CloudWatch Agent는 journald를 직접 못 읽어서 파일 경유가 표준 경로다.)

## 로그 그룹
- `/finproof/app` — Next.js 런타임
- `/finproof/analysis-worker` — 분석 워커
- 스트림 이름 = `{instance_id}`, 보관 30일 (config에서 조정)

## 1회 사전작업 — IAM (AWS 콘솔, 스크립트가 안 함)
EC2 인스턴스(52.78.86.72)의 IAM 인스턴스 프로파일 롤에
관리형 정책 **`CloudWatchAgentServerPolicy`** 를 부착한다.
- 인스턴스 프로파일이 없으면: 롤 생성 → 위 정책 부착 → EC2 콘솔에서
  Actions ▸ Security ▸ Modify IAM role 로 인스턴스에 연결.
- 없으면 agent는 뜨지만 push 시 AccessDenied 로 실패한다.

## 설치 (EC2 호스트에서)
```bash
ssh finproof-seoul
cd /opt/finproof-agent/current
sudo REPO_DIR=$(pwd) ./ops/ec2/setup-cloudwatch-logs.sh
```
스크립트: 에이전트 설치 → `/var/log/finproof` 생성 → 드롭인 설치 →
CloudWatch config 적용·시작 → 두 서비스 재시작. 멱등(재실행 안전).

배포 파이프라인이 `/opt/finproof-agent/current`를 교체하므로, 드롭인·config는
릴리스와 무관하게 `/etc/systemd/...`, `/opt/aws/...`에 남아 유지된다.
릴리스 후 재적용이 필요하면 스크립트만 다시 돌리면 된다.

## 검증
```bash
amazon-cloudwatch-agent-ctl -a status
tail -f /var/log/finproof/analysis-worker.log
aws logs tail /finproof/analysis-worker --follow --region ap-northeast-2
```
콘솔: CloudWatch ▸ Logs ▸ Log groups ▸ `/finproof/analysis-worker`.
Logs Insights 예시(최근 처리된 잡):
```
fields @timestamp, @message
| filter @message like /reviewCaseId/
| sort @timestamp desc
| limit 50
```

## 롤백
```bash
sudo rm /etc/systemd/system/finproof-agent.service.d/logging.conf
sudo rm /etc/systemd/system/finproof-agent-analysis-worker.service.d/logging.conf
sudo systemctl daemon-reload
sudo systemctl restart finproof-agent finproof-agent-analysis-worker
sudo systemctl stop amazon-cloudwatch-agent
```
드롭인 제거 시 stdout이 다시 journald로 돌아가 `journalctl -u ...`로 조회된다.

## 한계 (경량 범위)
- 단계별 메트릭/그래프·알람 없음 (로그 검색만). `analysis_jobs.currentStep`,
  `agent_runs` 등 DB에만 있는 단계 정보는 로그에 안 찍혀 여기 안 보인다.
- 필요해지면 다음 단계: 파이프라인에 EMF 구조화 로깅 추가 → 단계별 지연·
  실패 메트릭·대시보드·알람.

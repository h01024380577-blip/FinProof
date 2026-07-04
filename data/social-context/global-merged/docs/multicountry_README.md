# FinProof Multi-Country Social Context KG Seed Data

생성일: 2026-07-02

이 패키지는 FinProof의 `Social Context Risk Agent`에서 사용할 수 있는
캄보디아, 베트남, 미얀마, 중국, 태국 대상 사회적 맥락 리스크 탐지용
온톨로지 기반 Knowledge Graph seed data입니다.

## 포함 국가

- Cambodia / 캄보디아 / `km`
- Vietnam / 베트남 / `vi`
- Myanmar / 미얀마 / `my`
- China / 중국 / `zh-CN`, `zh-TW`
- Thailand / 태국 / `th`

## 목적

금융 홍보물에서 다음 조합을 사전 탐지합니다.

- 민감 사건·날짜 + 참사·전쟁·정치 은유 + 금융 홍보 표현
- 왕실·종교·국가상징 + 상업 프로모션
- 지도·국기·국가명 표기 오류
- 정치 시위 상징 + 금융 혜택 이벤트
- 민족·난민·분쟁 피해자 표현 + 금융 고정관념

## 디렉터리 구조

```text
combined/
  countries.json
  sensitive-events.json
  sensitive-event-terms.json
  sensitive-symbols-visual.json
  financial-promo-terms.json
  campaign-intents.json
  social-kg-edges.json
  social-risk-rules.json
  safe-contexts.json
  prior-controversy-cases.json
  social-context-test-cases.json
  kg-nodes.csv
  kg-edges.csv
  risk-rules.csv
  test-cases.csv
  sources.json

by-country/
  cambodia/
  vietnam/
  myanmar/
  china/
  thailand/
```

## FinProof 통합 방식

1. OCR/텍스트 추출 결과에서 날짜, 문구, 국가명, 지역명, 상징어, 금융 홍보 표현을 추출합니다.
2. `sensitive-events`, `sensitive-event-terms`, `sensitive-symbols-visual`과 매칭합니다.
3. `social-kg-edges`를 따라 민감 사건·상징·피해자 집단·날짜 관계를 탐색합니다.
4. `social-risk-rules`를 적용해 `riskLevel`과 `suggestedAction`을 산출합니다.
5. 결과를 `AgentFinding`으로 변환해 기존 FinProof `ReviewIssue` 생성 흐름에 연결합니다.

## 운영 원칙

- `high`는 자동 반려가 아니라 `hold`로 올려 사람 검토를 요청합니다.
- 로컬 문화·법무·브랜드 담당자의 승인 워크플로우가 필요합니다.
- 이 데이터는 MVP seed이며, 실제 서비스 전에는 현지 전문가 검수가 필요합니다.
- 안전 맥락(`safe-contexts`)을 반드시 함께 적용해 오탐을 줄여야 합니다.

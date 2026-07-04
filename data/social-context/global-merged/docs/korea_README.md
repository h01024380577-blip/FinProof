# FinProof 한국 금융 홍보물 사회적 맥락 리스크 KG Seed Data

이 데이터셋은 FinProof에 `Social Context Risk Agent`를 추가하기 위한 MVP seed data입니다.

## 포함 파일

- `kg-metadata.json`: 데이터셋 설명 및 사용 원칙
- `kg-schema.json`: 엔티티·관계·규칙 출력 스키마
- `sensitive-events.json`: 세월호, 이태원, 5·18, 제주4·3 등 민감 사건
- `sensitive-event-terms.json`: 침몰, 압사, 진압, 탱크, 욱일기 등 사건 연상 표현
- `financial-promo-terms.json`: 금리, 대출, 수익률, 캐시백 등 금융 홍보 표현
- `campaign-intents.json`: 프로모션, 금융상품 광고, 추모, 교육 등 목적 분류
- `derogatory-social-slang.json`: 지역·고인·세대·젠더·장애·국적 비하 은어 탐지용 seed
- `sensitive-symbols-visual.json`: 이미지·상징 리스크 후보
- `social-kg-edges.json`: 사건·날짜·상징·집단 간 KG 관계
- `social-risk-rules.json`: 고위험 조합 규칙
- `safe-contexts.json`: 오탐 방지용 안전 문맥
- `prior-controversy-cases.json`: 과거 논란 유형 seed
- `social-context-test-cases.json`: 금융 홍보물형 테스트 케이스 40개
- `social-context-guidelines.md`: 내부 심의 가이드 초안

## 핵심 탐지 철학

단어 단독 차단이 아니라 아래 조합을 본다.

```text
민감 사건/날짜/상징 + 금융 홍보 표현 + 상업 프로모션 = 사회적 맥락 리스크
```

예시:

```text
4월 16일 + 침몰 + 금리 + 혜택 -> high / hold
5월 18일 + Tank + 카드 혜택 -> high / hold
홍어 + 금리 + 혜택 -> high / hold, 단 음식 제휴 맥락은 safe context
```

## FinProof 통합 위치

권장 pipeline:

```text
OCR 추출 -> Social Feature Extractor -> Social Context KG Matching -> Rule Engine -> AgentFinding -> 기존 issue-generation
```

## 주의

- 이 데이터는 내부 검수와 위험 탐지를 위한 것이다.
- 비하 표현 생성이나 광고 문구 생성에 사용하지 않는다.
- high 결과는 자동 반려가 아니라 `hold` 및 Human-in-the-loop 검토 신호이다.

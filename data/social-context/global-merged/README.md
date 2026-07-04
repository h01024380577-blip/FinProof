# FinProof Global Social Context KG Seed Data - Merged

본 ZIP은 기존 `finproof_multicountry_social_context_kg_seed_data.zip`에 `FinProof용 한국 정서 기반 금융 홍보물 사회적 맥락 리스크 KG Seed Data`를 병합한 정리본입니다.

## 포함 국가

- 대한민국 / South Korea
- 캄보디아 / Cambodia
- 베트남 / Vietnam
- 미얀마 / Myanmar
- 중국 / China
- 태국 / Thailand

## 주요 구성

| 경로 | 설명 |
|---|---|
| `combined/` | 런타임에서 바로 사용할 통합 JSON/CSV 데이터 |
| `by-country/` | 국가별 분리 데이터 |
| `by-country/south-korea/` | 한국 정서 기반 금융 홍보물 사회적 맥락 리스크 데이터 |
| `legacy-korea-original/` | 이전 한국 seed 원본 보존본 |
| `docs/` | 원본 README/가이드 문서 보존 |

## 병합 데이터 규모

| 항목 | 개수 |
|---|---:|
| 국가 | 6 |
| 민감 사건 | 37 |
| 민감 표현/은어 | 97 |
| 시각 상징 | 51 |
| 금융 홍보 표현 | 20 |
| KG 관계 | 546 |
| 위험 규칙 | 20 |
| Safe context | 22 |
| 과거 논란 seed | 10 |
| 테스트 케이스 | 65 |

## 운영 원칙

- 단일 키워드만으로 고위험 판단을 만들지 않고, 날짜·상징·금융 홍보 표현·상업성·safe context 조합으로 판단합니다.
- `high`/`caution`은 자동 반려가 아니라 `hold` 및 준법/PR/브랜드 담당자 검토로 연결해야 합니다.
- 이 데이터는 내부 검수 및 시연용 seed data이며, 공개 금지어 사전으로 사용하면 안 됩니다.

## FinProof 통합 권장 경로

```text
data/social-context/global-merged/
  combined/*.json
  by-country/*/*.json
```

런타임에서는 우선 `combined/*.json`을 사용하고, 관리/검수 UI에서는 `by-country/`를 참조하는 구조를 권장합니다.

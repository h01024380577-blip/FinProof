# 다국어 준법심의 강화 설계 — NLI 의미 보존 + MQM 오류 taxonomy

작성일: 2026-07-02
근거 문서: `FinProof_Multilingual_Compliance_Extension_Report.pdf` (지정주제 2 Compliance AI)
범위: 보고서 확장 모듈 **1번(Cross-lingual NLI/STS 의미 보존 검증)**, **2번(MQM 기반 준법 오류 taxonomy)** 만 반영. 3·4·5번(RAG+CoVe, OCR layout, BCP-47 locale)은 범위 외.

## 1. 목표

다국어 광고 finding에 두 가지 구조를 추가한다.

1. **의미 보존 검증(1번):** 외국어 홍보문구가 한국어 기준 claim 대비 준법 의미를 유지하는지를 `mDeBERTa-v3-base-mnli-xnli` NLI 모델로 판정한다. entailment/contradiction 확률에서 `semanticRelation`, `semanticShiftScore`, `missingConditionTerms`, `overclaimTerms`를 파생한다.
2. **MQM 오류 taxonomy(2번):** 현재 자유 텍스트에 가까운 `riskSignals`를 MQM error typology(6종) + severity + targetSpan + evidenceType + recommendedAction 구조로 표준화한다.

두 기능 모두 기존 파이프라인을 **대체하지 않고** finding 생성 이후/주변에 검증 레이어로 부착한다.

## 2. 확정된 설계 결정

| 결정 | 선택 | 근거 |
|------|------|------|
| NLI 서빙 | EC2에 전용 Python(FastAPI + transformers) 마이크로서비스, systemd, HTTP 호출 | 기존 `finproof-ocr :8000` 패턴과 동일. 인프라 일관성·모델 완전 제어. mDeBERTa-base는 CPU 동작. |
| NLI 기준 문장(premise) | ReviewCase `productDescription` + `disclosure` (한국어) | 실제 승인된 상품 조건이 기준이 되어 overclaim/missing-condition 탐지에 정확. cross-lingual 모델이라 번역 불필요. |
| semanticShiftScore | NLI 확률에서 파생(별도 STS 모델 없음) | 지정 모델이 NLI(zero-shot)라 STS 헤드가 없음. 모델 하나로 1번 완결. |
| MQM 생성 주체 | 번역 LLM 에이전트가 emit → 코드가 enum 정규화 | LLM이 이미 문맥 보유. NLI만 결정론적 모델로 분리. |

## 3. 아키텍처

```
번역 LLM 에이전트 ──► LocalizedRiskFinding (+ mqm 필드)
                            │
                            ▼
   enrichSemanticPreservation() ──HTTP──► finproof-nli :8001 (FastAPI + transformers)
                            │              mDeBERTa-v3-base-mnli-xnli (CPU, systemd)
                            ▼              premise = 한국어 상품설명서/고지
   LocalizedRiskFinding (+ semanticPreservation)   hypothesis = 외국어 segment.originalText
                            │
                            ▼
   korean_compliance_mapping ──► AgentFinding ──► ReviewIssue (신규 필드는 MultilingualIssueContext가 운반)
```

- 신규 Python 서비스는 OCR 서비스와 **별도 프로세스/포트**(`:8001`)로 운영한다. 모델 로딩·메모리를 격리해 OCR 서비스에 영향을 주지 않는다.
- **Graceful degradation:** NLI 서비스가 도달 불가하면 finding은 기존 필드를 유지하고 `semanticPreservation`만 생략한다. NLI 실패로 분석 파이프라인이 절대 실패하지 않는다.
- NLI 사용 여부는 `FINPROOF_NLI_ENABLED` 환경 플래그로 제어한다(기본 off → 데이터/MQM 변경만 먼저 배포 가능).

## 4. 데이터 모델 변경

### 4.1 `src/server/analysis/multilingual.ts` — `LocalizedRiskFinding` 확장

두 optional 블록 추가(optional = 하위 호환 + degradation 안전).

```ts
// 1번 — 의미 보존 (NLI 파생)
export type SemanticRelation =
  | "equivalent"
  | "stronger"
  | "weaker"
  | "contradiction"
  | "missing-condition";

export type SemanticPreservation = {
  semanticRelation: SemanticRelation;
  semanticShiftScore: number;        // 0~1
  missingConditionTerms: string[];
  overclaimTerms: string[];
  nliProbabilities: { entailment: number; neutral: number; contradiction: number };
  model: string;                     // 감사용, 예: "mDeBERTa-v3-base-mnli-xnli"
};

// 2번 — MQM taxonomy (LLM 생성, enum 정규화)
export type MqmErrorType =
  | "mistranslation"
  | "omission"
  | "addition"
  | "terminology"
  | "inconsistency"
  | "locale_convention";

export type MqmSeverity = "minor" | "major" | "critical";

export type MqmEvidenceType =
  | "product_doc"
  | "internal_policy"
  | "law"
  | "case_history";

export type MqmAssessment = {
  errorType: MqmErrorType;
  complianceRiskType: string;        // 예: "required_disclosure_missing"
  severity: MqmSeverity;
  targetSpan: string;
  evidenceType: MqmEvidenceType;
  recommendedAction: ReviewIssue["suggestedAction"];
};
```

`LocalizedRiskFinding`에 `semanticPreservation?: SemanticPreservation`, `mqm?: MqmAssessment` 추가.

### 4.2 `src/domain/types.ts` — `MultilingualIssueContext` 확장

동일한 `semanticPreservation?`, `mqm?` 필드를 추가해 이슈 카드까지 운반한다. 기존 `multilingualContext`가 JSON 스냅샷(`AgentFinding.outputSnapshot`)으로 운반되는 방식과 동일하므로 **Prisma 스키마 마이그레이션 불필요**.

## 5. 1번 로직 — `enrichSemanticPreservation()`

신규 모듈: `src/server/analysis/semantic-preservation.ts`

- 입력: `LocalizedRiskFinding[]`, review(`productDescription`/`disclosure`), NLI 클라이언트.
- 각 finding에 대해:
  - premise = `productDescription + "\n" + disclosure` (한국어 기준), hypothesis = `segment.originalText`(외국어). cross-lingual이라 번역 불필요.
  - NLI 클라이언트가 `{ entailment, neutral, contradiction }` 확률 반환.
  - **관계 매핑:**
    - `P(contradiction) ≥ 0.5` → `contradiction`
    - `P(entailment) ≥ 0.7` 이고 아래 missing/overclaim 미검출 → `equivalent`
    - overclaim 용어 검출(원문에 보장/전칭 표현이 premise 대비 강함) → `stronger`
    - 의무/조건 용어가 premise엔 있으나 hypothesis에 없음 → `missing-condition`
    - 의무 표현이 약화 → `weaker`
    - 그 외 → `equivalent`(정보성)
  - `semanticShiftScore = clamp(1 - P(entailment), 0, 1)`.
  - `missingConditionTerms` / `overclaimTerms`: 소형 한/외국어 lexicon(guaranteed, for everyone, no fees / 보장, 누구나, 무료 …) 대비 경량 lexical diff. **결정론적, 모델 미사용.** lexicon은 같은 모듈에 상수로 둔다.
- **risk policy 조율:** `contradiction`·`missing-condition` → 해당 finding의 `mqm.recommendedAction`을 `change_request`로 유도, `stronger` → `caution` 이상. 단 근거-바운드 정책(`prompt-registry.ts`의 `COMMON_RISK_POLICY_PROMPT`) 준수 — 직접 근거 없이 `high`로 자동 승격하지 않는다.

### 5.1 NLI 클라이언트 인터페이스

`src/server/ai/nli-client.ts`

```ts
export type NliScores = { entailment: number; neutral: number; contradiction: number };

export type NliClient = {
  classify(input: { premise: string; hypothesis: string }): Promise<NliScores>;
};
```

- HTTP 구현: `POST {FINPROOF_NLI_URL}/nli` → `{ scores }`. 타임아웃·재시도 1회, 실패 시 throw(호출부가 catch해 degradation).
- 테스트용 stub 구현으로 네트워크 없이 매핑 로직 검증.

## 6. Python NLI 마이크로서비스

신규 디렉터리: `services/nli/` (기존 OCR 서비스 레이아웃 참조)

- FastAPI 앱, 엔드포인트 `POST /nli` `{ premise, hypothesis }` → `{ scores: { entailment, neutral, contradiction } }`, `GET /health`.
- `transformers`로 `MoritzLaurer/mDeBERTa-v3-base-mnli-xnli` 로드, zero-shot NLI(premise=text, hypothesis=hypothesis)로 3-클래스 softmax.
- systemd 유닛 `finproof-nli.service`, 포트 `:8001`, CPU 실행.
- pytest 계약 테스트: 보고서 예시("신용심사 결과에 따라 승인 여부 및 금리는 달라질 수 있습니다." vs "Guaranteed approval at 4.9% for everyone.")에서 contradiction/stronger 방향이 나오는지.

## 7. 2번 로직 — MQM taxonomy

- **프롬프트 확장** `src/server/ai/prompt-registry.ts`의 `multilingualTranslatorRiskPrompt()`: 각 finding이 `mqm` 블록을 기존 필드와 **함께** 출력하도록 지시. 6종 errorType 정의와 예시(보고서 5페이지 표)를 프롬프트에 포함. `riskSignals`는 근거 매칭 핵심이므로 유지.
- **정규화** `src/server/analysis/multilingual-risk-team.ts`의 `normalizeLocalizedFinding()`: `mqm.errorType`/`severity`/`evidenceType`를 enum으로 검증. 미상값은 finding 전체를 버리지 않고 안전 기본값(`terminology`/`minor`/`product_doc`)으로 강등. `mqm` 자체가 없으면 undefined로 두고 통과(하위 호환).
- **NLI ↔ MQM 조율:** NLI가 `missing-condition`을 잡은 finding은 MQM `omission` severity를 한 단계 상향(minor→major). 두 기능이 만나는 유일한 지점.

## 8. 파이프라인 통합

`src/server/analysis/review-analysis-pipeline.ts` / `runMultilingualRiskTeam()`:

1. 번역 에이전트 실행 → `normalizeLocalizedFinding()`(now MQM 포함) → `localizedRiskFindings`.
2. `FINPROOF_NLI_ENABLED`이면 `enrichSemanticPreservation()` 호출로 `semanticPreservation` 부착 + MQM 조율. 실패 시 catch → 원본 findings 유지.
3. 이후 `korean_compliance_mapping` → `AgentFinding` → `ReviewIssue`로 흐르며 신규 필드는 `MultilingualIssueContext`가 운반.

## 9. 테스트 전략

- **매핑 단위 테스트** `semantic-preservation.test.ts`: stub NLI 클라이언트로 5개 관계(equivalent/stronger/weaker/contradiction/missing-condition) 각각 유도, shiftScore 계산, lexicon diff 검증.
- **팀 테스트** `multilingual-risk-team.test.ts` 확장: finding이 `mqm`을 담는지, NLI enrich 후 `semanticPreservation` 부착, degradation 경로(NLI throw → 필드 없음, 파이프라인 finding 산출), MQM 미상값 강등.
- **Python 계약 테스트** `services/nli/test_nli.py`: 보고서 예시 fixture.
- 기존 다국어 테스트 회귀 무손상 확인.

## 10. 롤아웃 (마이그레이션 단계)

1. **P0 — 데이터 + MQM (인프라 불필요):** 4장 타입 변경, 7장 프롬프트/정규화/조율. 모델 없이 완전 동작, 배포 가능.
2. **P1 — NLI 서비스:** 6장 `services/nli/` + systemd 기동, 5장 클라이언트/`enrichSemanticPreservation()`를 `FINPROOF_NLI_ENABLED` 플래그 뒤에 추가.
3. **활성화 + 검증:** prod env에 `FINPROOF_NLI_ENABLED=true`, `FINPROOF_NLI_URL` 설정, 다국어 테스트 케이스 재분석, 의미 필드 부착 확인.

배포는 개인 레포(personal 리모트)에서 `deploy-*` 태그로 트리거.

## 11. 범위 외

- 보고서 3(RAG+CoVe)·4(OCR layout prominence)·5(BCP-47 locale) 모듈.
- 신규 워크벤치 UI 카드. 신규 필드는 기존 `MultilingualIssueContext` 스냅샷으로 통과만 하며, 전용 카드/뱃지 UI는 후속 작업.

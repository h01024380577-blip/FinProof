# FinProof Eval Harness

FinProof 본체(Next.js/TS)를 **한 줄도 건드리지 않고** 붙는 오프라인 평가 패키지.
FinProof가 내보낸 리뷰 결과(JSON)를 읽어 판정 품질을 정량화한다.

## 왜 별도 Python 패키지인가
- 판정 품질 측정(faithfulness, 검색 정확도, 캘리브레이션)은 Python eval 생태계가 강하다.
- 본체와 분리돼 있어 위험이 0이다. 망가져도 프로덕션에 영향 없음.
- FinProof의 `model-provider`가 이미 외부 API를 `fetch`로 추상화하므로, 나중에 AI 계층을
  Python 서비스로 떼더라도 이 하니스가 그대로 회귀 테스트로 재사용된다.

## 평가 4계층 (파이프라인에 1:1 매핑)

| 계층 | 측정 | 방식 | FinProof 대응 |
|---|---|---|---|
| L1 검색 | context precision/recall, **임계값 스윕** | 결정론적 | `embedding-provider`, `rerank-provider` |
| L2 근거 | citation validity, **faithfulness / 환각률** | LLM-judge | 서브에이전트 `evidenceCandidateIds` |
| L3 판정 | issue detection F1, risk accuracy(+**과소분류율**), action accuracy | 결정론적 | `review-subagents`, `risk-policy` |
| L4 운영 | escalation recall, confidence ECE | 결정론적 | `model-router` 에스컬레이션 |

핵심 지표는 **위험 과소분류율(under_classified_rate)** 이다. 컴플라이언스에서 high를
low로 부르는 실수는 그 반대보다 훨씬 치명적이라, 단순 accuracy로 숨겨지는 이 에러를
따로 노출한다.

**임계값 스윕**은 "RAG 컷오프를 0.72로 둘까 0.55로 둘까"를 감이 아니라 데이터로 답한다 —
검색 F1을 최대화하는 컷오프를 자동 탐색한다.

## 정답 데이터는 새로 안 만든다 — reviewer override 채굴
FinProof는 reviewer가 AI 판정을 덮어쓸 때마다 감사로그에 남긴다
(`saveIssueDecision` → `reviewerRiskLevel`, `finalAction`). 이게 **사람이 검증한 라벨**이다.

```sql
-- 개념 예시: audit 이벤트에서 골든 라벨 추출
SELECT review_case_id, target_text,
       reviewer_risk_level AS risk_level,
       final_action
FROM issue_decisions
WHERE reviewer_risk_level IS NOT NULL;   -- 사람이 개입한 건만
```
이걸 `GoldCase`/`GoldFinding`으로 직렬화하면 골든셋 완성. 20~50건이면 출발선으로 충분하고,
운영하며 자동으로 누적된다.

## 사용법
```bash
pip install pydantic

# 결정론적 지표만 (API 키 불필요)
python -m harness.runner --pairs datasets/pairs.jsonl

# LLM-judge faithfulness 포함 (테스트 대상보다 강한 모델을 심판으로)
OPENAI_API_KEY=... python -m harness.runner --pairs datasets/pairs.jsonl --judge --out report.json
```

입력은 한 줄에 하나씩 `{"gold": {...}, "output": {...}}` (JSONL).
`output`은 FinProof가 내보낸 리뷰 결과, `gold`는 reviewer override에서 채굴한 정답.
형식 예시는 `datasets/pairs.example.jsonl` 참고.

## 구조
```
harness/
  schema.py              # FinProof TS 타입과 합의된 pydantic 계약
  metrics/
    decision.py          # L1·L3·L4 결정론적 지표 + 임계값 스윕
    faithfulness.py      # L2 LLM-as-judge (provider 무관)
  runner.py              # 정렬·집계·스코어카드
datasets/
  pairs.example.jsonl    # 스모크용 예시 3건
```

## 다음 단계
1. **CI 게이트**: PR마다 골든셋 회귀 실행, under_classified_rate가 기준 초과 시 fail.
2. **프롬프트 A/B**: 같은 골든셋에 프롬프트/모델 티어를 바꿔 돌려 점수 비교.
3. **임계값 운영 반영**: 스윕 결과를 `FINPROOF_*` env로 주기적 튜닝.

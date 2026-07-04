/**
 * CoVe 억제 로직 정량 시연 (결정론 fixture, API 불필요)
 *
 * 실데이터에는 CoVe가 걸러낼 약한 finding이 없어(공유 DB에 평가가능 케이스 1건뿐, 전부 접지)
 * CoVe의 drop/downgrade 효과가 관찰되지 않는다. 이 스크립트는 통제된 fixture —
 * 근거 미지지(존재하지 않는 근거 인용) / 비권위 근거 high-risk / 추적불가 문구 / 정상 접지 —
 * 를 CoVe 검증에 통과시켜 before/after 스코어카드로 억제 효과를 정량화한다.
 *
 * LLM 질문(evidence_support / risk_action_support) 2개는 stub 프로바이더가 "supported"로 고정하여
 * 판정이 오직 결정론 근거검사(evidence_exists / target_trace / source_authority)로만 결정되게 한다.
 *
 * 사용법: npx tsx scripts/cove-fixture-eval.ts
 */
import { runCoveEvidenceVerification } from "@/server/analysis/cove-verification";
import type { AgentFinding } from "@/server/analysis/review-subagents";
import type { ModelProvider } from "@/server/ai/model-provider";
import type { Evidence, ReviewCase } from "@/domain/types";

// 추적 가능한 지적 문구를 담은 광고 원문 (target_trace 통과용)
const AD_COPY =
  "연 5% 확정 수익을 보장합니다. 원금 손실 없는 안전한 상품, 지금 가입하세요. 누구나 100% 승인.";

const review = {
  id: "fixture-case-001",
  title: "확정수익 보장 적금 홍보물",
  affiliate: "데모저축은행",
  productType: "deposit",
  channelType: "online",
  plannedPublishDate: "2026-07-10",
  promotionalCopy: AD_COPY,
  productDescription: AD_COPY,
  disclosure: "",
  missingMaterials: []
} as unknown as ReviewCase;

const extractedDocuments = [
  { fileId: "f1", fileName: "poster.png", text: AD_COPY, confidence: 0.95, provider: "openai-ocr" }
];

// 근거 후보: e1(법령), e3(사례이력=비권위), e4(내규). e-ghost 는 일부러 없음.
const evidenceCandidates: (Evidence & { sourceFileId?: string })[] = [
  { id: "e1", sourceType: "law", title: "표시광고법 제3조", quoteSummary: "확정수익 보장 표현 금지", relevanceScore: 0.91 },
  { id: "e3", sourceType: "case_history", title: "유사 심의 반려 사례", quoteSummary: "과거 반려된 문구", relevanceScore: 0.83 },
  { id: "e4", sourceType: "internal_policy", title: "예적금 광고 내규", quoteSummary: "원금보장 표현 주의", relevanceScore: 0.8 }
];

function finding(partial: Partial<AgentFinding> & Pick<AgentFinding, "id">): AgentFinding {
  return {
    agent: "creative_review",
    issueType: "misleading_claim",
    riskLevel: "high",
    title: "오인유발 표현",
    targetText: "연 5% 확정 수익",
    description: "확정수익을 보장하는 표현",
    suggestedAction: "change_request",
    suggestedCopy: "수익은 시장 상황에 따라 달라질 수 있습니다",
    evidenceCandidateIds: ["e1"],
    confidence: 0.7,
    ...partial
  } as AgentFinding;
}

// 4개 통제 fixture
const draftFindings: AgentFinding[] = [
  // 1) 정상 접지: 법령 근거 + 추적가능 문구 → verified
  finding({ id: "f-grounded", targetText: "연 5% 확정 수익", evidenceCandidateIds: ["e1"] }),
  // 2) 환각: 존재하지 않는 근거 인용 → evidence_exists 실패 → drop
  finding({ id: "f-hallucinated", title: "허위 근거 인용", targetText: "원금 손실 없는", evidenceCandidateIds: ["e-ghost"] }),
  // 3) 비권위 근거 high-risk: case_history 뿐 → source_authority 부족 → downgrade
  finding({ id: "f-downgrade", title: "근거 권위 부족", targetText: "100% 승인", evidenceCandidateIds: ["e3"] }),
  // 4) 추적불가 문구: 광고 원문에 없는 문구 → target_trace 실패 → hold
  finding({ id: "f-untraceable", riskLevel: "medium", title: "추적불가 지적", targetText: "존재하지않는허위문구ZZZ", evidenceCandidateIds: ["e4"] })
];

// LLM 질문을 전부 "supported"로 고정하는 stub (결정론 검사만 판정에 기여하도록)
const stubModelProvider: ModelProvider = {
  async generateText(input) {
    const parsed = JSON.parse(input.input) as { verificationQuestions?: { id: string }[] };
    const answers = (parsed.verificationQuestions ?? []).map((q) => ({
      questionId: q.id,
      verdict: "supported",
      rationale: "stub: supported",
      citedEvidenceCandidateIds: []
    }));
    return { provider: "deterministic", model: "stub", text: JSON.stringify({ answers }) };
  }
};

function isGrounded(f: AgentFinding, ids: Set<string>): boolean {
  const cited = f.evidenceCandidateIds ?? [];
  const resolved = cited.filter((id) => ids.has(id));
  if (resolved.length === 0) return false;
  if (f.riskLevel === "high") return resolved.length >= 1 && resolved.length === cited.length;
  return resolved.length >= 1;
}

function pct(n: number, d: number) {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
}

async function main() {
  const { artifacts, verifiedAgentFindings } = await runCoveEvidenceVerification({
    review,
    extractedDocuments,
    evidenceCandidates,
    agentFindings: draftFindings,
    modelProvider: stubModelProvider
  });

  const evidenceIds = new Set(evidenceCandidates.map((e) => e.id));
  const draftGrounded = draftFindings.filter((f) => isGrounded(f, evidenceIds)).length;
  const verifiedGrounded = verifiedAgentFindings.filter((f) => isGrounded(f, evidenceIds)).length;

  const verdictCounts: Record<string, number> = { verified: 0, downgrade: 0, drop: 0, hold: 0 };
  for (const v of artifacts.verdicts) verdictCounts[v.status] = (verdictCounts[v.status] ?? 0) + 1;

  const highRiskRemoved = draftFindings.filter((f) => {
    if (f.riskLevel !== "high") return false;
    const v = artifacts.verdicts.find((x) => x.findingId === f.id);
    return v?.status === "drop" || v?.status === "downgrade";
  }).length;

  console.log("\n=== 건별 CoVe 판정 ===");
  for (const f of draftFindings) {
    const v = artifacts.verdicts.find((x) => x.findingId === f.id);
    console.log(`  ${f.id.padEnd(15)} ${String(f.riskLevel).padEnd(6)} → ${(v?.status ?? "n/a").padEnd(9)} ${v?.reasons?.[0] ?? ""}`);
  }

  console.log("\n============ CoVe 억제 시연 스코어카드 (fixture) ============");
  console.log(`CoVe 개입          : verified ${verdictCounts.verified} / downgrade ${verdictCounts.downgrade} / drop ${verdictCounts.drop} / hold ${verdictCounts.hold}`);
  console.log(`Findings           : draft ${draftFindings.length} → verified ${verifiedAgentFindings.length}  (억제율 ${pct(draftFindings.length - verifiedAgentFindings.length, draftFindings.length)}%)`);
  console.log(`근거접지율(faithf.) : ${pct(draftGrounded, draftFindings.length)}% → ${pct(verifiedGrounded, verifiedAgentFindings.length)}%  (Δ +${Math.round((pct(verifiedGrounded, verifiedAgentFindings.length) - pct(draftGrounded, draftFindings.length)) * 10) / 10}%p)`);
  console.log(`환각(미접지) 제거   : ${draftFindings.length - draftGrounded}건 → ${verifiedAgentFindings.length - verifiedGrounded}건`);
  console.log(`high-risk 교정      : ${highRiskRemoved}건 (drop/downgrade)`);
  console.log("============================================================");

  // 회귀 가드: 기대 판정과 일치하지 않으면 비정상 종료
  const expected: Record<string, string> = {
    "f-grounded": "verified",
    "f-hallucinated": "drop",
    "f-downgrade": "downgrade",
    "f-untraceable": "hold"
  };
  const mismatches = draftFindings
    .map((f) => ({ id: f.id, got: artifacts.verdicts.find((v) => v.findingId === f.id)?.status, want: expected[f.id] }))
    .filter((r) => r.got !== r.want);
  if (mismatches.length > 0) {
    console.error("\n[FAIL] 기대 판정 불일치:", JSON.stringify(mismatches));
    process.exit(1);
  }
  console.log("\n[PASS] 4개 fixture 모두 기대 판정 일치 (verified/drop/downgrade/hold)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

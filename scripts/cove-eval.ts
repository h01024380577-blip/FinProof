/**
 * CoVe 성능 개선 평가 하네스 (A/B: CoVe 전 draft vs CoVe 후 verified)
 *
 * 실제 심의 케이스를 로컬 파이프라인으로 1회 실행하면 아티팩트에
 *   - draftAgentFindings  (CoVe 검증 전 원본 findings)
 *   - agentFindings       (CoVe 검증 후 살아남은 findings)
 *   - coveVerification.verdicts (건별 verified/downgrade/drop/hold + 사유)
 * 가 모두 담긴다. 이 before/after를 비교해 CoVe 도입의 성능 개선을 정량화한다.
 *
 * 핵심 지표
 *  - 개입 분포: verified/downgrade/drop/hold 건수·비율
 *  - 환각 억제: 근거 미접지(ungrounded) finding이 출력에 도달하는 비율의 before→after 감소
 *  - 근거접지율(faithfulness): grounded/total, before vs after, Δ
 *  - 안전성 역지표: CoVe가 제거/강등한 high-risk 건수 (과소분류 위험 감시)
 *
 * 접지(grounded) 판정은 CoVe 판정과 독립적인 결정론 규칙으로 계산한다 → self-grading 회피.
 *
 * 사용법:
 *   npx tsx scripts/cove-eval.ts                 # 최근 파일 있는 케이스 3건 자동 선택
 *   npx tsx scripts/cove-eval.ts --limit 5
 *   npx tsx scripts/cove-eval.ts --cases id1,id2 # 특정 케이스 지정
 *   npx tsx scripts/cove-eval.ts --out finproof-eval/cove-report.json
 */
import { writeFileSync } from "node:fs";
import { loadDotEnv } from "./load-env";
import { createReviewAnalysisPipeline } from "@/server/analysis/review-analysis-pipeline";
import { createPrismaReviewStore } from "@/server/reviews/prisma-review-store";
import type { ReviewStoreScope } from "@/server/reviews/review-store";
import type { AgentFinding } from "@/server/analysis/review-subagents";
import type { CoveFindingVerdict } from "@/server/analysis/cove-verification";
import type { Evidence } from "@/domain/types";

type EvidenceLike = Evidence & { sourceFileId?: string };

/** Subset of pipeline artifacts this harness reads (before/after CoVe). */
type EvalArtifacts = {
  draftAgentFindings?: AgentFinding[];
  agentFindings?: AgentFinding[];
  coveVerification?: { verdicts?: CoveFindingVerdict[] };
  evidenceCandidates?: EvidenceLike[];
};

function parseArgs(argv: string[]) {
  const out: { limit: number; cases?: string[]; outPath: string } = {
    limit: 3,
    outPath: "finproof-eval/cove-report.json"
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") out.limit = Math.max(1, Number(argv[++i]) || 3);
    else if (argv[i] === "--cases") out.cases = argv[++i]?.split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--out") out.outPath = argv[++i];
  }
  return out;
}

/**
 * CoVe와 독립적인 접지(grounded) 판정.
 * finding이 실제로 존재하는 근거 후보를 인용하는지, high-risk면 최소 1개 이상 실질 근거를
 * 가리키는지 결정론으로 검사한다. 근거 미접지 = 환각 위험 finding.
 */
function isGrounded(finding: AgentFinding, evidenceById: Map<string, EvidenceLike>): boolean {
  const ids = finding.evidenceCandidateIds ?? [];
  const resolved = ids.filter((id) => evidenceById.has(id));
  if (resolved.length === 0) return false;
  // high/medium 위험 주장은 근거가 반드시 있어야 신뢰. low는 근거 1개라도 있으면 접지로 인정.
  if (finding.riskLevel === "high") return resolved.length >= 1 && resolved.length === ids.length;
  return resolved.length >= 1;
}

type CaseResult = {
  caseId: string;
  title: string;
  files: number;
  draftCount: number;
  verifiedCount: number;
  verdictCounts: Record<string, number>;
  draftGrounded: number;
  verifiedGrounded: number;
  draftUngrounded: number;
  verifiedUngrounded: number;
  highRiskRemoved: number; // draft에 있던 high가 drop되거나 강등된 수
  error?: string;
};

async function evalCase(
  pipeline: ReturnType<typeof createReviewAnalysisPipeline>,
  store: ReturnType<typeof createPrismaReviewStore>,
  scope: ReviewStoreScope,
  caseId: string
): Promise<CaseResult> {
  const review = await store.getReviewCase(scope, caseId);
  if (!review) return blankResult(caseId, "케이스를 찾을 수 없음");
  if (review.files.length === 0) return blankResult(caseId, "첨부 파일 없음(분석 불가)");

  const artifacts = (await pipeline.run({ review, scope })) as EvalArtifacts;
  const draft: AgentFinding[] = artifacts.draftAgentFindings ?? artifacts.agentFindings ?? [];
  const verified: AgentFinding[] = artifacts.agentFindings ?? [];
  const verdicts: CoveFindingVerdict[] = artifacts.coveVerification?.verdicts ?? [];
  const evidence: EvidenceLike[] = artifacts.evidenceCandidates ?? [];
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));

  const verdictCounts: Record<string, number> = { verified: 0, downgrade: 0, drop: 0, hold: 0 };
  for (const v of verdicts) verdictCounts[v.status] = (verdictCounts[v.status] ?? 0) + 1;

  const draftGrounded = draft.filter((f) => isGrounded(f, evidenceById)).length;
  const verifiedGrounded = verified.filter((f) => isGrounded(f, evidenceById)).length;

  // draft의 high-risk 중 CoVe가 drop 했거나 강등(downgrade)한 수 (과소분류 안전성 감시)
  const verdictByFinding = new Map(verdicts.map((v) => [v.findingId, v]));
  const highRiskRemoved = draft.filter((f) => {
    if (f.riskLevel !== "high") return false;
    const v = verdictByFinding.get(f.id);
    return v?.status === "drop" || v?.status === "downgrade";
  }).length;

  return {
    caseId,
    title: review.title ?? "",
    files: review.files.length,
    draftCount: draft.length,
    verifiedCount: verified.length,
    verdictCounts,
    draftGrounded,
    verifiedGrounded,
    draftUngrounded: draft.length - draftGrounded,
    verifiedUngrounded: verified.length - verifiedGrounded,
    highRiskRemoved
  };
}

function blankResult(caseId: string, error: string): CaseResult {
  return {
    caseId, title: "", files: 0, draftCount: 0, verifiedCount: 0,
    verdictCounts: { verified: 0, downgrade: 0, drop: 0, hold: 0 },
    draftGrounded: 0, verifiedGrounded: 0, draftUngrounded: 0, verifiedUngrounded: 0,
    highRiskRemoved: 0, error
  };
}

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
}

async function main() {
  loadDotEnv(".env");
  const { limit, cases, outPath } = parseArgs(process.argv.slice(2));

  const store = createPrismaReviewStore();
  const pipeline = createReviewAnalysisPipeline({ reviewStore: store });
  const scope: ReviewStoreScope = {
    tenantId: process.env.FINPROOF_DEFAULT_TENANT_ID ?? "tenant-demo",
    actorUserId: process.env.FINPROOF_DEFAULT_REVIEWER_USER_ID ?? "user-reviewer-demo",
    actorRole: "reviewer"
  };

  let caseIds = cases;
  if (!caseIds) {
    const page = await store.listReviewSummaries(scope, { page: 1, pageSize: 50 });
    // ReviewSummary에는 파일 수가 없어 여기서 걸러내지 못한다.
    // 후보를 넉넉히 뽑고, evalCase에서 파일 없는 케이스는 스킵한 뒤 limit 만큼만 채운다.
    caseIds = (page.reviewCases ?? page.items ?? []).map((s: { id: string }) => s.id);
  }
  if (!caseIds || caseIds.length === 0) {
    console.error("평가할 케이스가 없습니다. --cases 로 지정하세요.");
    process.exit(1);
  }

  const targetCount = cases ? caseIds.length : limit;
  console.log(`[cove-eval] 목표 ${targetCount}건 평가 (후보 ${caseIds.length}건 중 파일 있는 케이스 우선)\n`);

  const results: CaseResult[] = [];
  let evaluated = 0;
  for (const id of caseIds) {
    if (evaluated >= targetCount) break;
    process.stdout.write(`  ▶ ${id} ... `);
    try {
      const r = await evalCase(pipeline, store, scope, id);
      if (r.error === "첨부 파일 없음(분석 불가)" && !cases) {
        console.log("skip (파일 없음)");
        continue;
      }
      results.push(r);
      if (!r.error) evaluated++;
      console.log(
        r.error
          ? `ERROR: ${r.error}`
          : `draft ${r.draftCount} → verified ${r.verifiedCount} (drop ${r.verdictCounts.drop}, downgrade ${r.verdictCounts.downgrade})`
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.push(blankResult(id, message));
      console.log(`EXCEPTION: ${message}`);
    }
  }

  const ok = results.filter((r) => !r.error);
  const agg = ok.reduce(
    (a, r) => {
      a.draft += r.draftCount;
      a.verified += r.verifiedCount;
      a.draftGrounded += r.draftGrounded;
      a.verifiedGrounded += r.verifiedGrounded;
      a.draftUngrounded += r.draftUngrounded;
      a.verifiedUngrounded += r.verifiedUngrounded;
      a.highRiskRemoved += r.highRiskRemoved;
      for (const k of Object.keys(a.verdicts)) a.verdicts[k] += r.verdictCounts[k] ?? 0;
      return a;
    },
    { draft: 0, verified: 0, draftGrounded: 0, verifiedGrounded: 0, draftUngrounded: 0, verifiedUngrounded: 0, highRiskRemoved: 0, verdicts: { verified: 0, downgrade: 0, drop: 0, hold: 0 } as Record<string, number> }
  );

  const scorecard = {
    casesEvaluated: ok.length,
    casesFailed: results.length - ok.length,
    coveInterventions: agg.verdicts,
    findings: {
      draftTotal: agg.draft,
      verifiedTotal: agg.verified,
      suppressionRate_pct: pct(agg.draft - agg.verified, agg.draft)
    },
    faithfulness: {
      draftGroundedRate_pct: pct(agg.draftGrounded, agg.draft),
      verifiedGroundedRate_pct: pct(agg.verifiedGrounded, agg.verified),
      groundedRateDelta_pct:
        Math.round((pct(agg.verifiedGrounded, agg.verified) - pct(agg.draftGrounded, agg.draft)) * 10) / 10
    },
    hallucinationSuppression: {
      ungroundedReachingOutput_before: agg.draftUngrounded,
      ungroundedReachingOutput_after: agg.verifiedUngrounded,
      ungroundedRemoved: agg.draftUngrounded - agg.verifiedUngrounded
    },
    safety: {
      highRiskRemovedOrDowngraded: agg.highRiskRemoved,
      note: "이 값이 높으면 CoVe가 실제 high-risk를 과소분류했을 수 있어 수동 검토 필요"
    }
  };

  const report = { generatedAt: new Date().toISOString(), scope: scope.tenantId, perCase: results, scorecard };
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n================ CoVe 성능 평가 스코어카드 ================");
  console.log(`평가 케이스        : ${scorecard.casesEvaluated}건 (실패 ${scorecard.casesFailed}건)`);
  console.log(`CoVe 개입          : verified ${agg.verdicts.verified} / downgrade ${agg.verdicts.downgrade} / drop ${agg.verdicts.drop} / hold ${agg.verdicts.hold}`);
  console.log(`Findings           : draft ${agg.draft} → verified ${agg.verified}  (억제율 ${scorecard.findings.suppressionRate_pct}%)`);
  console.log(`근거접지율(faithf.) : ${scorecard.faithfulness.draftGroundedRate_pct}% → ${scorecard.faithfulness.verifiedGroundedRate_pct}%  (Δ ${scorecard.faithfulness.groundedRateDelta_pct >= 0 ? "+" : ""}${scorecard.faithfulness.groundedRateDelta_pct}%p)`);
  console.log(`환각(미접지) 억제   : ${agg.draftUngrounded}건 → ${agg.verifiedUngrounded}건  (제거 ${scorecard.hallucinationSuppression.ungroundedRemoved}건)`);
  console.log(`안전성(high 제거)  : ${agg.highRiskRemoved}건  ${agg.highRiskRemoved > 0 ? "⚠ 수동검토" : "✓"}`);
  console.log(`리포트 저장        : ${outPath}`);
  console.log("==========================================================");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

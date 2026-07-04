import type { RiskLevel, ReviewCase, ReviewIssue } from "@/domain/types";
import { getRequiredMaterialRows } from "@/domain/intake";
import { isSocialContextEvidence } from "@/domain/social-context";
import { createModelProvider, type ModelProvider } from "@/server/ai/model-provider";
import type { ModelRouteContext, ModelRouteTask } from "@/server/ai/model-router";
import { logAnalysisEvent } from "@/server/analysis/analysis-log";
import {
  CASE_SEARCH_PROMPT,
  CREATIVE_REVIEW_PROMPT,
  EVIDENCE_VERIFICATION_PROMPT,
  INTERNAL_POLICY_AGENT_PROMPT,
  MAIN_COMPLIANCE_PROMPT,
  PRODUCT_TERMS_PROMPT,
  REGULATION_AGENT_PROMPT,
  SOCIAL_CONTEXT_RISK_PROMPT
} from "@/server/ai/prompt-registry";
import type { KoreanComplianceMapping, LocalizedRiskFinding } from "./multilingual";
import type { ExtractedDocument, RagEvidenceCandidate } from "./review-analysis-pipeline";
import {
  analysisRiskLevels,
  normalizeAiSuggestedAction,
  normalizeAnalysisRiskLevel,
  riskRank
} from "./risk-policy";

export type ReviewSubAgentId =
  | "main"
  | "creative_review"
  | "product_terms"
  | "regulation"
  | "internal_policy"
  | "social_context_risk"
  | "evidence_verification"
  | "case_search"
  | "english_translator_risk"
  | "vietnamese_translator_risk"
  | "myanmar_translator_risk"
  | "khmer_translator_risk"
  | "korean_compliance_mapping";

export type AgentFinding = {
  id: string;
  agent: ReviewSubAgentId;
  issueType: string;
  riskLevel: RiskLevel;
  title: string;
  targetText: string;
  description: string;
  suggestedAction: ReviewIssue["suggestedAction"];
  suggestedCopy: string;
  evidenceCandidateIds: string[];
  confidence: number;
  rawModelOutput?: string;
  localizedRiskFinding?: LocalizedRiskFinding;
  koreanComplianceMapping?: KoreanComplianceMapping;
};

type ReviewSubAgentDefinition = {
  id: ReviewSubAgentId;
  task: ModelRouteTask;
  instructions: string;
};

export type ReviewSubAgentOrchestrator = {
  run(input: {
    review: ReviewCase;
    extractedDocuments: ExtractedDocument[];
    evidenceCandidates: RagEvidenceCandidate[];
    priorFindings?: AgentFinding[];
    onEvent?: (payload: Record<string, unknown>) => void;
  }): Promise<AgentFinding[]>;
};

const domainSubAgents: ReviewSubAgentDefinition[] = [
  {
    id: "creative_review",
    task: "creative_review",
    instructions: CREATIVE_REVIEW_PROMPT
  },
  {
    id: "product_terms",
    task: "product_terms",
    instructions: PRODUCT_TERMS_PROMPT
  },
  {
    id: "regulation",
    task: "regulation_agent",
    instructions: REGULATION_AGENT_PROMPT
  },
  {
    id: "internal_policy",
    task: "internal_policy_agent",
    instructions: INTERNAL_POLICY_AGENT_PROMPT
  },
  {
    id: "social_context_risk",
    task: "social_context_risk",
    instructions: SOCIAL_CONTEXT_RISK_PROMPT
  }
];

const evidenceVerificationAgent: ReviewSubAgentDefinition = {
  id: "evidence_verification",
  task: "evidence_verification",
  instructions: EVIDENCE_VERIFICATION_PROMPT
};

const caseSearchAgent: ReviewSubAgentDefinition = {
  id: "case_search",
  task: "case_search",
  instructions: CASE_SEARCH_PROMPT
};

const mainComplianceAgent: ReviewSubAgentDefinition = {
  id: "main",
  task: "main_compliance",
  instructions: MAIN_COMPLIANCE_PROMPT
};

function clampConfidence(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.72;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeRiskLevel(value: unknown): RiskLevel {
  return normalizeAnalysisRiskLevel(value);
}

function normalizeAction(value: unknown): ReviewIssue["suggestedAction"] {
  return normalizeAiSuggestedAction(value);
}

function compactText(text: string, maxLength = 1600) {
  const normalized = text.replace(/\s+/g, " ").trim();

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const parsed = parseJson(candidate);

  if (parsed !== undefined) {
    return parsed;
  }

  const arrayStart = candidate.indexOf("[");
  const arrayEnd = candidate.lastIndexOf("]");

  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    const arrayParsed = parseJson(candidate.slice(arrayStart, arrayEnd + 1));

    if (arrayParsed !== undefined) {
      return arrayParsed;
    }
  }

  const objectStart = candidate.indexOf("{");
  const objectEnd = candidate.lastIndexOf("}");

  if (objectStart !== -1 && objectEnd > objectStart) {
    const objectParsed = parseJson(candidate.slice(objectStart, objectEnd + 1));

    if (objectParsed !== undefined) {
      return objectParsed;
    }
  }

  return [];
}

function parseJson(candidate: string): unknown | undefined {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

function rawFindings(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "findings" in parsed &&
    Array.isArray(parsed.findings)
  ) {
    return parsed.findings;
  }

  return [];
}

function stringField(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

// Internal orchestration jargon and raw schema field names occasionally leak from the
// sub-agent prompts into the model's Korean reviewer-facing text (e.g. "prior finding",
// "evidenceCandidateIds"). Reviewers should never see these internal identifiers, so we
// map them to natural Korean wording before an issue card is built. Order matters:
// longer/more specific patterns run before generic ones.
const INTERNAL_TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bprior\s*findings?\b/gi, "기존 지적 사항"],
  [/\bfindings?\b/gi, "지적 사항"],
  [/\bevidenceCandidateIds?\b/gi, "제시된 근거"],
  [/\bevidenceCandidates?\b/gi, "제시된 근거"],
  [/\bquoteSummary\b/gi, "근거 요지"],
  [/\btargetText\b/gi, "지적 문구"],
  [/\bsuggestedCopy\b/gi, "권고 문구"],
  [/\bsuggestedAction\b/gi, "권고 조치"],
  [/\briskLevel\b/gi, "위험도"],
  [/\bsourceType\b/gi, "근거 유형"],
  [/\bissueType\b/gi, "이슈 유형"],
  [/\boutputSchema\b/gi, "출력 형식"]
];

export function sanitizeReviewerText(value: string): string {
  let result = value;
  for (const [pattern, replacement] of INTERNAL_TERM_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result.replace(/[ \t]{2,}/g, " ").trim();
}

function knownEvidenceIds(candidates: RagEvidenceCandidate[]) {
  return new Set(candidates.map((candidate) => candidate.id));
}

function evidenceCandidateMap(candidates: RagEvidenceCandidate[]) {
  return new Map(candidates.map((candidate) => [candidate.id, candidate]));
}

function uniqueValues(values: string[]) {
  return [...new Set(values)];
}

function normalizeEvidenceIds(value: unknown, candidates: RagEvidenceCandidate[]) {
  const allowedIds = knownEvidenceIds(candidates);
  const candidateIds = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && allowedIds.has(id))
    : [];

  if (candidateIds.length > 0) {
    return candidateIds;
  }

  return candidates[0]?.id ? [candidates[0].id] : [];
}

function normalizeSocialContextEvidenceIds(value: unknown, candidates: RagEvidenceCandidate[]) {
  const byId = evidenceCandidateMap(candidates);
  const allowedIds = knownEvidenceIds(candidates);
  const modelSelectedIds = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && allowedIds.has(id))
    : [];
  const modelSelectedCandidates = modelSelectedIds
    .map((id) => byId.get(id))
    .filter((candidate): candidate is RagEvidenceCandidate => Boolean(candidate));
  const productDocIds = modelSelectedCandidates
    .filter((candidate) => candidate.sourceType === "product_doc")
    .map((candidate) => candidate.id);
  const socialContextIds = modelSelectedCandidates
    .filter(isSocialContextEvidence)
    .map((candidate) => candidate.id);
  const fallbackProductDocId =
    productDocIds.length > 0
      ? undefined
      : candidates.find((candidate) => candidate.sourceType === "product_doc")?.id;
  const fallbackSocialContextId =
    socialContextIds.length > 0 ? undefined : candidates.find(isSocialContextEvidence)?.id;

  if (socialContextIds.length === 0 && !fallbackSocialContextId) {
    return [];
  }

  return uniqueValues([
    ...productDocIds,
    ...(fallbackProductDocId ? [fallbackProductDocId] : []),
    ...socialContextIds,
    ...(fallbackSocialContextId ? [fallbackSocialContextId] : [])
  ]);
}

function orderEvidenceCandidatesForAgent(
  agent: ReviewSubAgentId,
  candidates: RagEvidenceCandidate[]
) {
  if (agent !== "social_context_risk") {
    return candidates;
  }

  return [...candidates].sort((left, right) => {
    const leftGroup = isSocialContextEvidence(left) ? 0 : left.sourceType === "product_doc" ? 1 : 2;
    const rightGroup = isSocialContextEvidence(right)
      ? 0
      : right.sourceType === "product_doc"
        ? 1
        : 2;

    return leftGroup === rightGroup
      ? right.relevanceScore - left.relevanceScore
      : leftGroup - rightGroup;
  });
}

function normalizeFinding(
  agent: ReviewSubAgentId,
  item: unknown,
  index: number,
  evidenceCandidates: RagEvidenceCandidate[],
  rawModelOutput: string
): AgentFinding | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }

  const fields = item as Record<string, unknown>;
  const title = sanitizeReviewerText(stringField(fields.title, ""));

  if (!title) {
    return undefined;
  }

  const evidenceCandidateIds =
    agent === "social_context_risk"
      ? normalizeSocialContextEvidenceIds(fields.evidenceCandidateIds, evidenceCandidates)
      : normalizeEvidenceIds(fields.evidenceCandidateIds, evidenceCandidates);

  if (agent === "social_context_risk" && evidenceCandidateIds.length === 0) {
    return undefined;
  }

  return {
    id: `finding-${agent}-${String(index + 1).padStart(3, "0")}`,
    agent,
    issueType: stringField(fields.issueType, `ai_${agent}`),
    riskLevel: normalizeRiskLevel(fields.riskLevel),
    title,
    targetText: sanitizeReviewerText(stringField(fields.targetText, title)),
    description: sanitizeReviewerText(
      stringField(fields.description, "모델 분석 결과 추가 확인이 필요합니다.")
    ),
    suggestedAction: normalizeAction(fields.suggestedAction),
    suggestedCopy: sanitizeReviewerText(
      stringField(fields.suggestedCopy, "조건, 제한 사항, 적용 기준을 인접 영역에 명시해 주세요.")
    ),
    evidenceCandidateIds,
    confidence: clampConfidence(fields.confidence),
    rawModelOutput
  };
}

function highestFindingRisk(findings: AgentFinding[]): RiskLevel {
  return findings.reduce(
    (highest, finding) =>
      riskRank[finding.riskLevel] > riskRank[highest] ? finding.riskLevel : highest,
    "info" as RiskLevel
  );
}

function evidenceScoresForFinding(
  finding: AgentFinding,
  evidenceCandidates: RagEvidenceCandidate[]
) {
  const evidenceById = new Map(
    evidenceCandidates.map((candidate) => [candidate.id, candidate.relevanceScore])
  );

  return finding.evidenceCandidateIds
    .map((id) => evidenceById.get(id))
    .filter((score): score is number => typeof score === "number");
}

function findingHasWeakEvidence(finding: AgentFinding, evidenceCandidates: RagEvidenceCandidate[]) {
  const scores = evidenceScoresForFinding(finding, evidenceCandidates);

  return scores.length === 0 || scores.some((score) => score < 0.72);
}

function needsEvidenceVerification(
  findings: AgentFinding[],
  evidenceCandidates: RagEvidenceCandidate[]
) {
  return findings.some(
    (finding) =>
      riskRank[finding.riskLevel] >= riskRank.high ||
      finding.confidence < 0.78 ||
      findingHasWeakEvidence(finding, evidenceCandidates)
  );
}

function needsCaseSearch(findings: AgentFinding[], evidenceCandidates: RagEvidenceCandidate[]) {
  return (
    findings.length > 0 &&
    evidenceCandidates.some((candidate) => candidate.sourceType === "case_history")
  );
}

function hasMaterialAgentConflict(findings: AgentFinding[]) {
  if (findings.length < 2) {
    return false;
  }

  const riskValues = findings.map((finding) => riskRank[finding.riskLevel]);
  const riskSpread = Math.max(...riskValues) - Math.min(...riskValues);
  const highRiskAgents = new Set(
    findings
      .filter((finding) => riskRank[finding.riskLevel] >= riskRank.high)
      .map((finding) => finding.agent)
  );

  return riskSpread >= 2 || highRiskAgents.size >= 2;
}

function compactPriorFindings(findings: AgentFinding[]) {
  return findings.map((finding) => ({
    id: finding.id,
    agent: finding.agent,
    issueType: finding.issueType,
    riskLevel: finding.riskLevel,
    title: finding.title,
    targetText: finding.targetText,
    description: finding.description,
    suggestedAction: finding.suggestedAction,
    suggestedCopy: finding.suggestedCopy,
    evidenceCandidateIds: finding.evidenceCandidateIds,
    confidence: finding.confidence,
    localizedRiskFinding: finding.localizedRiskFinding,
    koreanComplianceMapping: finding.koreanComplianceMapping
  }));
}

function materialStatus(review: ReviewCase) {
  const requiredMaterials = getRequiredMaterialRows(review);

  return {
    requiredMaterials,
    missingRequiredMaterials: requiredMaterials
      .filter((material) => material.status === "missing")
      .map((material) => material.label),
    submittedFiles: review.files.map((file) => ({
      id: file.id,
      name: file.name,
      fileType: file.fileType,
      classificationConfidence: file.classificationConfidence,
      parseStatus: file.parseStatus,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes
    }))
  };
}

// Social-context risk is surfaced under heterogeneous, model-chosen issueTypes: the KG
// engine, the social_context_risk sub-agent, and the main agent's consolidated finding all
// label it differently, and the main agent's wording varies run to run (observed:
// social_context_risk, sensitive_expression_context, disaster_sensitivity_and_symbolic_metaphor).
// Recognize it by the owning agent or by an issueType carrying a strong social-context
// signal. This list only needs the failure to be safe: an unmatched social issueType merely
// leaves a duplicate for the reviewer, whereas the tokens here (deliberately excluding
// generic compliance words like "claim"/"disclosure"/"rate") will not tag an unrelated
// finding as social — and coverage additionally requires targetText overlap before any raw
// finding is dropped.
const SOCIAL_CONTEXT_ISSUE_TYPE_PATTERN =
  /social|context|disaster|symbolic|metaphor|sensitiv|tragedy|memorial|anniversar|controvers|backlash|mourning|사회|맥락|참사|재난|민감|논란|기념일|추모/i;

function isSocialContextFinding(finding: AgentFinding): boolean {
  return (
    finding.agent === "social_context_risk" ||
    SOCIAL_CONTEXT_ISSUE_TYPE_PATTERN.test(finding.issueType ?? "")
  );
}

function concernTokens(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^0-9a-z가-힣]+/gi, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2)
  );
}

// Two findings describe the same concern when their targetText shares multiple meaningful
// tokens (e.g. the sensitive phrase and the publish date). Used only to compare a raw
// social-context finding against the main agent's social-context finding, so incidental
// overlap with unrelated issue types cannot cause a false match.
function sharesConcern(a: AgentFinding, b: AgentFinding): boolean {
  const aTokens = concernTokens(a.targetText ?? "");
  const bTokens = concernTokens(b.targetText ?? "");
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap >= 2;
}

export function finalOrchestratedFindings(
  findings: AgentFinding[],
  mainFindings: AgentFinding[]
) {
  if (mainFindings.length === 0) {
    return findings;
  }

  const mainSocialContextFindings = mainFindings.filter(isSocialContextFinding);

  // The main_compliance agent consolidates duplicate priorFindings — including social
  // context — into one final finding per concern and assigns the proportionate riskLevel
  // (see MAIN_COMPLIANCE_PROMPT). We still preserve raw social_context_risk findings as a
  // safety net so a subtle social-context risk is never silently dropped, but ONLY when
  // the main agent did not already surface the same concern. Re-injecting a raw finding
  // the main agent already reconciled duplicated the issue for the reviewer and reverted
  // the main agent's risk downgrade — e.g. rc-upload-002 surfaced one 침몰/게시일 concern
  // three times (KG high + sub-agent high + main's consolidated caution).
  const preservedSocialContextFindings = findings.filter(
    (finding) =>
      finding.agent === "social_context_risk" &&
      !mainSocialContextFindings.some((mainFinding) => sharesConcern(mainFinding, finding))
  );

  return [...preservedSocialContextFindings, ...mainFindings];
}

// Concern-level dedupe for the final combined finding set. finalOrchestratedFindings only
// governs findings produced *inside* the orchestrator; the pipeline separately re-injects
// prior findings (the KG-engine social-context finding among them) alongside the
// orchestrator output as a loss-prevention safety net, which resurrects a raw social finding
// the main agent already consolidated. Applied to the merged set, this removes raw
// social_context_risk findings (KG engine or sub-agent) once the main agent has folded the
// same concern into its own social-context finding. Fails safe: with no matching main
// social-context finding, nothing is dropped.
export function dedupeConsolidatedSocialContextFindings(
  findings: AgentFinding[]
): AgentFinding[] {
  const mainSocialContextFindings = findings.filter(
    (finding) => finding.agent === "main" && isSocialContextFinding(finding)
  );
  if (mainSocialContextFindings.length === 0) {
    return findings;
  }

  return findings.filter(
    (finding) =>
      !(
        finding.agent === "social_context_risk" &&
        mainSocialContextFindings.some((mainFinding) => sharesConcern(mainFinding, finding))
      )
  );
}

function bestEvidenceScore(evidenceCandidates: RagEvidenceCandidate[]) {
  return Math.max(0, ...evidenceCandidates.map((candidate) => candidate.relevanceScore));
}

function hasLowOcrConfidence(extractedDocuments: ExtractedDocument[]) {
  return extractedDocuments.some((document) => document.confidence < 0.82);
}

function hasStrongCaseHistory(evidenceCandidates: RagEvidenceCandidate[]) {
  return evidenceCandidates.some(
    (candidate) => candidate.sourceType === "case_history" && candidate.relevanceScore >= 0.84
  );
}

function baseRouteContext(input: {
  review: ReviewCase;
  extractedDocuments: ExtractedDocument[];
  evidenceCandidates: RagEvidenceCandidate[];
}) {
  const bestScore = bestEvidenceScore(input.evidenceCandidates);

  return {
    riskLevel: input.review.highestRiskLevel,
    evidenceCount: input.evidenceCandidates.length,
    evidenceRelevanceScore: bestScore || undefined,
    lowOcrConfidence: hasLowOcrConfidence(input.extractedDocuments)
  };
}

function agentInput({
  review,
  extractedDocuments,
  evidenceCandidates,
  priorFindings = []
}: {
  review: ReviewCase;
  extractedDocuments: ExtractedDocument[];
  evidenceCandidates: RagEvidenceCandidate[];
  priorFindings?: AgentFinding[];
}) {
  const materials = materialStatus(review);

  return JSON.stringify({
    review: {
      id: review.id,
      title: review.title,
      affiliate: review.affiliate,
      productType: review.productType,
      channelType: review.channelType,
      plannedPublishDate: review.plannedPublishDate,
      missingMaterials: materials.missingRequiredMaterials,
      materialStatus: materials
    },
    documents: extractedDocuments.map((document) => ({
      fileId: document.fileId,
      fileName: document.fileName,
      provider: document.provider,
      confidence: document.confidence,
      text: compactText(document.text)
    })),
    evidenceCandidates: evidenceCandidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      quoteSummary: candidate.quoteSummary,
      relevanceScore: candidate.relevanceScore,
      sourceType: candidate.sourceType,
      documentId: candidate.documentId,
      sourceFileId: candidate.sourceFileId
    })),
    ...(priorFindings.length > 0 ? { priorFindings: compactPriorFindings(priorFindings) } : {}),
    outputSchema: {
      findings:
        "array of { title, issueType, riskLevel, targetText, description, suggestedAction, suggestedCopy, evidenceCandidateIds, confidence }",
      allowedRiskLevels: analysisRiskLevels,
      allowedSuggestedActions: ["approve", "change_request", "hold"]
    }
  });
}

async function runAgent({
  provider,
  agent,
  input,
  priorFindings = [],
  routeContext = {},
  onEvent
}: {
  provider: ModelProvider;
  agent: ReviewSubAgentDefinition;
  input: {
    review: ReviewCase;
    extractedDocuments: ExtractedDocument[];
    evidenceCandidates: RagEvidenceCandidate[];
  };
  priorFindings?: AgentFinding[];
  routeContext?: ModelRouteContext;
  onEvent?: (payload: Record<string, unknown>) => void;
}) {
  const emit = (payload: Record<string, unknown>) => {
    logAnalysisEvent(payload);
    onEvent?.(payload);
  };
  const startedAt = Date.now();
  emit({
    stage: "subagent",
    event: "start",
    case: input.review.id,
    agent: agent.id,
    evidence: input.evidenceCandidates.length,
    priorFindings: priorFindings.length
  });
  const result = await provider.generateText({
    task: agent.task,
    routeContext: {
      ...baseRouteContext(input),
      ...routeContext
    },
    instructions: agent.instructions,
    input: agentInput({
      ...input,
      evidenceCandidates: orderEvidenceCandidatesForAgent(agent.id, input.evidenceCandidates),
      priorFindings
    }),
    fallback: "[]"
  });

  const evidenceCandidates = orderEvidenceCandidatesForAgent(agent.id, input.evidenceCandidates);

  const findings = rawFindings(extractJson(result.text))
    .map((finding, index) =>
      normalizeFinding(agent.id, finding, index, evidenceCandidates, result.text)
    )
    .filter((finding): finding is AgentFinding => Boolean(finding));

  emit({
    stage: "subagent",
    event: "done",
    case: input.review.id,
    agent: agent.id,
    model: result.model,
    modelTier: result.modelTier,
    findings: findings.length,
    ms: Date.now() - startedAt
  });

  return findings;
}

export function createReviewSubAgentOrchestrator(
  provider: ModelProvider = createModelProvider()
): ReviewSubAgentOrchestrator {
  return {
    async run(input) {
      const onEvent = input.onEvent;
      const priorFindings = input.priorFindings ?? [];
      const domainFindings = await Promise.all(
        domainSubAgents.map((agent) =>
          runAgent({
            provider,
            agent,
            input,
            onEvent
          })
        )
      );
      const findings = [...priorFindings, ...domainFindings.flat()];

      if (findings.length === 0) {
        return findings;
      }

      if (needsEvidenceVerification(findings, input.evidenceCandidates)) {
        findings.push(
          ...(await runAgent({
            provider,
            agent: evidenceVerificationAgent,
            input,
            priorFindings: findings,
            onEvent,
            routeContext: {
              riskLevel: highestFindingRisk(findings),
              evidenceContradiction: findings.some((finding) =>
                findingHasWeakEvidence(finding, input.evidenceCandidates)
              )
            }
          }))
        );
      }

      if (needsCaseSearch(findings, input.evidenceCandidates)) {
        findings.push(
          ...(await runAgent({
            provider,
            agent: caseSearchAgent,
            input,
            priorFindings: findings,
            onEvent,
            routeContext: {
              riskLevel: highestFindingRisk(findings),
              caseStronglyInfluencesJudgment:
                hasStrongCaseHistory(input.evidenceCandidates) ||
                findings.some((finding) => riskRank[finding.riskLevel] >= riskRank.high)
            }
          }))
        );
      }

      const mainFindings = await runAgent({
        provider,
        agent: mainComplianceAgent,
        input,
        priorFindings: findings,
        onEvent,
        routeContext: {
          riskLevel: highestFindingRisk(findings),
          agentConflict: hasMaterialAgentConflict(findings)
        }
      });

      return finalOrchestratedFindings(findings, mainFindings);
    }
  };
}

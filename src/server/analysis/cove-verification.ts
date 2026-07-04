import type { Evidence, ReviewCase, ReviewIssue, RiskLevel } from "@/domain/types";
import { COVE_EVIDENCE_ANSWER_PROMPT } from "@/server/ai/prompt-registry";
import type { ModelProvider } from "@/server/ai/model-provider";
import { logAnalysisEvent, type AnalysisEventSink } from "./analysis-log";
import type { AgentFinding } from "./review-subagents";
import { riskRank } from "./risk-policy";

type ExtractedDocumentLike = {
  fileId: string;
  fileName: string;
  text: string;
  confidence: number;
  provider: string;
};

type EvidenceCandidateLike = Evidence & {
  sourceFileId?: string;
};

export type CoveClaimType =
  | "target_trace"
  | "evidence_exists"
  | "source_authority"
  | "evidence_support"
  | "risk_action_support";

export type CoveVerificationVerdictValue =
  | "supported"
  | "unsupported"
  | "contradicted"
  | "insufficient";

export type CoveVerificationMode = "none" | "llm";

export type CoveVerificationQuestion = {
  id: string;
  findingId: string;
  claimType: CoveClaimType;
  question: string;
  claimUnderTest: string;
  evidenceCandidateIds: string[];
  plannedBy: "deterministic";
  answerMode: "deterministic" | "llm";
};

export type CoveVerificationAnswer = {
  questionId: string;
  verdict: CoveVerificationVerdictValue;
  rationale: string;
  citedEvidenceCandidateIds: string[];
  answeredBy: "deterministic" | "llm" | "fallback";
};

export type CoveFindingVerdict = {
  findingId: string;
  status: "verified" | "downgrade" | "drop" | "hold";
  correctedRiskLevel?: RiskLevel;
  correctedSuggestedAction?: ReviewIssue["suggestedAction"];
  correctedEvidenceCandidateIds?: string[];
  reasons: string[];
};

export type CoveSelectionDecision = {
  findingId: string;
  mode: CoveVerificationMode;
  score: number;
  reasons: string[];
};

export type CoveVerificationArtifacts = {
  generatedAt: string;
  selection: CoveSelectionDecision[];
  questions: CoveVerificationQuestion[];
  answers: CoveVerificationAnswer[];
  verdicts: CoveFindingVerdict[];
  errors?: string[];
};

type RunCoveInput = {
  review: ReviewCase;
  extractedDocuments: ExtractedDocumentLike[];
  evidenceCandidates: EvidenceCandidateLike[];
  agentFindings: AgentFinding[];
  modelProvider: ModelProvider;
  now?: () => Date;
  onEvent?: AnalysisEventSink;
};

type RunCoveResult = {
  artifacts: CoveVerificationArtifacts;
  verifiedAgentFindings: AgentFinding[];
};

const LOW_CONFIDENCE_THRESHOLD = 0.78;
const WEAK_EVIDENCE_SCORE = 0.72;
const MAX_COVE_LLM_FINDINGS = 6;

function normalizeText(value: string | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function searchableText(value: string | undefined) {
  return normalizeText(value).replace(/[^\p{Letter}\p{Number}%]+/gu, "");
}

function compactText(value: string, maxLength = 1400) {
  const normalized = normalizeText(value);

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function tokenOverlap(left: string, right: string) {
  const tokens = normalizeText(left)
    .split(/[\s.,:;!?()[\]{}"'`~|\\/]+/)
    .filter((token) => token.length >= 2);

  if (tokens.length === 0) {
    return 0;
  }

  const haystack = normalizeText(right);
  const matches = tokens.filter((token) => haystack.includes(token)).length;

  return matches / tokens.length;
}

function targetTextIsTraceable(
  finding: AgentFinding,
  review: ReviewCase,
  extractedDocuments: ExtractedDocumentLike[]
) {
  const target = searchableText(finding.targetText);

  if (target.length < 2) {
    return true;
  }

  const reviewText = [
    review.title,
    review.promotionalCopy,
    review.disclosure,
    review.productDescription,
    review.plannedPublishDate,
    review.missingMaterials.join(" ")
  ].join(" ");
  const fullText = [...extractedDocuments.map((document) => document.text), reviewText].join(" ");
  const searchableFullText = searchableText(fullText);

  return searchableFullText.includes(target) || tokenOverlap(finding.targetText, fullText) >= 0.6;
}

function evidenceById(candidates: EvidenceCandidateLike[]) {
  return new Map(candidates.map((candidate) => [candidate.id, candidate]));
}

function findingEvidence(finding: AgentFinding, candidates: EvidenceCandidateLike[]) {
  const byId = evidenceById(candidates);

  return finding.evidenceCandidateIds
    .map((id) => byId.get(id))
    .filter((candidate): candidate is EvidenceCandidateLike => Boolean(candidate));
}

function missingEvidenceIds(finding: AgentFinding, candidates: EvidenceCandidateLike[]) {
  const ids = new Set(candidates.map((candidate) => candidate.id));

  return finding.evidenceCandidateIds.filter((id) => !ids.has(id));
}

function hasWeakEvidence(finding: AgentFinding, candidates: EvidenceCandidateLike[]) {
  const evidence = findingEvidence(finding, candidates);

  return (
    evidence.length === 0 ||
    evidence.some((candidate) => candidate.relevanceScore < WEAK_EVIDENCE_SCORE)
  );
}

function hasAuthoritativeBasis(finding: AgentFinding, candidates: EvidenceCandidateLike[]) {
  const evidence = findingEvidence(finding, candidates);

  if (evidence.length === 0) {
    return false;
  }

  if (finding.riskLevel !== "high" && finding.suggestedAction !== "change_request") {
    return true;
  }

  return evidence.some(
    (candidate) =>
      candidate.sourceType === "law" ||
      candidate.sourceType === "internal_policy" ||
      candidate.sourceType === "product_doc"
  );
}

function selectCoveMode(input: {
  finding: AgentFinding;
  review: ReviewCase;
  extractedDocuments: ExtractedDocumentLike[];
  evidenceCandidates: EvidenceCandidateLike[];
}): CoveSelectionDecision {
  const { finding, review, extractedDocuments, evidenceCandidates } = input;
  const reasons: string[] = [];
  let score = 0;

  if (finding.agent === "evidence_verification" || finding.agent === "case_search") {
    return {
      findingId: finding.id,
      mode: "none",
      score,
      reasons: ["context_agent_not_direct_issue_gate"]
    };
  }

  if (finding.riskLevel === "high") {
    score += 40;
    reasons.push("high_risk");
  }

  if (finding.suggestedAction === "change_request") {
    score += 35;
    reasons.push("change_request");
  }

  if (finding.agent === "main") {
    score += 35;
    reasons.push("final_exposure_candidate");
  }

  if (finding.confidence < LOW_CONFIDENCE_THRESHOLD) {
    score += 20;
    reasons.push("low_confidence");
  }

  if (hasWeakEvidence(finding, evidenceCandidates)) {
    score += 20;
    reasons.push("weak_or_missing_evidence");
  }

  if (!targetTextIsTraceable(finding, review, extractedDocuments)) {
    score += 25;
    reasons.push("target_trace_weak");
  }

  const shouldVerify =
    finding.riskLevel === "high" ||
    finding.suggestedAction === "change_request" ||
    finding.agent === "main";

  return {
    findingId: finding.id,
    mode: shouldVerify && score >= 35 ? "llm" : "none",
    score,
    reasons: shouldVerify ? reasons : [...reasons, "low_impact_not_cove_target"]
  };
}

function coveSelectionPriority(
  decision: CoveSelectionDecision,
  finding: AgentFinding | undefined
) {
  if (!finding) {
    return decision.score;
  }

  return (
    decision.score +
    (finding.agent === "main" ? 1000 : 0) +
    (finding.riskLevel === "high" ? 500 : 0) +
    (finding.suggestedAction === "change_request" ? 250 : 0) +
    riskRank[finding.riskLevel] * 50 +
    finding.confidence
  );
}

function limitCoveLlmSelection(
  selection: CoveSelectionDecision[],
  agentFindings: AgentFinding[]
) {
  const llmCandidates = selection.filter((decision) => decision.mode === "llm");

  if (llmCandidates.length <= MAX_COVE_LLM_FINDINGS) {
    return selection;
  }

  const findingById = new Map(agentFindings.map((finding) => [finding.id, finding]));
  const selectedIds = new Set(
    llmCandidates
      .map((decision) => ({
        decision,
        priority: coveSelectionPriority(decision, findingById.get(decision.findingId)),
        originalIndex: selection.indexOf(decision)
      }))
      .sort((left, right) => {
        const priorityDelta = right.priority - left.priority;
        return priorityDelta === 0 ? left.originalIndex - right.originalIndex : priorityDelta;
      })
      .slice(0, MAX_COVE_LLM_FINDINGS)
      .map(({ decision }) => decision.findingId)
  );

  return selection.map((decision) =>
    decision.mode === "llm" && !selectedIds.has(decision.findingId)
      ? {
          ...decision,
          mode: "none",
          reasons: [...decision.reasons, "cove_budget_limit"]
        }
      : decision
  );
}

function makeQuestionId(finding: AgentFinding, claimType: CoveClaimType) {
  return `cove-${finding.id}-${claimType}`;
}

function question(
  finding: AgentFinding,
  claimType: CoveClaimType,
  answerMode: CoveVerificationQuestion["answerMode"],
  questionText: string,
  claimUnderTest: string
): CoveVerificationQuestion {
  return {
    id: makeQuestionId(finding, claimType),
    findingId: finding.id,
    claimType,
    question: questionText,
    claimUnderTest,
    evidenceCandidateIds: finding.evidenceCandidateIds,
    plannedBy: "deterministic",
    answerMode
  };
}

function planQuestions(finding: AgentFinding, mode: CoveVerificationMode) {
  if (mode === "none") {
    return [];
  }

  return [
    question(
      finding,
      "target_trace",
      "deterministic",
      "지적 문구가 업로드 자료 또는 심의 메타데이터에서 추적되는가?",
      finding.targetText
    ),
    question(
      finding,
      "evidence_exists",
      "deterministic",
      "인용한 근거 ID가 실제 evidenceCandidates 안에 존재하는가?",
      finding.evidenceCandidateIds.join(", ")
    ),
    question(
      finding,
      "source_authority",
      "deterministic",
      "위험도와 조치 수준을 뒷받침할 수 있는 sourceType 근거가 있는가?",
      `${finding.riskLevel} / ${finding.suggestedAction}`
    ),
    question(
      finding,
      "evidence_support",
      "llm",
      "인용 근거가 finding의 제목과 설명을 직접 뒷받침하는가?",
      `${finding.title} ${finding.description}`
    ),
    question(
      finding,
      "risk_action_support",
      "llm",
      "인용 근거가 위험도와 권고 조치 수준을 직접 뒷받침하는가?",
      `${finding.riskLevel} / ${finding.suggestedAction} / ${finding.suggestedCopy}`
    )
  ];
}

function deterministicAnswers(input: {
  review: ReviewCase;
  extractedDocuments: ExtractedDocumentLike[];
  evidenceCandidates: EvidenceCandidateLike[];
  findingsById: Map<string, AgentFinding>;
  questions: CoveVerificationQuestion[];
}) {
  const { review, extractedDocuments, evidenceCandidates, findingsById, questions } = input;

  return questions
    .filter((question) => question.answerMode === "deterministic")
    .map<CoveVerificationAnswer>((question) => {
      const finding = findingsById.get(question.findingId);

      if (!finding) {
        return {
          questionId: question.id,
          verdict: "unsupported",
          rationale: "검증 대상 finding을 찾을 수 없습니다.",
          citedEvidenceCandidateIds: [],
          answeredBy: "deterministic"
        };
      }

      const evidence = findingEvidence(finding, evidenceCandidates);

      if (question.claimType === "target_trace") {
        const traceable = targetTextIsTraceable(finding, review, extractedDocuments);

        return {
          questionId: question.id,
          verdict: traceable ? "supported" : "insufficient",
          rationale: traceable
            ? "지적 문구가 업로드 자료 또는 심의 메타데이터에서 추적됩니다."
            : "지적 문구를 업로드 자료 또는 심의 메타데이터에서 충분히 추적하지 못했습니다.",
          citedEvidenceCandidateIds: [],
          answeredBy: "deterministic"
        };
      }

      if (question.claimType === "evidence_exists") {
        const missingIds = missingEvidenceIds(finding, evidenceCandidates);
        const supported = missingIds.length === 0 && finding.evidenceCandidateIds.length > 0;

        return {
          questionId: question.id,
          verdict: supported ? "supported" : "unsupported",
          rationale: supported
            ? "인용 근거 ID가 모두 evidenceCandidates 안에 존재합니다."
            : `존재하지 않거나 비어 있는 근거 ID가 있습니다: ${missingIds.join(", ") || "none"}`,
          citedEvidenceCandidateIds: evidence.map((candidate) => candidate.id),
          answeredBy: "deterministic"
        };
      }

      const supported = hasAuthoritativeBasis(finding, evidenceCandidates);

      return {
        questionId: question.id,
        verdict: supported ? "supported" : "insufficient",
        rationale: supported
          ? "근거 sourceType이 위험도와 조치 수준을 뒷받침할 수 있는 범위 안에 있습니다."
          : "위험도 또는 조치 수준을 뒷받침할 수 있는 직접 근거가 부족합니다.",
        citedEvidenceCandidateIds: evidence.map((candidate) => candidate.id),
        answeredBy: "deterministic"
      };
    });
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    : trimmed;
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start === -1 || end <= start) {
    return undefined;
  }

  try {
    return JSON.parse(withoutFence.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function normalizeAnswer(
  item: unknown,
  questionsById: Map<string, CoveVerificationQuestion>,
  evidenceIds: Set<string>
): CoveVerificationAnswer | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }

  const fields = item as Record<string, unknown>;
  const questionId = typeof fields.questionId === "string" ? fields.questionId : "";
  const question = questionsById.get(questionId);

  if (!question) {
    return undefined;
  }

  const rawVerdict = fields.verdict;
  const verdict: CoveVerificationVerdictValue =
    rawVerdict === "supported" ||
    rawVerdict === "unsupported" ||
    rawVerdict === "contradicted" ||
    rawVerdict === "insufficient"
      ? rawVerdict
      : "insufficient";
  const citedEvidenceCandidateIds = Array.isArray(fields.citedEvidenceCandidateIds)
    ? fields.citedEvidenceCandidateIds.filter(
        (id): id is string => typeof id === "string" && evidenceIds.has(id)
      )
    : [];

  return {
    questionId,
    verdict,
    rationale:
      typeof fields.rationale === "string" && fields.rationale.trim()
        ? fields.rationale.trim()
        : "검증 답변 근거가 충분히 설명되지 않았습니다.",
    citedEvidenceCandidateIds,
    answeredBy: "llm"
  };
}

function answersFromModel(
  text: string,
  questions: CoveVerificationQuestion[],
  evidenceCandidates: EvidenceCandidateLike[]
) {
  const parsed = extractJsonObject(text);

  if (!parsed || typeof parsed !== "object" || !("answers" in parsed)) {
    return [];
  }

  const answers = Array.isArray(parsed.answers) ? parsed.answers : [];
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const evidenceIds = new Set(evidenceCandidates.map((candidate) => candidate.id));

  return answers
    .map((answer) => normalizeAnswer(answer, questionsById, evidenceIds))
    .filter((answer): answer is CoveVerificationAnswer => Boolean(answer));
}

function compactFinding(finding: AgentFinding) {
  return {
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
    confidence: finding.confidence
  };
}

async function answerSemanticQuestions(input: {
  review: ReviewCase;
  extractedDocuments: ExtractedDocumentLike[];
  evidenceCandidates: EvidenceCandidateLike[];
  findings: AgentFinding[];
  questions: CoveVerificationQuestion[];
  modelProvider: ModelProvider;
}) {
  const { review, extractedDocuments, evidenceCandidates, findings, questions, modelProvider } = input;
  const semanticQuestions = questions.filter((question) => question.answerMode === "llm");

  if (semanticQuestions.length === 0) {
    return [];
  }

  const referencedEvidenceIds = new Set(
    semanticQuestions.flatMap((question) => question.evidenceCandidateIds)
  );
  const referencedFindingIds = new Set(semanticQuestions.map((question) => question.findingId));
  const referencedEvidence = evidenceCandidates.filter((candidate) =>
    referencedEvidenceIds.has(candidate.id)
  );
  const selectedFindings = findings.filter((finding) => referencedFindingIds.has(finding.id));
  const highestRisk = selectedFindings.reduce<RiskLevel>(
    (highest, finding) =>
      riskRank[finding.riskLevel] > riskRank[highest] ? finding.riskLevel : highest,
    "info"
  );
  const bestEvidenceScore = Math.max(
    0,
    ...referencedEvidence.map((candidate) => candidate.relevanceScore)
  );

  const result = await modelProvider.generateText({
    task: "cove_evidence_answering",
    routeContext: {
      riskLevel: highestRisk,
      evidenceCount: referencedEvidence.length,
      evidenceRelevanceScore: bestEvidenceScore || undefined,
      evidenceContradiction: selectedFindings.some((finding) =>
        hasWeakEvidence(finding, evidenceCandidates)
      ),
      sensitiveOutput: selectedFindings.some(
        (finding) => finding.riskLevel === "high" && finding.suggestedAction === "change_request"
      )
    },
    instructions: COVE_EVIDENCE_ANSWER_PROMPT,
    input: JSON.stringify({
      review: {
        id: review.id,
        title: review.title,
        affiliate: review.affiliate,
        productType: review.productType,
        channelType: review.channelType,
        plannedPublishDate: review.plannedPublishDate
      },
      documents: extractedDocuments.map((document) => ({
        fileId: document.fileId,
        confidence: document.confidence,
        provider: document.provider,
        text: compactText(document.text)
      })),
      findingsUnderTest: selectedFindings.map(compactFinding),
      verificationQuestions: semanticQuestions.map((question) => ({
        id: question.id,
        findingId: question.findingId,
        claimType: question.claimType,
        question: question.question,
        claimUnderTest: question.claimUnderTest,
        evidenceCandidateIds: question.evidenceCandidateIds
      })),
      evidenceCandidates: referencedEvidence.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        quoteSummary: candidate.quoteSummary,
        relevanceScore: candidate.relevanceScore,
        sourceType: candidate.sourceType,
        documentId: candidate.documentId,
        section: candidate.section
      })),
      outputSchema: {
        answers:
          "array of { questionId, verdict: supported|unsupported|contradicted|insufficient, rationale, citedEvidenceCandidateIds }"
      }
    }),
    fallback: "{\"answers\":[]}"
  });

  return answersFromModel(result.text, semanticQuestions, evidenceCandidates);
}

function fillMissingAnswers(
  questions: CoveVerificationQuestion[],
  answers: CoveVerificationAnswer[]
) {
  const answeredIds = new Set(answers.map((answer) => answer.questionId));
  const missingSemanticAnswers = questions
    .filter((question) => question.answerMode === "llm" && !answeredIds.has(question.id))
    .map<CoveVerificationAnswer>((question) => ({
      questionId: question.id,
      verdict: "insufficient",
      rationale: "LLM 검증 답변이 비어 있어 근거 재검증을 완료하지 못했습니다.",
      citedEvidenceCandidateIds: [],
      answeredBy: "fallback"
    }));

  return [...answers, ...missingSemanticAnswers];
}

function answersForFinding(
  finding: AgentFinding,
  questions: CoveVerificationQuestion[],
  answers: CoveVerificationAnswer[]
) {
  const answerByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]));

  return questions
    .filter((question) => question.findingId === finding.id)
    .map((question) => ({
      question,
      answer: answerByQuestionId.get(question.id)
    }));
}

function isProblem(answer: CoveVerificationAnswer | undefined) {
  return Boolean(answer && answer.verdict !== "supported");
}

function buildFindingVerdict(input: {
  finding: AgentFinding;
  mode: CoveVerificationMode;
  questions: CoveVerificationQuestion[];
  answers: CoveVerificationAnswer[];
  evidenceCandidates: EvidenceCandidateLike[];
}): CoveFindingVerdict | undefined {
  const { finding, mode, questions, answers, evidenceCandidates } = input;

  if (mode === "none") {
    return undefined;
  }

  const checked = answersForFinding(finding, questions, answers);
  const problemChecks = checked.filter(({ answer }) => isProblem(answer));
  const reasons = problemChecks
    .map(({ answer }) => answer?.rationale)
    .filter((reason): reason is string => Boolean(reason));
  const problemTypes = new Set(problemChecks.map(({ question }) => question.claimType));
  const existingEvidence = findingEvidence(finding, evidenceCandidates);
  const supportedEvidenceIds = checked.flatMap(({ answer }) =>
    answer?.verdict === "supported" ? answer.citedEvidenceCandidateIds : []
  );
  const correctedEvidenceCandidateIds =
    supportedEvidenceIds.length > 0
      ? [...new Set(supportedEvidenceIds)]
      : existingEvidence.map((item) => item.id);

  if (problemTypes.size === 0) {
    return {
      findingId: finding.id,
      status: "verified",
      correctedEvidenceCandidateIds,
      reasons: []
    };
  }

  if (problemTypes.has("evidence_exists")) {
    return {
      findingId: finding.id,
      status: "drop",
      reasons
    };
  }

  if (problemTypes.has("target_trace")) {
    return {
      findingId: finding.id,
      status: "hold",
      correctedRiskLevel: finding.riskLevel === "high" ? "caution" : finding.riskLevel,
      correctedSuggestedAction: "hold",
      correctedEvidenceCandidateIds,
      reasons
    };
  }

  return {
    findingId: finding.id,
    status: finding.riskLevel === "high" ? "downgrade" : "hold",
    correctedRiskLevel: finding.riskLevel === "high" ? "caution" : finding.riskLevel,
    correctedSuggestedAction:
      finding.suggestedAction === "change_request" ? "hold" : finding.suggestedAction,
    correctedEvidenceCandidateIds,
    reasons
  };
}

export function applyCoveVerdicts(
  findings: AgentFinding[],
  verdicts: CoveFindingVerdict[]
): AgentFinding[] {
  const verdictByFindingId = new Map(verdicts.map((verdict) => [verdict.findingId, verdict]));

  return findings.flatMap((finding) => {
    const verdict = verdictByFindingId.get(finding.id);

    if (!verdict || verdict.status === "verified") {
      return [finding];
    }

    if (verdict.status === "drop") {
      return [];
    }

    return [
      {
        ...finding,
        riskLevel: verdict.correctedRiskLevel ?? finding.riskLevel,
        suggestedAction: verdict.correctedSuggestedAction ?? finding.suggestedAction,
        evidenceCandidateIds: verdict.correctedEvidenceCandidateIds ?? finding.evidenceCandidateIds,
        confidence: Math.min(finding.confidence, 0.68)
      }
    ];
  });
}

export async function runCoveEvidenceVerification({
  review,
  extractedDocuments,
  evidenceCandidates,
  agentFindings,
  modelProvider,
  now = () => new Date(),
  onEvent
}: RunCoveInput): Promise<RunCoveResult> {
  // Cross-verification ("교차 검증") observability. Mirrors the pipeline's emit:
  // log one JSON line for CloudWatch and forward to the reviewer-facing progress
  // sink. Never let observability break the run.
  const startedAt = now().getTime();
  const emit = (payload: Record<string, unknown>) => {
    logAnalysisEvent(payload);
    onEvent?.(payload);
  };

  const selection = limitCoveLlmSelection(
    agentFindings.map((finding) =>
      selectCoveMode({
        finding,
        review,
        extractedDocuments,
        evidenceCandidates
      })
    ),
    agentFindings
  );
  emit({
    stage: "cove",
    event: "start",
    case: review.id,
    verifying: selection.filter((decision) => decision.mode === "llm").length
  });
  const selectedModes = new Map(selection.map((decision) => [decision.findingId, decision.mode]));
  const questions = agentFindings.flatMap((finding) =>
    planQuestions(finding, selectedModes.get(finding.id) ?? "none")
  );
  const findingsById = new Map(agentFindings.map((finding) => [finding.id, finding]));
  const deterministic = deterministicAnswers({
    review,
    extractedDocuments,
    evidenceCandidates,
    findingsById,
    questions
  });
  const errors: string[] = [];
  let semantic: CoveVerificationAnswer[] = [];

  try {
    semantic = await answerSemanticQuestions({
      review,
      extractedDocuments,
      evidenceCandidates,
      findings: agentFindings,
      questions,
      modelProvider
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Unknown CoVe verification error");
  }

  const answers = fillMissingAnswers(questions, [...deterministic, ...semantic]);
  const verdicts = agentFindings
    .map((finding) =>
      buildFindingVerdict({
        finding,
        mode: selectedModes.get(finding.id) ?? "none",
        questions,
        answers,
        evidenceCandidates
      })
    )
    .filter((verdict): verdict is CoveFindingVerdict => Boolean(verdict));

  emit({
    stage: "cove",
    event: "done",
    case: review.id,
    verified: verdicts.filter((verdict) => verdict.status === "verified").length,
    suppressed: verdicts.filter((verdict) => verdict.status !== "verified").length,
    ms: now().getTime() - startedAt
  });

  return {
    artifacts: {
      generatedAt: now().toISOString(),
      selection,
      questions,
      answers,
      verdicts,
      ...(errors.length > 0 ? { errors } : {})
    },
    verifiedAgentFindings: applyCoveVerdicts(agentFindings, verdicts)
  };
}

import type { RiskLevel, ReviewCase, ReviewIssue } from "@/domain/types";
import { createModelProvider, type ModelProvider } from "@/server/ai/model-provider";
import type { ModelRouteTask } from "@/server/ai/model-router";
import type { ExtractedDocument, RagEvidenceCandidate } from "./review-analysis-pipeline";

export type ReviewSubAgentId = "creative_review" | "product_terms" | "evidence_verification";

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
  }): Promise<AgentFinding[]>;
};

const subAgents: ReviewSubAgentDefinition[] = [
  {
    id: "creative_review",
    task: "creative_review",
    instructions:
      "You are a Korean financial ad creative review agent. Find misleading benefit, rate, guarantee, urgency, and visual-copy claims. Return only JSON."
  },
  {
    id: "product_terms",
    task: "product_terms",
    instructions:
      "You are a Korean financial product terms agent. Check whether advertised claims are supported by product terms, limits, eligibility, fees, rates, and conditions. Return only JSON."
  },
  {
    id: "evidence_verification",
    task: "evidence_verification",
    instructions:
      "You are an evidence verification agent. Validate whether each issue is grounded in supplied uploaded documents and evidence ids. Return only JSON."
  }
];

function clampConfidence(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.72;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeRiskLevel(value: unknown): RiskLevel {
  if (
    value === "info" ||
    value === "caution" ||
    value === "high" ||
    value === "reject_recommended"
  ) {
    return value;
  }

  return "caution";
}

function normalizeAction(value: unknown): ReviewIssue["suggestedAction"] {
  if (value === "approve" || value === "change_request" || value === "reject" || value === "hold") {
    return value;
  }

  return "change_request";
}

function compactText(text: string, maxLength = 1600) {
  const normalized = text.replace(/\s+/g, " ").trim();

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const arrayStart = candidate.indexOf("[");
    const arrayEnd = candidate.lastIndexOf("]");

    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      return JSON.parse(candidate.slice(arrayStart, arrayEnd + 1));
    }

    const objectStart = candidate.indexOf("{");
    const objectEnd = candidate.lastIndexOf("}");

    if (objectStart !== -1 && objectEnd > objectStart) {
      return JSON.parse(candidate.slice(objectStart, objectEnd + 1));
    }
  }

  return [];
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

function knownEvidenceIds(candidates: RagEvidenceCandidate[]) {
  return new Set(candidates.map((candidate) => candidate.id));
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
  const title = stringField(fields.title, "");

  if (!title) {
    return undefined;
  }

  return {
    id: `finding-${agent}-${String(index + 1).padStart(3, "0")}`,
    agent,
    issueType: stringField(fields.issueType, `ai_${agent}`),
    riskLevel: normalizeRiskLevel(fields.riskLevel),
    title,
    targetText: stringField(fields.targetText, title),
    description: stringField(fields.description, "모델 분석 결과 추가 확인이 필요합니다."),
    suggestedAction: normalizeAction(fields.suggestedAction),
    suggestedCopy: stringField(
      fields.suggestedCopy,
      "조건, 제한 사항, 적용 기준을 인접 영역에 명시해 주세요."
    ),
    evidenceCandidateIds: normalizeEvidenceIds(fields.evidenceCandidateIds, evidenceCandidates),
    confidence: clampConfidence(fields.confidence),
    rawModelOutput
  };
}

function agentInput({
  review,
  extractedDocuments,
  evidenceCandidates
}: {
  review: ReviewCase;
  extractedDocuments: ExtractedDocument[];
  evidenceCandidates: RagEvidenceCandidate[];
}) {
  return JSON.stringify({
    review: {
      id: review.id,
      title: review.title,
      affiliate: review.affiliate,
      productType: review.productType,
      channelType: review.channelType,
      plannedPublishDate: review.plannedPublishDate,
      missingMaterials: review.missingMaterials
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
      sourceFileId: candidate.sourceFileId
    })),
    outputSchema: {
      findings:
        "array of { title, issueType, riskLevel, targetText, description, suggestedAction, suggestedCopy, evidenceCandidateIds, confidence }",
      allowedRiskLevels: ["info", "caution", "high", "reject_recommended"],
      allowedSuggestedActions: ["approve", "change_request", "reject", "hold"]
    }
  });
}

export function createReviewSubAgentOrchestrator(
  provider: ModelProvider = createModelProvider()
): ReviewSubAgentOrchestrator {
  return {
    async run(input) {
      const evidenceCount = input.evidenceCandidates.length;
      const bestEvidenceScore = Math.max(
        0,
        ...input.evidenceCandidates.map((candidate) => candidate.relevanceScore)
      );
      const agentFindings = await Promise.all(
        subAgents.map(async (agent) => {
          const result = await provider.generateText({
            task: agent.task,
            routeContext: {
              riskLevel: input.review.highestRiskLevel,
              evidenceCount,
              evidenceRelevanceScore: bestEvidenceScore || undefined,
              lowOcrConfidence: input.extractedDocuments.some(
                (document) => document.confidence < 0.82
              )
            },
            instructions: `${agent.instructions}

Return strict JSON only. Use the exact supplied evidenceCandidateIds. If there is no actionable issue, return [].
Do not invent facts outside the uploaded documents.`,
            input: agentInput(input),
            fallback: "[]"
          });

          return rawFindings(extractJson(result.text))
            .map((finding, index) =>
              normalizeFinding(agent.id, finding, index, input.evidenceCandidates, result.text)
            )
            .filter((finding): finding is AgentFinding => Boolean(finding));
        })
      );

      return agentFindings.flat();
    }
  };
}

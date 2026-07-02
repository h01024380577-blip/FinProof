import type { Evidence, ReviewCase, ReviewIssue, RiskLevel } from "@/domain/types";
import { KNOWLEDGE_MATCHED_EVIDENCE_SCORE, MIN_MATCHED_EVIDENCE_SCORE } from "@/domain/evidence";
import type { AnalysisArtifacts, RagEvidenceCandidate } from "./review-analysis-pipeline";
import { normalizeAiSuggestedAction, normalizeAnalysisRiskLevel, riskRank } from "./risk-policy";

const defaultMinEvidenceScore = MIN_MATCHED_EVIDENCE_SCORE;

type BuildAnalysisIssuesOptions = {
  minEvidenceScore?: number;
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function combinedArtifactText(artifacts: AnalysisArtifacts) {
  return normalizeText(
    [
      ...artifacts.extractedDocuments.map((document) => document.text),
      ...artifacts.evidenceCandidates.map((candidate) => candidate.quoteSummary)
    ].join(" ")
  );
}

function evidenceCandidateById(
  artifacts: AnalysisArtifacts,
  evidenceCandidateId: string
): RagEvidenceCandidate | undefined {
  return artifacts.evidenceCandidates.find((candidate) => candidate.id === evidenceCandidateId);
}

function isRegisteredKnowledgeEvidence(candidate: RagEvidenceCandidate) {
  return candidate.sourceType === "law" || candidate.sourceType === "internal_policy";
}

function hasArticleReference(value: string) {
  return /(?:제)?\d+조(?:\s*제?\d+항)?(?:\s*제?\d+호)?/.test(value);
}

function isTableOfContentsEvidence(candidate: RagEvidenceCandidate) {
  const text = normalizeText(candidate.quoteSummary);
  const hasTocMarker = /목\s*차|contents/i.test(text);
  const hasDotLeader = /[·.]{2,}|(?:·\s*){3,}/.test(text);
  const hasSectionHeadingList = /[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\.\s*\S+/.test(text);

  return hasTocMarker && (hasDotLeader || hasSectionHeadingList);
}

function isNotCaseHistoryEvidence(candidate: RagEvidenceCandidate) {
  return candidate.sourceType !== "case_history";
}

function isReliableEvidenceCandidate(candidate: RagEvidenceCandidate, minEvidenceScore: number) {
  // Registered knowledge evidence (law/internal_policy) clears a lower floor because the
  // reranker under-scores regulation text; product_doc / case_history keep minEvidenceScore.
  const floor = isRegisteredKnowledgeEvidence(candidate)
    ? Math.min(minEvidenceScore, KNOWLEDGE_MATCHED_EVIDENCE_SCORE)
    : minEvidenceScore;

  return candidate.relevanceScore >= floor;
}

function isVisualCreativeUpload(file: ReviewCase["files"][number]) {
  const contentType = file.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const fileName = file.name.toLowerCase();
  const hasVisualContentType =
    contentType.startsWith("image/") || contentType === "application/pdf";
  const hasVisualExtension = /\.(jpe?g|png|webp|gif|heic|heif|pdf)$/i.test(fileName);

  return file.fileType === "promotional_creative" && (hasVisualContentType || hasVisualExtension);
}

function isImageOnlyReview(review: ReviewCase) {
  return review.files.length > 0 && review.files.every(isVisualCreativeUpload);
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .toLowerCase()
    .split(/[\s.,:;!?()[\]{}"'`~|\\/]+/)
    .filter((token) => token.length >= 2);
}

/**
 * How relevant a candidate is to a SPECIFIC issue (not the case overall): the
 * fraction of the issue's terms that appear in the candidate's title/quote. Used
 * to pick, per issue, the most relevant regulation from the candidate pool instead
 * of always attaching the globally top-ranked candidate to every issue.
 */
function issueRelevance(issueText: string, candidate: RagEvidenceCandidate): number {
  const issueTokens = [...new Set(tokenize(issueText))];

  if (issueTokens.length === 0) {
    return 0;
  }

  // Substring inclusion (not exact token equality) so Korean terms still match
  // across attached particles ("금리" ⊂ "금리를"), matching the pipeline's overlapScore.
  const candidateText = normalizeText(`${candidate.title} ${candidate.quoteSummary}`).toLowerCase();
  const matches = issueTokens.filter((token) => candidateText.includes(token)).length;

  return matches / issueTokens.length;
}

// A small boost for candidates that cite a concrete article/section, so that — all
// else near-equal — a specific legal provision is preferred over a general guide.
// Kept small (0.05) so it only breaks near-ties: a clearly more issue-relevant
// candidate still wins regardless of whether it carries an article reference.
const ARTICLE_REFERENCE_BOOST = 0.05;

function hasArticleCitation(candidate: RagEvidenceCandidate): boolean {
  return Boolean(candidate.section?.trim()) || hasArticleReference(candidate.quoteSummary);
}

/**
 * Picks the candidate most relevant to the issue. Relevance to the issue text is the
 * PRIMARY signal (with a small article-citation boost); ties fall back to the
 * candidate's own retrieval score. This way each issue gets the regulation most
 * relevant to IT rather than whichever happens to carry an article reference.
 */
function bestByIssueRelevance(
  issueText: string,
  candidates: RagEvidenceCandidate[]
): RagEvidenceCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  const rank = (candidate: RagEvidenceCandidate) =>
    issueRelevance(issueText, candidate) +
    (hasArticleCitation(candidate) ? ARTICLE_REFERENCE_BOOST : 0);

  return [...candidates].sort((left, right) => {
    const rankDelta = rank(right) - rank(left);

    return rankDelta !== 0 ? rankDelta : right.relevanceScore - left.relevanceScore;
  })[0];
}

function preferredEvidenceCandidate(
  artifacts: AnalysisArtifacts,
  candidates: RagEvidenceCandidate[],
  minEvidenceScore: number,
  issueText: string
): RagEvidenceCandidate | undefined {
  const reliableCandidates = candidates.filter((candidate) =>
    isReliableEvidenceCandidate(candidate, minEvidenceScore)
  );
  const reliableArtifactCandidates = artifacts.evidenceCandidates.filter((candidate) =>
    isReliableEvidenceCandidate(candidate, minEvidenceScore)
  );
  // All registered (law/internal_policy) candidates, excluding table-of-contents
  // chunks. Article and non-article candidates compete in ONE pool ranked by
  // per-issue relevance (article citation is only a small tie-break boost).
  const usableRegisteredCandidates = [
    ...reliableCandidates.filter(isRegisteredKnowledgeEvidence),
    ...reliableArtifactCandidates.filter(isRegisteredKnowledgeEvidence)
  ].filter((candidate) => !isTableOfContentsEvidence(candidate));
  const nonCaseCandidates = [
    ...reliableCandidates.filter(isNotCaseHistoryEvidence),
    ...reliableArtifactCandidates.filter(isNotCaseHistoryEvidence)
  ].filter((candidate) => !isTableOfContentsEvidence(candidate));

  return (
    bestByIssueRelevance(issueText, usableRegisteredCandidates) ??
    bestByIssueRelevance(issueText, nonCaseCandidates) ??
    bestByIssueRelevance(issueText, reliableCandidates) ??
    bestByIssueRelevance(issueText, reliableArtifactCandidates)
  );
}

function candidateToEvidence(
  candidate: RagEvidenceCandidate,
  issueId: string,
  index: number
): Evidence {
  return {
    id: `${issueId}-evidence-${String(index + 1).padStart(3, "0")}`,
    sourceType: candidate.sourceType,
    documentId: candidate.documentId,
    chunkId: candidate.chunkId,
    version: candidate.version,
    effectiveFrom: candidate.effectiveFrom,
    title: candidate.title,
    page: candidate.page,
    section: candidate.section,
    quoteSummary: candidate.quoteSummary,
    relevanceScore: candidate.relevanceScore
  };
}

function fallbackEvidence(review: ReviewCase, artifacts: AnalysisArtifacts): Evidence {
  const document = artifacts.extractedDocuments[0];

  return {
    id: `evidence-${review.id}-artifact-001`,
    sourceType: "product_doc",
    title: document?.fileName ?? "업로드 자료",
    quoteSummary: normalizeText(document?.text ?? "분석 가능한 본문이 추출되지 않았습니다."),
    relevanceScore: document ? Math.max(0.72, document.confidence) : 0.72
  };
}

function issueEvidence(
  review: ReviewCase,
  artifacts: AnalysisArtifacts,
  issueId: string,
  minEvidenceScore: number,
  issueText: string
): Evidence[] {
  const candidate = preferredEvidenceCandidate(artifacts, [], minEvidenceScore, issueText);
  const evidence = candidate
    ? candidateToEvidence(candidate, issueId, 0)
    : fallbackEvidence(review, artifacts);

  return [
    {
      ...evidence,
      id: `${issueId}-evidence-001`
    }
  ];
}

function multilingualContextFromFinding(
  finding: NonNullable<AnalysisArtifacts["agentFindings"]>[number]
): ReviewIssue["multilingualContext"] {
  const localized = finding.localizedRiskFinding;
  const mapping = finding.koreanComplianceMapping;

  if (!localized || !mapping) {
    return undefined;
  }

  return {
    segmentId: localized.segmentId,
    language: localized.language,
    originalText: localized.originalText,
    literalTranslation: localized.literalTranslation,
    complianceMeaning: localized.complianceMeaning,
    riskCategory: localized.riskCategory,
    riskSignals: localized.riskSignals,
    koreanComplianceCategory: mapping.koreanComplianceCategory,
    koreanComplianceReason: mapping.koreanComplianceReason,
    evidenceQuery: mapping.evidenceQuery,
    suggestedCopyOriginalLanguage: localized.suggestedCopyOriginalLanguage,
    suggestedCopyKoreanMeaning: localized.suggestedCopyKoreanMeaning
  };
}

function baseIssue({
  review,
  artifacts,
  idSuffix,
  issueType,
  riskLevel,
  title,
  targetText,
  description,
  suggestedCopy,
  minEvidenceScore
}: {
  review: ReviewCase;
  artifacts: AnalysisArtifacts;
  idSuffix: string;
  issueType: string;
  riskLevel: RiskLevel;
  title: string;
  targetText: string;
  description: string;
  suggestedCopy: string;
  minEvidenceScore: number;
}): ReviewIssue {
  const issueId = `issue-${review.id}-${idSuffix}`;

  return {
    id: issueId,
    issueType,
    riskLevel,
    title,
    targetText,
    targetBbox: [0, 0, 0, 0],
    sourceAgents: ["ocr", "rag", "rule-engine"],
    suggestedAction: riskLevel === "high" ? "change_request" : "hold",
    status: "open",
    description,
    suggestedCopy,
    evidence: issueEvidence(
      review,
      artifacts,
      issueId,
      minEvidenceScore,
      `${title} ${targetText} ${description}`
    )
  };
}

function issuesFromAgentFindings(
  review: ReviewCase,
  artifacts: AnalysisArtifacts,
  minEvidenceScore: number
): ReviewIssue[] {
  return (artifacts.agentFindings ?? []).map((finding) => {
    const issueId = `issue-${review.id}-${finding.id}`;
    const riskLevel = normalizeAnalysisRiskLevel(finding.riskLevel);
    const matchedEvidence = finding.evidenceCandidateIds
      .map((candidateId) => evidenceCandidateById(artifacts, candidateId))
      .filter(
        (candidate): candidate is RagEvidenceCandidate =>
          Boolean(candidate) && isReliableEvidenceCandidate(candidate, minEvidenceScore)
      );
    const preferredEvidence = preferredEvidenceCandidate(
      artifacts,
      matchedEvidence,
      minEvidenceScore,
      `${finding.title} ${finding.targetText} ${finding.description}`
    );
    const issueEvidence = preferredEvidence
      ? [candidateToEvidence(preferredEvidence, issueId, 0)]
      : [];

    return {
      id: issueId,
      issueType: finding.issueType,
      riskLevel,
      title: finding.title,
      targetText: finding.targetText,
      targetBbox: [0, 0, 0, 0] as [number, number, number, number],
      sourceAgents: [finding.agent],
      suggestedAction: normalizeAiSuggestedAction(finding.suggestedAction),
      status: "open",
      description: finding.description,
      suggestedCopy: finding.suggestedCopy,
      multilingualContext: multilingualContextFromFinding(finding),
      evidence:
        issueEvidence.length > 0
          ? issueEvidence
          : [
              {
                ...fallbackEvidence(review, artifacts),
                id: `${issueId}-evidence-001`
              }
            ]
    };
  });
}

export function highestRiskLevelForIssues(
  currentRisk: RiskLevel,
  issues: Pick<ReviewIssue, "riskLevel">[]
): RiskLevel {
  return issues.reduce(
    (highest, issue) => (riskRank[issue.riskLevel] > riskRank[highest] ? issue.riskLevel : highest),
    currentRisk
  );
}

export function buildAnalysisIssues(
  review: ReviewCase,
  artifacts: AnalysisArtifacts,
  options: BuildAnalysisIssuesOptions = {}
): ReviewIssue[] {
  const minEvidenceScore = options.minEvidenceScore ?? defaultMinEvidenceScore;
  const text = combinedArtifactText(artifacts);
  const issues: ReviewIssue[] = issuesFromAgentFindings(review, artifacts, minEvidenceScore);
  const rateClaimPattern = /(최고|최대).{0,20}([0-9]+(?:\.[0-9]+)?\s*%|연\s*[0-9])/;
  const conditionPattern = /(조건|우대|기본|세전|한도|충족|적용|대상|기간|고시)/;
  const absoluteClaimPattern = /(누구나|무조건|전원|100%|반드시|확정|보장)/;

  if (text.length === 0 && !isImageOnlyReview(review)) {
    issues.push(
      baseIssue({
        review,
        artifacts,
        idSuffix: "ocr-empty",
        issueType: "ocr_required",
        riskLevel: "caution",
        title: "본문 추출 결과 확인 필요",
        targetText: "본문 추출 실패",
        description: "업로드 자료에서 심의 가능한 본문이 추출되지 않았습니다.",
        suggestedCopy: "OCR 가능한 원본 파일 또는 텍스트 원고를 추가 제출해 주세요.",
        minEvidenceScore
      })
    );
  }

  if (rateClaimPattern.test(text) && !conditionPattern.test(text)) {
    issues.push(
      baseIssue({
        review,
        artifacts,
        idSuffix: "rate-claim",
        issueType: "rate_claim",
        riskLevel: "high",
        title: "최고 금리 표현 조건 확인 필요",
        targetText: text.match(rateClaimPattern)?.[0] ?? "최고 금리 표현",
        description:
          "최고/최대 금리 표현이 감지되었지만 우대 조건, 적용 한도, 세전 여부 등 소비자 오인 방지 정보가 함께 확인되지 않았습니다.",
        suggestedCopy:
          "최고 금리 적용 조건, 기본 금리, 우대 항목, 적용 한도 및 세전/세후 기준을 본문 인접 영역에 명시해 주세요.",
        minEvidenceScore
      })
    );
  }

  if (absoluteClaimPattern.test(text)) {
    issues.push(
      baseIssue({
        review,
        artifacts,
        idSuffix: "absolute-claim",
        issueType: "absolute_claim",
        riskLevel: "high",
        title: "누구나/무조건 표현 확인 필요",
        targetText: text.match(absoluteClaimPattern)?.[0] ?? "절대적 혜택 표현",
        description:
          "누구나, 무조건, 보장 등 절대적 표현은 실제 제한 조건이 있을 경우 소비자 오인 가능성이 큽니다.",
        suggestedCopy:
          "가입 대상, 심사 조건, 우대 조건 등 제한 사항이 있는 경우 절대 표현을 완화하고 조건을 함께 표시해 주세요.",
        minEvidenceScore
      })
    );
  }

  if (review.missingMaterials.length > 0) {
    issues.push(
      baseIssue({
        review,
        artifacts,
        idSuffix: "missing-material",
        issueType: "missing_material",
        riskLevel: "caution",
        title: "필수 심의 자료 누락",
        targetText: review.missingMaterials.join(", "),
        description: `심의 필수 자료가 누락되었습니다: ${review.missingMaterials.join(", ")}`,
        suggestedCopy:
          "누락 자료를 보완 제출하거나 제한된 자료 기준의 조건부 검토로 진행해 주세요.",
        minEvidenceScore
      })
    );
  }

  return issues;
}

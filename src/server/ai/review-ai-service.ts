import {
  answerReviewQuestion,
  detectReviewDraftLanguage,
  generateDraftWithChatContext,
  type ReviewChatResponse
} from "@/domain/chat";
import {
  generateReviewReport,
  type GenerateReviewReportInput,
  type ReviewReport
} from "@/domain/reports";
import type { Evidence, ReviewCase, ReviewIssue } from "@/domain/types";
import { createModelProvider, type ModelProvider } from "./model-provider";
import type { ModelRouteContext } from "./model-router";
import { sortIssuesByRisk } from "@/server/reviews/issue-ordinal";
import { OPINION_DRAFT_PROMPT, RAG_CHAT_PROMPT, REPORT_GENERATION_PROMPT } from "./prompt-registry";

type AnswerQuestionInput = {
  review: ReviewCase;
  issue: ReviewIssue;
  question: string;
  knowledgeEvidence?: Evidence[];
  authoritativeLawEvidence?: Evidence[];
  history?: Array<{
    question: string;
    answer: string;
  }>;
};

function reviewSummary(review: ReviewCase) {
  return {
    id: review.id,
    title: review.title,
    affiliate: review.affiliate,
    productType: review.productType,
    promotionalCopy: review.promotionalCopy,
    disclosure: review.disclosure,
    missingMaterials: review.missingMaterials
  };
}

function issueSummary(issue: ReviewIssue) {
  return {
    title: issue.title,
    issueType: issue.issueType,
    riskLevel: issue.riskLevel,
    targetText: issue.targetText,
    description: issue.description,
    suggestedCopy: issue.suggestedCopy,
    ...(issue.multilingualContext ? { multilingualContext: issue.multilingualContext } : {}),
    evidence: issue.evidence.map((evidence) => ({
      title: evidence.title,
      section: evidence.section,
      quoteSummary: evidence.quoteSummary,
      relevanceScore: evidence.relevanceScore
    }))
  };
}

function defaultModelProvider() {
  return createModelProvider();
}

function questionNeedsLegalInterpretation(question: string) {
  return /법규|법령|감독|규정|약관|위반|제재|반려|승인/.test(question);
}

function mergeEvidence(primary: Evidence[], supplemental: Evidence[] = []): Evidence[] {
  const seen = new Set<string>();
  const merged: Evidence[] = [];

  for (const evidence of [...primary, ...supplemental]) {
    if (seen.has(evidence.id)) {
      continue;
    }

    seen.add(evidence.id);
    merged.push(evidence);
  }

  return merged;
}

function isUploadedFileTitle(title: string): boolean {
  return /\.(csv|docx?|html?|jpe?g|json|md|pdf|png|txt|xlsx?|zip)$/i.test(title.trim());
}

function hideUploadedFileNames(text: string, evidence: Evidence[]): string {
  return evidence
    .filter((item) => item.sourceType === "product_doc" && isUploadedFileTitle(item.title))
    .reduce((current, item) => current.replaceAll(item.title, "업로드 자료"), text);
}

function hideInternalEvidenceReferences(text: string): string {
  return text
    .replace(/\s*,?\s*approvedKnowledgeEvidence\s*#?\s*\d+\b/gi, "")
    .replace(/law-mcp-[\w가-힣·-]+/gi, "")
    .replace(/\(\s*,\s*/g, "(")
    .replace(/,\s*\)/g, ")")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

/**
 * Safety net that rewrites internal field names and coded enum values into
 * reviewer-facing Korean when the model leaks them into the answer despite the
 * prompt instruction. Ordered longest-first so more specific tokens win. These
 * are distinctive camelCase / snake_case identifiers that do not occur in
 * natural Korean prose, so a global replace is safe.
 */
const INTERNAL_TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  // Coded enum values (issueType / sourceType / sourceAgents)
  [/\bsymbolic_misinterpretation\b/g, "상징적 오해 소지"],
  [/\bsocial_context_risk\b/g, "사회적 맥락 리스크"],
  [/\bmain_compliance\b/g, "준법 심의"],
  [/\binternal_policy\b/g, "내부 규정"],
  [/\bcase_history\b/g, "과거 심의 사례"],
  [/\bproduct_doc\b/g, "업로드 자료"],
  // Field / variable names (optionally prefixed with "issue.")
  [/\bauthoritativeLawEvidence\b/g, "확인된 법령 근거"],
  [/\bapprovedKnowledgeEvidence\b/g, "내부 기준 근거"],
  [/\bknowledgeEvidence\b/g, "지식 근거"],
  [/\bconversationHistory\b/g, "이전 대화"],
  [/\bcurrentIssueNumber\b/g, "현재 이슈 번호"],
  [/\bissueList\b/g, "이슈 목록"],
  [/\b(?:issue\.)?multilingualContext\b/g, "다국어 맥락"],
  [/\b(?:issue\.)?issueType\b/g, "이슈 유형"],
  [/\b(?:issue\.)?sourceAgents\b/g, "탐지 항목"],
  [/\b(?:issue\.)?targetText\b/g, "대상 문구"],
  [/\b(?:issue\.)?suggestedCopy\b/g, "수정 제안 문구"],
  [/\b(?:issue\.)?relevanceScore\b/g, "관련도"],
  [/\b(?:issue\.)?riskLevel\b/g, "위험도"],
  [/\bsourceType\b/g, "근거 유형"],
  [/\bquoteSummary\b/g, "근거 요약"],
  [/\bpromotionalCopy\b/g, "광고 문구"],
  [/\bmissingMaterials\b/g, "누락 자료"],
  [/\bissue\.description\b/g, "이슈 설명"]
];

function hideInternalFieldNames(text: string): string {
  return INTERNAL_TERM_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text
  );
}

function sanitizeChatAnswerText(text: string, evidence: Evidence[]): string {
  return hideInternalFieldNames(
    hideInternalEvidenceReferences(hideUploadedFileNames(text, evidence))
  );
}

function draftRouteContext(
  review: ReviewCase,
  chatResponses: ReviewChatResponse[]
): ModelRouteContext {
  const evidence = chatResponses.flatMap((response) => response.evidence);

  return {
    riskLevel: review.highestRiskLevel,
    includesLegalOrPolicyText: evidence.some(
      (item) => item.sourceType === "law" || item.sourceType === "internal_policy"
    )
  };
}

export async function answerReviewQuestionWithModel(
  input: AnswerQuestionInput,
  provider: ModelProvider = defaultModelProvider()
): Promise<ReviewChatResponse> {
  const evidence = mergeEvidence(input.issue.evidence, [
    ...(input.knowledgeEvidence ?? []),
    ...(input.authoritativeLawEvidence ?? [])
  ]);
  const issueWithKnowledgeEvidence = { ...input.issue, evidence };
  const fallback = answerReviewQuestion({ ...input, issue: issueWithKnowledgeEvidence });

  // Numbered issue list as the reviewer sees it (risk-sorted), so the model can
  // name the issue under discussion and understand references like "1번 이슈".
  const orderedIssues = sortIssuesByRisk(input.review.issues);
  const issueList = orderedIssues.map((issue, index) => ({
    number: index + 1,
    title: issue.title,
    riskLevel: issue.riskLevel
  }));
  const currentIssueNumber =
    orderedIssues.findIndex((issue) => issue.id === input.issue.id) + 1 || undefined;

  const result = await provider.generateText({
    task: "rag_chat",
    routeContext: {
      riskLevel: input.issue.riskLevel,
      ...(questionNeedsLegalInterpretation(input.question) ? { legalInterpretation: true } : {})
    },
    instructions: RAG_CHAT_PROMPT,
    input: JSON.stringify({
      review: reviewSummary(input.review),
      issue: issueWithKnowledgeEvidence,
      issueList,
      currentIssueNumber,
      authoritativeLawEvidence: input.authoritativeLawEvidence ?? [],
      approvedKnowledgeEvidence: input.knowledgeEvidence ?? [],
      question: input.question,
      conversationHistory: input.history ?? [],
      fallback: fallback.content
    }),
    fallback: fallback.content
  });

  return {
    ...fallback,
    content: sanitizeChatAnswerText(result.text, evidence)
  };
}

/**
 * Restrict a review to the reviewer-selected issues for draft generation.
 * When `selectedIssueIds` is omitted the original review is returned unchanged
 * (backward compatible: all issues). When provided, only matching issues are
 * kept so both the deterministic fallback and the model input are scoped to the
 * reviewer's selection.
 */
function scopeReviewToSelectedIssues(review: ReviewCase, selectedIssueIds?: string[]): ReviewCase {
  if (!selectedIssueIds) {
    return review;
  }
  const selected = new Set(selectedIssueIds);
  return {
    ...review,
    issues: review.issues.filter((issue) => selected.has(issue.id))
  };
}

export async function generateDraftWithModel(
  review: ReviewCase,
  chatResponses: ReviewChatResponse[],
  provider: ModelProvider = defaultModelProvider(),
  selectedIssueIds?: string[]
): Promise<string> {
  const scopedReview = scopeReviewToSelectedIssues(review, selectedIssueIds);
  // Language always follows the full package, not the selected-issue subset, so a
  // draft scoped to a few foreign-language issues is still written in the
  // package's primary language.
  const targetLanguage = detectReviewDraftLanguage(review);
  const fallback = generateDraftWithChatContext(scopedReview, chatResponses, targetLanguage);
  const result = await provider.generateText({
    task: "opinion_draft",
    routeContext: draftRouteContext(scopedReview, chatResponses),
    instructions: OPINION_DRAFT_PROMPT,
    input: JSON.stringify({
      review: reviewSummary(scopedReview),
      targetLanguage,
      issues: scopedReview.issues.map(issueSummary),
      chatResponses,
      fallback
    }),
    fallback
  });

  return result.text;
}

export async function generateReportWithModel(
  input: GenerateReviewReportInput,
  provider: ModelProvider = defaultModelProvider()
): Promise<ReviewReport> {
  const fallback = generateReviewReport(input);
  const result = await provider.generateText({
    task: "report_generation",
    routeContext: {
      riskLevel: input.review.highestRiskLevel
    },
    instructions: REPORT_GENERATION_PROMPT,
    input: JSON.stringify({
      review: reviewSummary(input.review),
      reportType: input.reportType,
      tone: input.tone,
      includeChatContext: input.includeChatContext,
      issueIds: input.issueIds,
      fallback: fallback.contentMarkdown
    }),
    fallback: fallback.contentMarkdown
  });

  return {
    ...fallback,
    contentMarkdown: result.text
  };
}

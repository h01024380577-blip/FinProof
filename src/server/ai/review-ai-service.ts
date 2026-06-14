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
import { OPINION_DRAFT_PROMPT, RAG_CHAT_PROMPT, REPORT_GENERATION_PROMPT } from "./prompt-registry";

type AnswerQuestionInput = {
  review: ReviewCase;
  issue: ReviewIssue;
  question: string;
  knowledgeEvidence?: Evidence[];
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
    .replace(/\(\s*,\s*/g, "(")
    .replace(/,\s*\)/g, ")")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

function sanitizeChatAnswerText(text: string, evidence: Evidence[]): string {
  return hideInternalEvidenceReferences(hideUploadedFileNames(text, evidence));
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
  const evidence = mergeEvidence(input.issue.evidence, input.knowledgeEvidence);
  const issueWithKnowledgeEvidence = { ...input.issue, evidence };
  const fallback = answerReviewQuestion({ ...input, issue: issueWithKnowledgeEvidence });
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

export async function generateDraftWithModel(
  review: ReviewCase,
  chatResponses: ReviewChatResponse[],
  provider: ModelProvider = defaultModelProvider()
): Promise<string> {
  const fallback = generateDraftWithChatContext(review, chatResponses);
  const targetLanguage = detectReviewDraftLanguage(review);
  const result = await provider.generateText({
    task: "opinion_draft",
    routeContext: draftRouteContext(review, chatResponses),
    instructions: OPINION_DRAFT_PROMPT,
    input: JSON.stringify({
      review: reviewSummary(review),
      targetLanguage,
      issues: review.issues.map(issueSummary),
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

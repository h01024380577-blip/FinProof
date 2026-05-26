import {
  answerReviewQuestion,
  generateDraftWithChatContext,
  type ReviewChatResponse
} from "@/domain/chat";
import {
  generateReviewReport,
  type GenerateReviewReportInput,
  type ReviewReport
} from "@/domain/reports";
import type { ReviewCase, ReviewIssue } from "@/domain/types";
import { createModelProvider, type ModelProvider } from "./model-provider";
import type { ModelRouteContext } from "./model-router";

type AnswerQuestionInput = {
  review: ReviewCase;
  issue: ReviewIssue;
  question: string;
  history?: Array<{
    question: string;
    answer: string;
  }>;
};

function reviewSummary(review: ReviewCase) {
  return JSON.stringify({
    id: review.id,
    title: review.title,
    affiliate: review.affiliate,
    productType: review.productType,
    promotionalCopy: review.promotionalCopy,
    disclosure: review.disclosure,
    missingMaterials: review.missingMaterials
  });
}

function defaultModelProvider() {
  return createModelProvider();
}

function questionNeedsLegalInterpretation(question: string) {
  return /법규|법령|감독|규정|약관|위반|제재|반려|승인/.test(question);
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
  const fallback = answerReviewQuestion(input);
  const result = await provider.generateText({
    task: "rag_chat",
    routeContext: {
      riskLevel: input.issue.riskLevel,
      ...(questionNeedsLegalInterpretation(input.question) ? { legalInterpretation: true } : {})
    },
    instructions:
      "Answer the financial advertising reviewer question in Korean. Stay evidence-bound. If evidence is missing, say what material is required.",
    input: JSON.stringify({
      review: reviewSummary(input.review),
      issue: input.issue,
      question: input.question,
      conversationHistory: input.history ?? [],
      fallback: fallback.content
    }),
    fallback: fallback.content
  });

  return {
    ...fallback,
    content: result.text
  };
}

export async function generateDraftWithModel(
  review: ReviewCase,
  chatResponses: ReviewChatResponse[],
  provider: ModelProvider = defaultModelProvider()
): Promise<string> {
  const fallback = generateDraftWithChatContext(review, chatResponses);
  const result = await provider.generateText({
    task: "opinion_draft",
    routeContext: draftRouteContext(review, chatResponses),
    instructions:
      "Write a concise Korean financial advertising review opinion draft. Use only the supplied review and reviewer chat context.",
    input: JSON.stringify({
      review: reviewSummary(review),
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
    instructions:
      "Write Korean markdown for a financial advertising review report. Preserve the same decision intent and evidence boundaries as the fallback.",
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

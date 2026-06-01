import { NextResponse } from "next/server";
import type { Evidence, ReviewCase, ReviewIssue } from "@/domain/types";
import { getAnalysisProviderConfig } from "@/server/analysis/provider-config";
import { createReranker } from "@/server/analysis/rerank-provider";
import { answerReviewQuestionWithModel } from "@/server/ai/review-ai-service";
import { createEmbeddingProvider } from "@/server/knowledge/embedding-provider";
import { createReviewService } from "@/server/reviews/review-service";
import {
  jsonError,
  readJsonBody,
  requestContext,
  type RouteContext
} from "@/server/reviews/route-utils";

type ChatRequest = {
  issueId?: string;
  question?: string;
  history?: Array<{
    question: string;
    answer: string;
  }>;
};

function chatKnowledgeQuery(review: ReviewCase, issue: ReviewIssue, question: string): string {
  return [
    question,
    issue.title,
    issue.targetText,
    issue.description,
    review.title,
    review.affiliate,
    review.productType,
    review.promotionalCopy,
    review.disclosure
  ]
    .filter((item) => item && item.trim().length > 0)
    .join("\n");
}

async function createQueryEmbedding(query: string): Promise<number[] | undefined> {
  try {
    const [embedding] = await createEmbeddingProvider().embed([query]);

    return embedding;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request, context: RouteContext<{ caseId: string }>) {
  const { caseId } = await context.params;
  const body = await readJsonBody<ChatRequest>(request);

  if (!body?.issueId || !body.question) {
    return jsonError("issueId and question are required", 400);
  }

  const service = createReviewService();
  const contextValue = await requestContext(request);
  const review = await service.getReviewCase(contextValue, caseId);
  const issue = await service.getIssue(contextValue, caseId, body.issueId);

  if (!review || !issue) {
    return jsonError("Review case or issue not found", 404);
  }

  const analysisConfig = getAnalysisProviderConfig();
  const knowledgeQuery = chatKnowledgeQuery(review, issue, body.question);
  const queryEmbedding = await createQueryEmbedding(knowledgeQuery);
  const knowledgeCandidates = await service.searchKnowledgeEvidence(contextValue, {
    query: knowledgeQuery,
    productType: review.productType,
    effectiveOn: review.plannedPublishDate,
    topK: analysisConfig.rag.topK * 2,
    minScore: analysisConfig.rag.minScore,
    queryEmbedding
  });
  const knowledgeEvidence: Evidence[] = knowledgeCandidates.length
    ? (
        await createReranker().rerank({
          query: knowledgeQuery,
          candidates: knowledgeCandidates
        })
      ).slice(0, analysisConfig.rerank.topK)
    : [];

  const response = await answerReviewQuestionWithModel({
    review,
    issue,
    question: body.question,
    history: body.history,
    knowledgeEvidence
  });

  return NextResponse.json({ response });
}

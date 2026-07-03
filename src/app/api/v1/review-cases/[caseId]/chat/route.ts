import type { Evidence, ReviewCase, ReviewIssue } from "@/domain/types";
import { getAnalysisProviderConfig } from "@/server/analysis/provider-config";
import { createReranker } from "@/server/analysis/rerank-provider";
import { classifyLawSearchIntent } from "@/server/ai/law-search-intent";
import { answerReviewQuestionWithModel } from "@/server/ai/review-ai-service";
import { createEmbeddingProvider } from "@/server/knowledge/embedding-provider";
import { createKoreanLawMcpClient } from "@/server/regulatory/korean-law-mcp-client";
import {
  ndjsonStream,
  streamReviewChat,
  type ReviewChatStreamDeps
} from "@/server/reviews/review-chat-stream";
import { createReviewService } from "@/server/reviews/review-service";
import { resolveChatIssueByOrdinal } from "@/server/reviews/issue-ordinal";
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
  const selectedIssue = await service.getIssue(contextValue, caseId, body.issueId);

  if (!review || !selectedIssue) {
    return jsonError("Review case or issue not found", 404);
  }

  // If the reviewer names an issue by number ("1번 이슈 설명해줘"), retarget the
  // chat to that issue so retrieval and the answer are about the right one,
  // regardless of which card is currently selected in the UI.
  const { issue } = resolveChatIssueByOrdinal(review.issues, body.question, selectedIssue);

  const analysisConfig = getAnalysisProviderConfig();
  const knowledgeQuery = chatKnowledgeQuery(review, issue, body.question);

  const deps: ReviewChatStreamDeps = {
    classifyIntent: (question) => classifyLawSearchIntent(question),
    searchKnowledge: async () => {
      const queryEmbedding = await createQueryEmbedding(knowledgeQuery);
      const knowledgeCandidates = await service.searchKnowledgeEvidence(contextValue, {
        query: knowledgeQuery,
        productType: review.productType,
        effectiveOn: review.plannedPublishDate,
        topK: analysisConfig.rag.topK * 2,
        minScore: analysisConfig.rag.minScore,
        queryEmbedding
      });

      if (!knowledgeCandidates.length) {
        return [] as Evidence[];
      }

      return (
        await createReranker().rerank({
          query: knowledgeQuery,
          candidates: knowledgeCandidates
        })
      ).slice(0, analysisConfig.rerank.topK);
    },
    lawClient: createKoreanLawMcpClient(),
    answer: (input) => answerReviewQuestionWithModel(input),
    coverageMinScore: analysisConfig.rag.minScore
  };

  const events = streamReviewChat(
    { review, issue, question: body.question, history: body.history },
    deps
  );

  return new Response(ndjsonStream(events), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no"
    }
  });
}

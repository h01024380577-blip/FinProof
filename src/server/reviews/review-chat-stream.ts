import type { ChatProgressEvent, ReviewChatResponse } from "@/domain/chat";
import type { Evidence, ReviewCase, ReviewIssue } from "@/domain/types";
import type { LawSearchIntent } from "@/server/ai/law-search-intent";
import { assessLawCoverage, extractLawName } from "@/server/ai/law-coverage";
import type { KoreanLawMcpClient } from "@/server/regulatory/korean-law-mcp-client";
import { mapLawTextToEvidence } from "./mcp-law-evidence";

type AnswerInput = {
  review: ReviewCase;
  issue: ReviewIssue;
  question: string;
  history?: Array<{ question: string; answer: string }>;
  knowledgeEvidence: Evidence[];
  authoritativeLawEvidence: Evidence[];
};

export type ReviewChatStreamDeps = {
  classifyIntent: (question: string) => Promise<LawSearchIntent>;
  searchKnowledge: () => Promise<Evidence[]>;
  lawClient: KoreanLawMcpClient;
  answer: (input: AnswerInput) => Promise<ReviewChatResponse>;
  coverageMinScore: number;
};

export type ReviewChatStreamParams = {
  review: ReviewCase;
  issue: ReviewIssue;
  question: string;
  history?: Array<{ question: string; answer: string }>;
};

export async function* streamReviewChat(
  params: ReviewChatStreamParams,
  deps: ReviewChatStreamDeps
): AsyncGenerator<ChatProgressEvent> {
  const { review, issue, question, history } = params;

  yield { type: "stage", stage: "analyzing_intent", label: "질문 의도 분석 중" };
  const intent = await deps.classifyIntent(question);

  yield { type: "stage", stage: "searching_knowledge", label: "등록된 지식문서 검색 중" };
  const knowledgeEvidence = await deps.searchKnowledge();

  let authoritativeLawEvidence: Evidence[] = [];
  const covered = assessLawCoverage(knowledgeEvidence, question, deps.coverageMinScore);
  const lawName = intent === "law_search" ? extractLawName(question) : undefined;

  if (intent === "law_search" && !covered && lawName) {
    yield { type: "stage", stage: "knowledge_miss", label: "지식문서에 없음 — 국가법령정보 조회" };

    try {
      yield {
        type: "mcp",
        stage: "mcp_search_law",
        tool: "search_law",
        query: lawName,
        label: `법령 검색 중: ${lawName}`
      };
      const found = await deps.lawClient.searchLaw(lawName);

      if (found.lawId || found.mst) {
        yield {
          type: "mcp",
          stage: "mcp_get_law_text",
          tool: "get_law_text",
          query: found.title ?? lawName,
          label: "조문 원문 조회 중"
        };
        const lawText = await deps.lawClient.getLawText({
          ...(found.lawId ? { lawId: found.lawId } : {}),
          ...(found.mst ? { mst: found.mst } : {})
        });

        if (lawText.text.trim().length > 0) {
          authoritativeLawEvidence = [mapLawTextToEvidence(found, lawText, lawName)];
        } else {
          yield {
            type: "stage",
            stage: "mcp_failed",
            label: "법제처 조문을 가져오지 못했습니다 — 등록된 근거로 답변합니다"
          };
        }
      } else {
        yield {
          type: "stage",
          stage: "mcp_failed",
          label: "법제처에서 해당 법령을 찾지 못했습니다 — 등록된 근거로 답변합니다"
        };
      }
    } catch {
      yield {
        type: "stage",
        stage: "mcp_failed",
        label: "법제처 실시간 조회 실패 — 등록된 근거로 답변합니다"
      };
    }
  } else {
    yield { type: "stage", stage: "knowledge_hit", label: "등록된 근거로 답변 작성 중" };
  }

  yield { type: "stage", stage: "generating_answer", label: "근거 종합 답변 생성 중" };
  const response = await deps.answer({
    review,
    issue,
    question,
    history,
    knowledgeEvidence,
    authoritativeLawEvidence
  });

  yield { type: "done", response };
}

export function ndjsonStream(
  events: AsyncGenerator<ChatProgressEvent>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "error", message: "질문 요청을 처리하지 못했습니다." })}\n`
          )
        );
      } finally {
        controller.close();
      }
    }
  });
}

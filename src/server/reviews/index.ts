import { createMockReviewStore } from "./mock-review-store";
import { createPrismaReviewStore } from "./prisma-review-store";
import { reviewCases } from "@/domain/reviews";
import { sampleDataEnabled } from "./sample-data";
import type { ReviewStore } from "./review-store";

const defaultReviewStoreKey = Symbol.for("finproof.defaultReviewStore");

type GlobalWithReviewStore = typeof globalThis & {
  [defaultReviewStoreKey]?: ReviewStore;
};

function getGlobalReviewStoreSlot() {
  return globalThis as GlobalWithReviewStore;
}

function createConfiguredReviewStore(): ReviewStore {
  if (process.env.FINPROOF_REVIEW_STORE === "prisma") {
    return createPrismaReviewStore();
  }

  return createMockReviewStore(sampleDataEnabled() ? reviewCases : []);
}

export function getReviewStore() {
  const slot = getGlobalReviewStoreSlot();

  slot[defaultReviewStoreKey] ??= createConfiguredReviewStore();

  return slot[defaultReviewStoreKey];
}

export function resetDefaultReviewStoreForTests() {
  getGlobalReviewStoreSlot()[defaultReviewStoreKey] = createConfiguredReviewStore();
}

export type {
  AnalysisJob,
  AnalysisResult,
  AuditEvent,
  CreateChatMessageInput,
  CreateChatMessageResult,
  CreateChatSessionInput,
  CreateDraftVersionInput,
  CreateKnowledgeDocumentChunkInput,
  CreateKnowledgeDocumentInput,
  CreateReviewReportInput,
  CreateReviewCaseResult,
  ListIssuesOptions,
  ListReviewSummariesOptions,
  KnowledgeEvidenceSearchInput,
  ReviewSummaryPage,
  ReviewStoreScope,
  ReviewStore,
  SaveIssueDecisionInput
} from "./review-store";
export { createMockReviewStore, createPrismaReviewStore };

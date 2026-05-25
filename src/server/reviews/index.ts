import { createMockReviewStore } from "./mock-review-store";

let defaultReviewStore = createMockReviewStore();

export function getReviewStore() {
  return defaultReviewStore;
}

export function resetDefaultReviewStoreForTests() {
  defaultReviewStore = createMockReviewStore();
}

export type {
  AnalysisResult,
  CreateReviewCaseResult,
  ListIssuesOptions,
  ReviewStore,
  SaveIssueDecisionInput
} from "./review-store";
export { createMockReviewStore };

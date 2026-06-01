import { readFile } from "node:fs/promises";
import { createMockReviewStore } from "@/server/reviews/mock-review-store";
import { createRegulatoryKnowledgeService } from "./regulatory-knowledge-service";

const context = {
  tenantId: "tenant-demo",
  userId: "user-reviewer-demo",
  role: "reviewer" as const
};

describe("regulatory knowledge demo flow", () => {
  it("makes changed deposit-rate guidance retrievable after automatic activation", async () => {
    const store = createMockReviewStore([]);
    const service = createRegulatoryKnowledgeService({
      store,
      now: () => new Date("2026-05-31T00:00:00.000Z")
    });
    const scope = {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorRole: context.role
    };
    const repositoryPath =
      "docs/test-packages/rag-knowledge/internal_policy_deposit_ad_review_2026.md";
    const fixtureText = await readFile(repositoryPath, "utf8");
    const sourceText =
      "제1조 최고금리 표시\n최고금리 표현 시 기본금리, 우대조건, 적용 한도, 적용 기간을 인접 영역에 함께 표시해야 한다.";
    const source = await store.createRegulatorySource(scope, {
      id: "reg-source-demo-rate",
      sourceType: "internal_policy_repo",
      name: "예금 광고 심의 지침",
      repositoryPath,
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });

    expect(fixtureText).toContain("## 2026.07 개정 예시: 최고금리 인접 고지 강화");
    expect(fixtureText).toContain(
      "최고금리 표현 시 기본금리, 우대조건, 적용 한도, 적용 기간을 인접 영역에 함께 표시해야 한다."
    );

    await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "예금 광고 심의 지침",
      version: "2026.07",
      sourceText,
      effectiveFrom: "2026-07-01",
      documentType: "internal_policy",
      productType: "deposit",
      mappedChannels: ["mobile_banner", "short_copy"],
      mappedReviewCategories: ["rate_display", "required_disclosure"]
    });

    const evidence = await store.searchKnowledgeEvidence(scope, {
      query: "누구나 최고금리 혜택 기본금리 우대조건 적용 한도",
      productType: "deposit",
      effectiveOn: "2026-07-02",
      minScore: 0.6
    });

    expect(evidence[0]).toMatchObject({
      title: "예금 광고 심의 지침",
      quoteSummary: expect.stringContaining("최고금리")
    });
  });
});

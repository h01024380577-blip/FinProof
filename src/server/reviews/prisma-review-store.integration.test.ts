import { createPrismaReviewStore } from "./prisma-review-store";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const scope = {
  tenantId: "tenant-demo",
  actorUserId: "user-reviewer-demo",
  actorRole: "reviewer" as const
};

describeIfDb("prisma review store", () => {
  it("lists seeded review summaries", async () => {
    const store = createPrismaReviewStore();

    const summaries = await store.listReviewSummaries(scope);

    expect(summaries.map((summary) => summary.id)).toEqual(
      expect.arrayContaining(["rc-demo-deposit-001", "rc-demo-loan-001"])
    );
  });

  it("creates analysis jobs and persists review status", async () => {
    const store = createPrismaReviewStore();
    await store.createReviewCaseFromSamplePackage(scope, {
      samplePackageId: "rc-demo-deposit-001"
    });

    const analysis = await store.startAnalysis(scope, "rc-demo-deposit-001");
    const job = await store.getLatestAnalysisJob(scope, "rc-demo-deposit-001");
    const review = await store.getReviewCase(scope, "rc-demo-deposit-001");

    expect(analysis).toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      status: "analysis_complete"
    });
    expect(job).toMatchObject({
      reviewCaseId: "rc-demo-deposit-001",
      status: "completed",
      progress: 100
    });
    expect(review?.status).toBe("analysis_complete");
  });
});

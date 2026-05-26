import { afterEach, describe, expect, it, vi } from "vitest";

const scope = {
  tenantId: "tenant-demo",
  actorUserId: "user-reviewer-demo",
  actorRole: "reviewer" as const
};

async function importReviewStoreModule() {
  return import("./index");
}

describe("default review store", () => {
  afterEach(async () => {
    const { resetDefaultReviewStoreForTests } = await importReviewStoreModule();
    resetDefaultReviewStoreForTests();
    vi.resetModules();
  });

  it("keeps uploaded review cases readable across isolated server module loads", async () => {
    vi.resetModules();
    const firstModule = await importReviewStoreModule();

    const uploadResult = await firstModule
      .getReviewStore()
      .createReviewCaseFromUploadedFiles(scope, {
        title: "실제 업로드 적금 홍보물",
        affiliate: "광주은행",
        productType: "deposit",
        channelType: ["poster"],
        plannedPublishDate: "2026-06-20",
        files: [
          {
            name: "real-deposit-poster.png",
            type: "image/png",
            size: 2048
          }
        ]
      });

    expect(
      await firstModule.getReviewStore().getReviewCase(scope, uploadResult.reviewCase.id)
    ).toMatchObject({
      id: "rc-upload-001"
    });

    vi.resetModules();
    const secondModule = await importReviewStoreModule();

    expect(
      await secondModule.getReviewStore().getReviewCase(scope, uploadResult.reviewCase.id)
    ).toMatchObject({
      id: "rc-upload-001",
      analysisNotice: "실제 업로드 건은 OCR/RAG 분석 전이므로 근거 부족 상태로 표시됩니다."
    });
  });
});

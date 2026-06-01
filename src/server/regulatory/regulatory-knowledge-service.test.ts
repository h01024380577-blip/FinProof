import { createMockReviewStore } from "@/server/reviews/mock-review-store";
import { createRegulatoryKnowledgeService } from "./regulatory-knowledge-service";

const context = {
  tenantId: "tenant-demo",
  userId: "user-reviewer-demo",
  role: "reviewer" as const,
  ipAddress: "127.0.0.1"
};

describe("regulatory knowledge service", () => {
  it("detects a changed source and activates active RAG knowledge", async () => {
    const store = createMockReviewStore([]);
    const service = createRegulatoryKnowledgeService({
      store,
      now: () => new Date("2026-05-31T00:00:00.000Z")
    });
    const source = await store.createRegulatorySource(
      {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorRole: context.role,
        ipAddress: context.ipAddress
      },
      {
        id: "reg-source-deposit-policy",
        sourceType: "internal_policy_repo",
        name: "예금 광고 내부 기준",
        repositoryPath: "internal/policies/deposit-ad.md",
        pollingSchedule: "0 9 * * *",
        trustLevel: "internal"
      }
    );

    const result = await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "예금 광고 내부 기준",
      version: "2026.07",
      sourceText: [
        "제1조 최고금리 표시",
        "최고금리 표현 시 기본금리, 우대조건, 적용 한도를 인접 영역에 표시해야 한다."
      ].join("\n"),
      effectiveFrom: "2026-07-01",
      documentType: "internal_policy",
      productType: "deposit",
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"]
    });

    expect(result).toMatchObject({
      sourceId: source.id,
      snapshotCreated: true,
      activated: true,
      changeSetCount: 1
    });
    expect(result.activatedDocumentIds).toHaveLength(1);
    expect(result.activatedDocumentIds[0]).toMatch(
      /^knowledge-auto-reg-change-reg-source-deposit-policy-\d{17}-[a-f0-9]{12}-001$/
    );

    const evidence = await store.searchKnowledgeEvidence(
      {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorRole: context.role
      },
      {
        query: "최고금리 기본금리 우대조건",
        productType: "deposit",
        effectiveOn: "2026-07-01",
        minScore: 0.6
      }
    );
    const changeSets = await store.listRegulatoryChangeSets({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorRole: context.role
    });
    const changeSet = await store.getRegulatoryChangeSet(
      {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorRole: context.role
      },
      changeSets[0].id
    );
    const gates = await store.listQualityGateResults(
      {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorRole: context.role
      },
      changeSets[0].id
    );

    expect(evidence[0]).toMatchObject({
      title: "예금 광고 내부 기준",
      effectiveFrom: "2026-07-01"
    });
    expect(changeSet).toMatchObject({
      qualityGateStatus: "passed",
      createdKnowledgeDocumentId: result.activatedDocumentIds[0]
    });
    expect(gates).toHaveLength(6);
  });

  it("records unchanged checks without creating a new snapshot", async () => {
    const store = createMockReviewStore([]);
    const service = createRegulatoryKnowledgeService({
      store,
      now: () => new Date("2026-05-31T00:00:00.000Z")
    });
    const scope = {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorRole: context.role,
      ipAddress: context.ipAddress
    };
    const sourceText = "제1조 최고금리 표시\n최고금리 표현 시 우대조건을 표시해야 한다.";
    const source = await store.createRegulatorySource(scope, {
      id: "reg-source-unchanged",
      sourceType: "internal_policy_repo",
      name: "예금 광고 내부 기준",
      repositoryPath: "internal/policies/deposit-ad.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });

    await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "예금 광고 내부 기준",
      version: "2026.07",
      sourceText,
      effectiveFrom: "2026-07-01",
      documentType: "internal_policy",
      productType: "deposit",
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"]
    });

    const unchanged = await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "예금 광고 내부 기준",
      version: "2026.07",
      sourceText,
      effectiveFrom: "2026-07-01",
      documentType: "internal_policy",
      productType: "deposit",
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"]
    });

    expect(unchanged).toEqual({
      sourceId: source.id,
      snapshotCreated: false,
      activated: false,
      changeSetCount: 0,
      activatedDocumentIds: []
    });
  });

  it("uses previous text for amended diffs and unique ids across repeated checks", async () => {
    const store = createMockReviewStore([]);
    let currentNow = "2026-05-31T00:00:00.000Z";
    const service = createRegulatoryKnowledgeService({
      store,
      now: () => new Date(currentNow)
    });
    const scope = {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorRole: context.role,
      ipAddress: context.ipAddress
    };
    const firstText = "제1조 최고금리 표시\n최고금리 표현 시 우대조건을 표시해야 한다.";
    const secondText =
      "제1조 최고금리 표시\n최고금리 표현 시 기본금리와 우대조건을 인접 표시해야 한다.";
    const source = await store.createRegulatorySource(scope, {
      id: "reg-source-repeat",
      sourceType: "internal_policy_repo",
      name: "반복 변경 기준",
      repositoryPath: "internal/policies/repeat.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });

    const first = await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "반복 변경 기준",
      version: "2026.07",
      sourceText: firstText,
      effectiveFrom: "2026-07-01",
      documentType: "internal_policy",
      productType: "deposit",
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"]
    });
    currentNow = "2026-05-31T00:00:01.000Z";
    const second = await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "반복 변경 기준",
      version: "2026.08",
      sourceText: secondText,
      previousNormalizedText: firstText,
      effectiveFrom: "2026-08-01",
      documentType: "internal_policy",
      productType: "deposit",
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"]
    });
    currentNow = "2026-05-31T00:00:02.000Z";
    const reverted = await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "반복 변경 기준",
      version: "2026.09",
      sourceText: firstText,
      previousNormalizedText: secondText,
      effectiveFrom: "2026-09-01",
      documentType: "internal_policy",
      productType: "deposit",
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"]
    });
    const changeSets = await store.listRegulatoryChangeSets(scope);
    const secondChangeSetId = second.activatedDocumentIds[0].replace("knowledge-auto-", "");
    const secondChangeSet = await store.getRegulatoryChangeSet(scope, secondChangeSetId);

    expect(second.activated).toBe(true);
    expect(second.activatedDocumentIds[0]).not.toBe(first.activatedDocumentIds[0]);
    expect(reverted.activated).toBe(true);
    expect(reverted.activatedDocumentIds[0]).not.toBe(first.activatedDocumentIds[0]);
    expect(changeSets.map((changeSet) => changeSet.id)).toHaveLength(3);
    expect(secondChangeSet).toMatchObject({
      changeType: "amended",
      previousSnapshotId: expect.any(String),
      qualityGateStatus: "passed"
    });
  });

  it("keeps multiple changed sections from one source check searchable independently", async () => {
    const store = createMockReviewStore([]);
    const service = createRegulatoryKnowledgeService({
      store,
      now: () => new Date("2026-05-31T00:00:00.000Z")
    });
    const scope = {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorRole: context.role,
      ipAddress: context.ipAddress
    };
    const source = await store.createRegulatorySource(scope, {
      id: "reg-source-multi-section",
      sourceType: "internal_policy_repo",
      name: "복수 조항 기준",
      repositoryPath: "internal/policies/multi-section.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });

    const result = await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "복수 조항 기준",
      version: "2026.07",
      sourceText: [
        "제1조 최고금리 표시",
        "최고금리 표현 시 기본금리와 우대조건을 인접 표시해야 한다.",
        "제2조 예금자보호 안내",
        "예금자보호 문구는 최신 표준문안을 그대로 사용해야 한다."
      ].join("\n"),
      effectiveFrom: "2026-07-01",
      documentType: "internal_policy",
      productType: "deposit",
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display", "required_disclosure"]
    });

    const documents = await store.listKnowledgeDocuments(scope);
    const rateEvidence = await store.searchKnowledgeEvidence(scope, {
      query: "기본금리 우대조건",
      productType: "deposit",
      effectiveOn: "2026-07-02",
      minScore: 0.6
    });
    const protectionEvidence = await store.searchKnowledgeEvidence(scope, {
      query: "예금자보호 표준문안",
      productType: "deposit",
      effectiveOn: "2026-07-02",
      minScore: 0.6
    });

    expect(result.activatedDocumentIds).toHaveLength(2);
    expect(documents.filter((document) => document.lifecycleStatus === "active")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: result.activatedDocumentIds[0] }),
        expect.objectContaining({ id: result.activatedDocumentIds[1] })
      ])
    );
    expect(rateEvidence[0]).toMatchObject({
      documentId: result.activatedDocumentIds[0]
    });
    expect(protectionEvidence[0]).toMatchObject({
      documentId: result.activatedDocumentIds[1]
    });
  });

  it("does not supersede unchanged unnumbered sections when a new section is inserted before them", async () => {
    const store = createMockReviewStore([]);
    let currentNow = "2026-05-31T00:00:00.000Z";
    const service = createRegulatoryKnowledgeService({
      store,
      now: () => new Date(currentNow)
    });
    const scope = {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorRole: context.role,
      ipAddress: context.ipAddress
    };
    const firstText = [
      "## 최고금리 표시",
      "최고금리 표현 시 기본금리와 우대조건을 인접 표시해야 한다.",
      "## 예금자보호 안내",
      "예금자보호 문구는 최신 표준문안을 그대로 사용해야 한다."
    ].join("\n");
    const secondText = [
      "## 광고 사전 승인",
      "광고 집행 전 준법감시 승인번호를 확인해야 한다.",
      "## 최고금리 표시",
      "최고금리 표현 시 기본금리와 우대조건을 인접 표시해야 한다.",
      "## 예금자보호 안내",
      "예금자보호 문구는 최신 표준문안을 그대로 사용해야 한다."
    ].join("\n");
    const source = await store.createRegulatorySource(scope, {
      id: "reg-source-unnumbered-insert",
      sourceType: "internal_policy_repo",
      name: "번호 없는 내부 기준",
      repositoryPath: "internal/policies/unnumbered.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });

    const first = await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "번호 없는 내부 기준",
      version: "2026.07",
      sourceText: firstText,
      effectiveFrom: "2026-07-01",
      documentType: "internal_policy",
      productType: "deposit",
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display", "required_disclosure"]
    });
    currentNow = "2026-05-31T00:00:01.000Z";

    await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "번호 없는 내부 기준",
      version: "2026.08",
      sourceText: secondText,
      previousNormalizedText: firstText,
      effectiveFrom: "2026-08-01",
      documentType: "internal_policy",
      productType: "deposit",
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display", "required_disclosure"]
    });

    const evidence = await store.searchKnowledgeEvidence(scope, {
      query: "최고금리 기본금리 우대조건",
      productType: "deposit",
      effectiveOn: "2026-08-02",
      minScore: 0.6
    });

    expect(evidence[0]).toMatchObject({
      documentId: first.activatedDocumentIds[0],
      version: "2026.07"
    });
  });

  it("requires matching previous text for changed checks after an existing snapshot", async () => {
    const store = createMockReviewStore([]);
    const service = createRegulatoryKnowledgeService({
      store,
      now: () => new Date("2026-05-31T00:00:00.000Z")
    });
    const scope = {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorRole: context.role,
      ipAddress: context.ipAddress
    };
    const source = await store.createRegulatorySource(scope, {
      id: "reg-source-previous-required",
      sourceType: "internal_policy_repo",
      name: "이전 본문 필수 기준",
      repositoryPath: "internal/policies/previous-required.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });

    await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "이전 본문 필수 기준",
      version: "2026.07",
      sourceText: "제1조 최고금리 표시\n최고금리 표현 시 우대조건을 표시해야 한다.",
      effectiveFrom: "2026-07-01",
      documentType: "internal_policy",
      productType: "deposit",
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"]
    });

    await expect(
      service.runSourceCheck(context, {
        sourceId: source.id,
        title: "이전 본문 필수 기준",
        version: "2026.08",
        sourceText: "제1조 최고금리 표시\n최고금리 표현 시 기본금리를 표시해야 한다.",
        effectiveFrom: "2026-08-01",
        documentType: "internal_policy",
        productType: "deposit",
        mappedChannels: ["mobile_banner"],
        mappedReviewCategories: ["rate_display"]
      })
    ).rejects.toThrow("previousNormalizedText is required");

    await expect(
      service.runSourceCheck(context, {
        sourceId: source.id,
        title: "이전 본문 필수 기준",
        version: "2026.08",
        sourceText: "제1조 최고금리 표시\n최고금리 표현 시 기본금리를 표시해야 한다.",
        previousNormalizedText: "제1조 최고금리 표시\n다른 기준입니다.",
        previousContentHash: "not-the-text-hash",
        effectiveFrom: "2026-08-01",
        documentType: "internal_policy",
        productType: "deposit",
        mappedChannels: ["mobile_banner"],
        mappedReviewCategories: ["rate_display"]
      })
    ).rejects.toThrow("previousNormalizedText does not match");
  });

  it("persists failed gate status without activating knowledge", async () => {
    const store = createMockReviewStore([]);
    const service = createRegulatoryKnowledgeService({
      store,
      now: () => new Date("2026-05-31T00:00:00.000Z")
    });
    const scope = {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorRole: context.role,
      ipAddress: context.ipAddress
    };
    const source = await store.createRegulatorySource(scope, {
      id: "reg-source-failed-gate",
      sourceType: "internal_policy_repo",
      name: "실패 게이트 기준",
      repositoryPath: "internal/policies/failed-gate.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });

    const result = await service.runSourceCheck(context, {
      sourceId: source.id,
      title: "실패 게이트 기준",
      version: "2026.07",
      sourceText: "제1조 최고금리 표시\n최고금리 표현 시 조건을 인접 표시한다.",
      effectiveFrom: "2026-07-01",
      documentType: "internal_policy",
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"]
    });
    const changeSets = await store.listRegulatoryChangeSets(scope);
    const changeSet = await store.getRegulatoryChangeSet(scope, changeSets[0].id);

    expect(result).toEqual({
      sourceId: source.id,
      snapshotCreated: true,
      activated: false,
      changeSetCount: 1,
      activatedDocumentIds: []
    });
    expect(changeSet).toMatchObject({
      qualityGateStatus: "failed"
    });
    expect(changeSet?.createdKnowledgeDocumentId).toBeUndefined();
  });
});

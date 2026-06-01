import { createMockReviewStore } from "./mock-review-store";

const scope = {
  tenantId: "tenant-demo",
  actorUserId: "user-reviewer-demo",
  actorRole: "reviewer" as const
};

describe("mock review store regulatory knowledge", () => {
  it("creates regulatory sources, snapshots, change sets, gates, and active knowledge", async () => {
    const store = createMockReviewStore([]);
    const source = await store.createRegulatorySource(scope, {
      id: "reg-source-deposit",
      sourceType: "internal_policy_repo",
      name: "예금 광고 내부 기준",
      repositoryPath: "internal/policies/deposit-ad.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });
    const snapshot = await store.createRegulatorySnapshot(scope, {
      id: "reg-snapshot-202607",
      sourceId: source.id,
      title: "예금 광고 내부 기준",
      effectiveFrom: "2026-07-01",
      contentHash: "hash-202607",
      rawStorageKey: "regulatory/raw/reg-snapshot-202607.txt",
      normalizedStorageKey: "regulatory/normalized/reg-snapshot-202607.json",
      detectedDocumentType: "internal_policy",
      fetchStatus: "fetched",
      normalizationConfidence: 0.97
    });
    const changeSet = await store.createRegulatoryChangeSet(scope, {
      id: "reg-change-001",
      sourceId: source.id,
      newSnapshotId: snapshot.id,
      changeType: "created",
      changeSummary: "최고금리 표시 기준이 신설되었습니다.",
      changedSections: [
        {
          sectionId: "section-001",
          sectionNumber: "제1조",
          title: "최고금리 표시",
          newText: "최고금리 표현 시 기본금리와 우대조건을 인접 표시한다.",
          diffSummary: "신설 조항입니다.",
          citation: { snapshotId: snapshot.id, sectionId: "section-001" }
        }
      ],
      effectiveFrom: "2026-07-01",
      riskImpactLevel: "high",
      interpretationSummary: "예금 최고금리 단독 강조를 제한합니다.",
      mappedProductTypes: ["deposit"],
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"],
      qualityGateStatus: "passed",
      confidence: 0.93
    });

    await store.replaceQualityGateResults(scope, changeSet.id, [
      {
        id: "gate-reg-change-001-citation_coverage",
        changeSetId: changeSet.id,
        gateType: "citation_coverage",
        status: "passed",
        summary: "모든 변경 섹션에 원문 citation이 있습니다.",
        evidence: {},
        createdAt: "2026-05-31T00:00:00.000Z"
      }
    ]);
    const activation = await store.activateRegulatoryChangeSet(scope, {
      changeSetId: changeSet.id,
      document: {
        id: "knowledge-auto-reg-change-001",
        documentType: "internal_policy",
        productType: "deposit",
        title: "예금 광고 내부 기준",
        version: "2026.07",
        effectiveFrom: "2026-07-01",
        storageKey: "generated/regulatory/reg-change-001.md",
        canonicalKey: "internal-policy:deposit-ad",
        sourceSnapshotId: snapshot.id,
        changeSetId: changeSet.id,
        autoIngested: true,
        interpretationSummary: "예금 최고금리 단독 강조를 제한합니다."
      },
      chunks: [
        {
          id: "chunk-auto-reg-change-001-001",
          tenantId: scope.tenantId,
          knowledgeDocumentId: "knowledge-auto-reg-change-001",
          chunkText: "최고금리 표현 시 기본금리와 우대조건을 인접 표시한다.",
          chunkSummary: "최고금리 표시 기준",
          embeddingModel: "deterministic",
          embeddingId: "embedding-auto-reg-change-001-001",
          section: "최고금리 표시",
          metadata: { source: "regulatory_change_set" },
          canonicalSectionKey: "internal-policy:deposit-ad:section-001",
          sectionNumber: "제1조",
          changeSetId: changeSet.id,
          chunkStatus: "active",
          impactTags: ["deposit", "rate_display"],
          effectiveFrom: "2026-07-01",
          sourceReliability: 0.95
        }
      ]
    });

    const evidence = await store.searchKnowledgeEvidence(scope, {
      query: "최고금리 기본금리 우대조건",
      productType: "deposit",
      effectiveOn: "2026-07-02",
      minScore: 0.6
    });

    expect(activation?.document).toMatchObject({
      id: "knowledge-auto-reg-change-001",
      approvalStatus: "approved",
      lifecycleStatus: "active",
      autoIngested: true
    });
    expect(activation?.changeSet).toMatchObject({
      createdKnowledgeDocumentId: "knowledge-auto-reg-change-001",
      qualityGateStatus: "passed"
    });
    expect(evidence[0]).toMatchObject({
      documentId: "knowledge-auto-reg-change-001",
      chunkId: "chunk-auto-reg-change-001-001",
      title: "예금 광고 내부 기준",
      effectiveFrom: "2026-07-01"
    });
  });

  it("excludes active chunks that are not effective for the planned publish date", async () => {
    const store = createMockReviewStore([]);
    const document = await store.createKnowledgeDocument(scope, {
      id: "knowledge-future",
      documentType: "internal_policy",
      title: "미래 시행 기준",
      version: "2026.07",
      effectiveFrom: "2026-07-01",
      storageKey: "generated/future.md"
    });

    await store.approveKnowledgeDocument(scope, document.id);
    await store.replaceKnowledgeDocumentChunks(scope, document.id, [
      {
        id: "chunk-future-001",
        tenantId: scope.tenantId,
        knowledgeDocumentId: document.id,
        chunkText: "최고금리 표현 시 기본금리와 우대조건을 인접 표시한다.",
        chunkSummary: "최고금리 표시 기준",
        embeddingModel: "deterministic",
        embeddingId: "embedding-future-001",
        metadata: { source: "knowledge_document" },
        chunkStatus: "active"
      }
    ]);

    const beforeEffectiveDate = await store.searchKnowledgeEvidence(scope, {
      query: "최고금리 기본금리 우대조건",
      effectiveOn: "2026-06-30",
      minScore: 0.6
    });

    expect(beforeEffectiveDate).toEqual([]);
  });

  it("excludes legacy superseded chunks without an effective end date", async () => {
    const store = createMockReviewStore([]);
    const document = await store.createKnowledgeDocument(scope, {
      id: "knowledge-legacy-superseded",
      documentType: "internal_policy",
      productType: "deposit",
      title: "구 기준",
      version: "2026.07",
      effectiveFrom: "2026-07-01",
      storageKey: "generated/legacy-superseded.md"
    });

    await store.approveKnowledgeDocument(scope, document.id);
    await store.replaceKnowledgeDocumentChunks(scope, document.id, [
      {
        id: "chunk-legacy-superseded-001",
        tenantId: scope.tenantId,
        knowledgeDocumentId: document.id,
        chunkText: "최고금리 표현 시 기본금리와 우대조건을 인접 표시한다.",
        chunkSummary: "최고금리 표시 기준",
        embeddingModel: "deterministic",
        embeddingId: "embedding-legacy-superseded-001",
        metadata: { source: "legacy_regulatory_change_set" },
        chunkStatus: "superseded",
        effectiveFrom: "2026-07-01"
      }
    ]);

    const evidence = await store.searchKnowledgeEvidence(scope, {
      query: "최고금리 기본금리 우대조건",
      productType: "deposit",
      effectiveOn: "2026-09-01",
      minScore: 0.6
    });

    expect(evidence).toEqual([]);
  });

  it("rejects duplicate explicit regulatory ids and clones persisted mutable inputs", async () => {
    const store = createMockReviewStore([]);
    const otherScope = {
      tenantId: "tenant-other",
      actorUserId: "user-other",
      actorRole: "reviewer" as const
    };

    await store.createRegulatorySource(scope, {
      id: "reg-source-shared",
      sourceType: "internal_policy_repo",
      name: "테넌트 A 기준",
      repositoryPath: "tenant-a/policy.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });

    await expect(
      store.createRegulatorySource(otherScope, {
        id: "reg-source-shared",
        sourceType: "internal_policy_repo",
        name: "테넌트 B 기준",
        repositoryPath: "tenant-b/policy.md",
        pollingSchedule: "0 9 * * *",
        trustLevel: "internal"
      })
    ).rejects.toThrow("Regulatory source id already exists");
    expect(await store.getRegulatorySource(scope, "reg-source-shared")).toMatchObject({
      tenantId: "tenant-demo",
      name: "테넌트 A 기준"
    });
    expect(await store.getRegulatorySource(otherScope, "reg-source-shared")).toBeUndefined();

    const snapshot = await store.createRegulatorySnapshot(scope, {
      id: "reg-snapshot-clone",
      sourceId: "reg-source-shared",
      title: "복사 검증 기준",
      effectiveFrom: "2026-07-01",
      contentHash: "hash-clone",
      rawStorageKey: "regulatory/raw/clone.txt",
      normalizedStorageKey: "regulatory/normalized/clone.json",
      detectedDocumentType: "internal_policy",
      fetchStatus: "fetched",
      normalizationConfidence: 0.97
    });
    const changeInput = {
      id: "reg-change-clone",
      sourceId: "reg-source-shared",
      newSnapshotId: snapshot.id,
      changeType: "created" as const,
      changeSummary: "최고금리 표시 기준이 신설되었습니다.",
      changedSections: [
        {
          sectionId: "section-001",
          title: "최고금리 표시",
          newText: "최고금리 표현 시 기본금리와 우대조건을 인접 표시한다.",
          diffSummary: "신설 조항입니다.",
          citation: { snapshotId: snapshot.id, sectionId: "section-001" }
        }
      ],
      effectiveFrom: "2026-07-01",
      riskImpactLevel: "high" as const,
      interpretationSummary: "예금 최고금리 단독 강조를 제한합니다.",
      mappedProductTypes: ["deposit" as const],
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"],
      qualityGateStatus: "passed" as const,
      confidence: 0.93
    };
    const chunkInput = {
      id: "chunk-clone-001",
      tenantId: scope.tenantId,
      knowledgeDocumentId: "knowledge-clone",
      chunkText: "최고금리 표현 시 기본금리와 우대조건을 인접 표시한다.",
      chunkSummary: "최고금리 표시 기준",
      embeddingModel: "deterministic",
      embeddingId: "embedding-clone-001",
      metadata: { source: "regulatory_change_set" },
      chunkStatus: "active" as const,
      impactTags: ["deposit", "rate_display"],
      effectiveFrom: "2026-07-01"
    };

    const changeSet = await store.createRegulatoryChangeSet(scope, changeInput);
    await store.activateRegulatoryChangeSet(scope, {
      changeSetId: changeSet.id,
      document: {
        id: "knowledge-clone",
        documentType: "internal_policy",
        productType: "deposit",
        title: "복사 검증 기준",
        version: "2026.07",
        effectiveFrom: "2026-07-01",
        storageKey: "generated/regulatory/clone.md",
        canonicalKey: "internal-policy:clone",
        sourceSnapshotId: snapshot.id,
        changeSetId: changeSet.id
      },
      chunks: [chunkInput]
    });

    changeInput.changedSections[0].newText = "외부 mutation";
    changeInput.mappedChannels.push("mutated_channel");
    chunkInput.impactTags.push("mutated_tag");

    expect(await store.getRegulatoryChangeSet(scope, changeSet.id)).toMatchObject({
      changedSections: [
        expect.objectContaining({
          newText: "최고금리 표현 시 기본금리와 우대조건을 인접 표시한다."
        })
      ],
      mappedChannels: ["mobile_banner"]
    });
    expect(await store.listEvidenceChunksForTest(scope, "knowledge-clone")).toEqual([
      expect.objectContaining({
        impactTags: ["deposit", "rate_display"]
      })
    ]);
  });

  it("validates change set snapshots by tenant and source and sorts gate results", async () => {
    const store = createMockReviewStore([]);
    const source = await store.createRegulatorySource(scope, {
      id: "reg-source-validation",
      sourceType: "internal_policy_repo",
      name: "검증 기준",
      repositoryPath: "internal/validation.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });
    const otherSource = await store.createRegulatorySource(scope, {
      id: "reg-source-validation-other",
      sourceType: "internal_policy_repo",
      name: "다른 기준",
      repositoryPath: "internal/other.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });
    const snapshot = await store.createRegulatorySnapshot(scope, {
      id: "reg-snapshot-validation",
      sourceId: source.id,
      title: "검증 기준",
      effectiveFrom: "2026-07-01",
      contentHash: "hash-validation",
      rawStorageKey: "regulatory/raw/validation.txt",
      normalizedStorageKey: "regulatory/normalized/validation.json",
      detectedDocumentType: "internal_policy",
      fetchStatus: "fetched",
      normalizationConfidence: 0.97
    });
    const otherSnapshot = await store.createRegulatorySnapshot(scope, {
      id: "reg-snapshot-validation-other",
      sourceId: otherSource.id,
      title: "다른 기준",
      effectiveFrom: "2026-07-01",
      contentHash: "hash-validation-other",
      rawStorageKey: "regulatory/raw/validation-other.txt",
      normalizedStorageKey: "regulatory/normalized/validation-other.json",
      detectedDocumentType: "internal_policy",
      fetchStatus: "fetched",
      normalizationConfidence: 0.97
    });

    await expect(
      store.createRegulatoryChangeSet(scope, {
        id: "reg-change-wrong-source-snapshot",
        sourceId: source.id,
        newSnapshotId: otherSnapshot.id,
        changeType: "created",
        changeSummary: "잘못된 스냅샷 참조",
        changedSections: [],
        effectiveFrom: "2026-07-01",
        riskImpactLevel: "high",
        interpretationSummary: "잘못된 참조입니다.",
        mappedProductTypes: ["deposit"],
        mappedChannels: ["mobile_banner"],
        mappedReviewCategories: ["rate_display"],
        qualityGateStatus: "passed",
        confidence: 0.9
      })
    ).rejects.toThrow("Regulatory source or snapshot not found");

    const changeSet = await store.createRegulatoryChangeSet(scope, {
      id: "reg-change-gate-sort",
      sourceId: source.id,
      newSnapshotId: snapshot.id,
      changeType: "created",
      changeSummary: "게이트 정렬 검증",
      changedSections: [
        {
          sectionId: "section-001",
          title: "최고금리 표시",
          newText: "최고금리 표현 시 조건을 인접 표시한다.",
          diffSummary: "신설 조항입니다.",
          citation: { snapshotId: snapshot.id, sectionId: "section-001" }
        }
      ],
      effectiveFrom: "2026-07-01",
      riskImpactLevel: "high",
      interpretationSummary: "게이트 정렬을 검증합니다.",
      mappedProductTypes: ["deposit"],
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"],
      qualityGateStatus: "passed",
      confidence: 0.9
    });
    const results = await store.replaceQualityGateResults(scope, changeSet.id, [
      {
        id: "gate-b",
        changeSetId: changeSet.id,
        gateType: "schema_validation",
        status: "passed",
        summary: "B",
        evidence: {},
        createdAt: "2026-05-31T00:00:01.000Z"
      },
      {
        id: "gate-a",
        changeSetId: changeSet.id,
        gateType: "citation_coverage",
        status: "passed",
        summary: "A",
        evidence: {},
        createdAt: "2026-05-31T00:00:00.000Z"
      }
    ]);

    expect(results?.map((result) => result.id)).toEqual(["gate-a", "gate-b"]);
    await expect(store.listQualityGateResults(scope, changeSet.id)).resolves.toEqual(results);
  });

  it("supersedes prior active chunks when activating a newer canonical regulatory document", async () => {
    const store = createMockReviewStore([]);
    const source = await store.createRegulatorySource(scope, {
      id: "reg-source-canonical",
      sourceType: "internal_policy_repo",
      name: "예금 광고 내부 기준",
      repositoryPath: "internal/policies/deposit-ad.md",
      pollingSchedule: "0 9 * * *",
      trustLevel: "internal"
    });
    const firstSnapshot = await store.createRegulatorySnapshot(scope, {
      id: "reg-snapshot-canonical-202607",
      sourceId: source.id,
      title: "예금 광고 내부 기준",
      effectiveFrom: "2026-07-01",
      contentHash: "hash-canonical-202607",
      rawStorageKey: "regulatory/raw/reg-snapshot-canonical-202607.txt",
      normalizedStorageKey: "regulatory/normalized/reg-snapshot-canonical-202607.json",
      detectedDocumentType: "internal_policy",
      fetchStatus: "fetched",
      normalizationConfidence: 0.97
    });
    const secondSnapshot = await store.createRegulatorySnapshot(scope, {
      id: "reg-snapshot-canonical-202608",
      sourceId: source.id,
      title: "예금 광고 내부 기준",
      effectiveFrom: "2026-08-01",
      contentHash: "hash-canonical-202608",
      rawStorageKey: "regulatory/raw/reg-snapshot-canonical-202608.txt",
      normalizedStorageKey: "regulatory/normalized/reg-snapshot-canonical-202608.json",
      detectedDocumentType: "internal_policy",
      fetchStatus: "fetched",
      normalizationConfidence: 0.97
    });
    const firstChangeSet = await store.createRegulatoryChangeSet(scope, {
      id: "reg-change-canonical-202607",
      sourceId: source.id,
      newSnapshotId: firstSnapshot.id,
      changeType: "created",
      changeSummary: "최고금리 표시 기준이 신설되었습니다.",
      changedSections: [],
      effectiveFrom: "2026-07-01",
      riskImpactLevel: "high",
      interpretationSummary: "예금 최고금리 단독 강조를 제한합니다.",
      mappedProductTypes: ["deposit"],
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"],
      qualityGateStatus: "passed",
      confidence: 0.91
    });
    const secondChangeSet = await store.createRegulatoryChangeSet(scope, {
      id: "reg-change-canonical-202608",
      sourceId: source.id,
      previousSnapshotId: firstSnapshot.id,
      newSnapshotId: secondSnapshot.id,
      changeType: "amended",
      changeSummary: "최고금리 표시 기준이 개정되었습니다.",
      changedSections: [],
      effectiveFrom: "2026-08-01",
      riskImpactLevel: "high",
      interpretationSummary: "예금 최고금리 인접 표시 기준을 강화합니다.",
      mappedProductTypes: ["deposit"],
      mappedChannels: ["mobile_banner"],
      mappedReviewCategories: ["rate_display"],
      qualityGateStatus: "passed",
      confidence: 0.94
    });

    await store.activateRegulatoryChangeSet(scope, {
      changeSetId: firstChangeSet.id,
      document: {
        id: "knowledge-canonical-202607",
        documentType: "internal_policy",
        productType: "deposit",
        title: "예금 광고 내부 기준",
        version: "2026.07",
        effectiveFrom: "2026-07-01",
        storageKey: "generated/regulatory/reg-change-canonical-202607.md",
        canonicalKey: "internal-policy:deposit-ad",
        sourceSnapshotId: firstSnapshot.id,
        changeSetId: firstChangeSet.id
      },
      chunks: [
        {
          id: "chunk-canonical-202607-001",
          tenantId: scope.tenantId,
          knowledgeDocumentId: "knowledge-canonical-202607",
          chunkText: "최고금리 표현 시 기본금리와 우대조건을 인접 표시한다.",
          chunkSummary: "최고금리 표시 기준",
          embeddingModel: "deterministic",
          embeddingId: "embedding-canonical-202607-001",
          metadata: { source: "regulatory_change_set" },
          chunkStatus: "active",
          effectiveFrom: "2026-07-01",
          effectiveTo: "2026-07-15"
        }
      ]
    });

    await store.activateRegulatoryChangeSet(scope, {
      changeSetId: secondChangeSet.id,
      document: {
        id: "knowledge-canonical-202608",
        documentType: "internal_policy",
        productType: "deposit",
        title: "예금 광고 내부 기준",
        version: "2026.08",
        effectiveFrom: "2026-08-01",
        storageKey: "generated/regulatory/reg-change-canonical-202608.md",
        canonicalKey: "internal-policy:deposit-ad",
        sourceSnapshotId: secondSnapshot.id,
        changeSetId: secondChangeSet.id,
        supersedesDocumentId: "knowledge-canonical-202607"
      },
      chunks: [
        {
          id: "chunk-canonical-202608-001",
          tenantId: scope.tenantId,
          knowledgeDocumentId: "knowledge-canonical-202608",
          chunkText: "최고금리 표현 시 기본금리와 우대조건을 더 크게 인접 표시한다.",
          chunkSummary: "개정 최고금리 표시 기준",
          embeddingModel: "deterministic",
          embeddingId: "embedding-canonical-202608-001",
          metadata: { source: "regulatory_change_set" },
          chunkStatus: "active",
          effectiveFrom: "2026-08-01"
        }
      ]
    });

    const documents = await store.listKnowledgeDocuments(scope);
    const oldChunks = await store.listEvidenceChunksForTest(scope, "knowledge-canonical-202607");
    const newChunks = await store.listEvidenceChunksForTest(scope, "knowledge-canonical-202608");
    const oldEvidence = await store.searchKnowledgeEvidence(scope, {
      query: "최고금리 기본금리 우대조건",
      productType: "deposit",
      effectiveOn: "2026-07-15",
      minScore: 0.6
    });
    const expiredOldEvidence = await store.searchKnowledgeEvidence(scope, {
      query: "최고금리 기본금리 우대조건",
      productType: "deposit",
      effectiveOn: "2026-07-20",
      minScore: 0.6
    });
    const evidence = await store.searchKnowledgeEvidence(scope, {
      query: "최고금리 기본금리 우대조건",
      productType: "deposit",
      effectiveOn: "2026-08-02",
      minScore: 0.6
    });

    expect(documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "knowledge-canonical-202607",
          lifecycleStatus: "superseded"
        }),
        expect.objectContaining({
          id: "knowledge-canonical-202608",
          lifecycleStatus: "active"
        })
      ])
    );
    expect(oldChunks).toEqual([
      expect.objectContaining({
        id: "chunk-canonical-202607-001",
        chunkStatus: "superseded",
        effectiveTo: "2026-07-15"
      })
    ]);
    expect(newChunks).toEqual([
      expect.objectContaining({
        id: "chunk-canonical-202608-001",
        chunkStatus: "active"
      })
    ]);
    expect(oldEvidence[0]).toMatchObject({
      documentId: "knowledge-canonical-202607",
      chunkId: "chunk-canonical-202607-001",
      version: "2026.07"
    });
    expect(expiredOldEvidence).toEqual([]);
    expect(evidence[0]).toMatchObject({
      documentId: "knowledge-canonical-202608",
      chunkId: "chunk-canonical-202608-001",
      version: "2026.08"
    });
  });
});

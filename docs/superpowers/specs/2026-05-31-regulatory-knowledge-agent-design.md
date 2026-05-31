# Regulatory Knowledge Agent Design

## Goal

Add an operational Regulatory Knowledge Agent to FinProof that automatically tracks external
financial regulations, industry guidance, internal review standards, and prior case knowledge, then
updates the RAG knowledge base when source-grounded changes are detected.

The product outcome is that advertising review agents use the latest applicable knowledge in the
next review cycle without waiting for manual document registration or reviewer retraining.

## Problem

When financial regulations or internal standards change, review teams often need to discover the
change, interpret it, update internal checklists, and redistribute the updated criteria before the
field can act on it. That delay creates response risk: newly submitted advertisements may be judged
against outdated criteria, and reviewers may miss changed disclosure or prohibited-expression
requirements.

FinProof already supports evidence-based financial advertising review with approved knowledge
documents, evidence chunks, RAG retrieval, agent findings, review issues, and audit logs. This design
extends that foundation from manually managed knowledge to automatically updated regulatory
knowledge.

## Scope Decisions

- Source scope includes external regulations, industry association standards, internal review
  checklists, prohibited-expression guides, and prior review case knowledge.
- Automation scope is knowledge-base activation. The system can automatically activate new
  `KnowledgeDocument` and `EvidenceChunk` versions after quality gates pass.
- Out of scope for this slice: automatic business workflow control, automatic recall of active
  campaigns, automatic rule deployment for hard-coded review rules, overseas jurisdiction review,
  and full human approval workflow.
- The design treats final review responsibility as unchanged. The review workflow remains inside
  FinProof's existing reviewer process; the automated part is keeping the evidence base current.

## Current Baseline

The existing codebase already has the right extension points:

- `KnowledgeDocument` stores tenant-scoped law, internal policy, checklist, and guide documents.
- `EvidenceChunk` stores searchable knowledge and review-file chunks for RAG retrieval.
- `ReviewAnalysisPipeline` retrieves evidence candidates and passes them into review sub-agents.
- `ReviewSubAgentOrchestrator` merges domain findings through a main compliance agent.
- `AuditLog` records review, analysis, issue, knowledge, draft, and report events.
- `KnowledgeDocumentRegistry` gives administrators a manual knowledge-document path.

This design adds regulatory source tracking, snapshots, change sets, automated versioning, quality
gates, and regulatory-change UI surfaces around those existing models.

## Target Architecture

```text
External and internal regulatory sources
  -> Source Watcher Agent
  -> Document Normalizer Agent
  -> Change Diff Agent
  -> Regulatory Interpretation Agent
  -> Impact Mapping Agent
  -> Quality Gate Runner
  -> Knowledge Versioning Agent
  -> RAG Index Update Agent
  -> FinProof Review Agents
```

The key design choice is to insert interpretation and impact mapping between raw document ingestion
and RAG indexing. FinProof should not merely store the latest file. It should know what changed,
what the change means for financial advertising review, which products or channels are affected,
and which new evidence chunks supersede older evidence.

## Agent Responsibilities

### Source Watcher Agent

Tracks configured sources and creates immutable snapshots when content changes.

Responsibilities:

- Poll regulator, law portal, industry association, internal policy repository, and case-knowledge
  sources.
- Record source URL or repository path, publication date, effective date, content hash, fetch status,
  and source trust level.
- Detect new, amended, deleted, or unreachable source documents.
- Avoid duplicate ingestion when the content hash has not changed.

### Document Normalizer Agent

Converts raw source material into stable section-level text.

Responsibilities:

- Normalize PDF, HTML, DOCX, HWP-converted text, spreadsheets, and internal markdown where
  available.
- Preserve document title, section number, clause number, table labels, appendix labels, effective
  dates, and footnotes.
- Emit stable section identifiers so future diffing can compare section to section instead of
  document to document.
- Mark low-confidence extraction regions for quality-gate handling.

### Change Diff Agent

Compares the new normalized snapshot with the active prior snapshot.

Responsibilities:

- Classify changes as `created`, `amended`, `deleted`, `wording_changed`,
  `effective_date_changed`, `scope_changed`, or `interpretation_changed`.
- Produce section-level previous text, new text, and diff summaries.
- Identify superseded sections and newly effective sections.
- Keep all changed sections tied to source snapshot ids and normalized section ids.

### Regulatory Interpretation Agent

Translates source-grounded changes into review-team language.

Responsibilities:

- Explain the advertising review meaning of each changed section.
- Identify likely review concerns such as mandatory disclosure strengthening, rate-expression
  limits, comparative advertising conditions, eligibility overstatement, risk-warning expansion, or
  prohibited guarantee language.
- Preserve source citations for every interpretation.
- Avoid unsupported legal conclusions that are not grounded in changed source text.

### Impact Mapping Agent

Maps interpreted changes to FinProof review dimensions.

Responsibilities:

- Map changes to product types: deposit, loan, card, capital, insurance, and investment.
- Map changes to channel types such as mobile banner, landing page, outbound message, SNS, branch
  poster, or short-form copy.
- Map changes to review categories such as rate display, eligibility, fees, risk notice, guarantee
  expression, comparison claim, and required disclosure.
- Generate impact tags used by RAG filtering and UI explanations.

### Quality Gate Runner

Validates that automatically activated knowledge is grounded, structured, retrievable, and
date-safe.

Responsibilities:

- Reject unsupported interpretations without source citations.
- Reject malformed or incomplete structured output.
- Flag conflicts between internal standards and higher-priority external regulation.
- Run retrieval regression checks against representative review cases.
- Ensure effective-date rules are respected before active knowledge is exposed to review agents.

### Knowledge Versioning Agent

Creates versioned FinProof knowledge records after quality gates pass.

Responsibilities:

- Create a new `KnowledgeDocument` version with source snapshot and change-set references.
- Mark superseded document versions and chunks without deleting them.
- Create new `EvidenceChunk` rows with canonical section keys, impact tags, and effective dates.
- Preserve rollback links to the prior active version.

### RAG Index Update Agent

Activates the new searchable knowledge.

Responsibilities:

- Generate embeddings for new or changed chunks.
- Remove superseded chunks from active retrieval while keeping them auditable.
- Verify that representative queries retrieve the new active chunks.
- Make the new knowledge available to the existing review analysis pipeline.

## Data Flow

1. A regulatory source is checked on schedule.
2. The source watcher creates a new snapshot when content hash or source metadata changes.
3. The normalizer converts the raw document into section-level text.
4. The diff agent compares the new snapshot with the current active snapshot.
5. The interpretation agent summarizes review impact with citations.
6. The impact mapper tags affected products, channels, and review categories.
7. Quality gates validate citations, schema, dates, contradictions, and retrieval behavior.
8. The versioning agent creates new knowledge document and chunk versions.
9. The RAG index update agent embeds and activates the new chunks.
10. Future review analysis retrieves active knowledge according to effective date and relevance.

## Data Model

### RegulatorySource

Represents a tracked source.

Key fields:

- `id`
- `tenantId`
- `sourceType`: `regulator`, `law_portal`, `association`, `internal_policy_repo`,
  `case_knowledge`
- `name`
- `url` or `repositoryPath`
- `pollingSchedule`
- `trustLevel`
- `lastCheckedAt`
- `status`

### RegulatorySnapshot

Represents an immutable collected source version.

Key fields:

- `id`
- `sourceId`
- `sourceUrl`
- `title`
- `publishedAt`
- `effectiveFrom`
- `contentHash`
- `rawStorageKey`
- `normalizedStorageKey`
- `detectedDocumentType`
- `fetchStatus`
- `normalizationConfidence`

### RegulatoryChangeSet

Represents a detected and interpreted change between snapshots.

Key fields:

- `id`
- `previousSnapshotId`
- `newSnapshotId`
- `changeType`
- `changeSummary`
- `changedSections`
- `effectiveFrom`
- `riskImpactLevel`
- `interpretationSummary`
- `mappedProductTypes`
- `mappedChannels`
- `mappedReviewCategories`
- `qualityGateStatus`
- `confidence`

### KnowledgeDocument Extensions

Extend the current model with:

- `canonicalKey`: logical key grouping versions of the same standard.
- `sourceSnapshotId`
- `changeSetId`
- `supersedesDocumentId`
- `lifecycleStatus`: `active`, `superseded`, `inactive`
- `autoIngested`
- `sourcePublishedAt`
- `interpretationSummary`

When a change set passes quality gates, the new document version can be created with
`approvalStatus = approved` and `lifecycleStatus = active`. The prior active version becomes
`superseded`.

### EvidenceChunk Extensions

Extend the current model with:

- `canonicalSectionKey`
- `sectionNumber`
- `changeSetId`
- `supersedesChunkId`
- `chunkStatus`: `active`, `superseded`, `inactive`
- `impactTags`
- `effectiveFrom`
- `sourceReliability`

Review-time retrieval should prefer active chunks whose effective dates apply to the planned
advertising publication date.

### QualityGateResult

Stores automated validation outcomes for a change set.

Key fields:

- `id`
- `changeSetId`
- `gateType`: `citation_coverage`, `schema_validation`, `contradiction_check`,
  `retrieval_regression`, `effective_date`, `rollback_ready`
- `status`: `passed`, `failed`, `flagged`
- `summary`
- `evidence`
- `createdAt`

### Audit Events

Add audit actions:

- `regulatory_source.checked`
- `regulatory_snapshot.created`
- `regulatory_change.detected`
- `regulatory_change.interpreted`
- `regulatory_change.quality_gate_passed`
- `regulatory_change.quality_gate_failed`
- `knowledge_document.auto_versioned`
- `evidence_chunk.reindexed`
- `knowledge_base.rollback`

Audit payloads should store ids, summaries, statuses, and source references. They should not store
large raw text bodies.

## Quality Gates

### Citation Coverage Gate

Every change summary, interpretation, and impact mapping must cite source section ids or paragraph
ids. Unsupported interpretations fail and are not activated.

### Schema Validation Gate

Agent outputs must match strict JSON schemas. Required fields include change type, effective date,
changed sections, mapped products, mapped categories, confidence, and source snapshot id.

### Contradiction Check Gate

New internal standards are checked against higher-priority external regulation and association
guidance. Conflicts are flagged. When active knowledge contains conflicts, review retrieval should
prefer the stricter or higher-priority source.

### Retrieval Regression Gate

Representative review cases are re-run against the updated index. If a relevant new chunk cannot be
retrieved for the affected product/category, activation fails.

### Effective-Date Gate

Knowledge is activated with effective dates. Review agents should consider the planned publication
date, not only the current date, when selecting applicable evidence.

### Rollback Gate

Each auto-activated version must have a known previous active version and a rollback path before it
can become active.

## Review-Time Retrieval Rules

- Retrieve only active chunks by default.
- Include superseded chunks only when explaining historical reviews or version timelines.
- Prefer chunks applicable to the review case's planned publish date.
- Rank higher-priority source types above lower-priority internal or case-history evidence when
  relevance is similar.
- Include change-set metadata in evidence explanations when a finding depends on a recently changed
  standard.

## UI Surfaces

### Regulatory Watch Dashboard

Shows tracked source health and recent change activity.

Key elements:

- Tracked source list.
- Last checked time.
- New, amended, deleted, and failed counts.
- Auto-activation success and failure counts.
- Quality-gate pass rate.

### Change Set Detail

Shows how a source change became active knowledge.

Key elements:

- Source title and URL.
- Previous text and new text.
- Change type and effective date.
- AI interpretation summary.
- Product, channel, and review-category mappings.
- Created knowledge document version.
- Created and superseded evidence chunks.
- Quality-gate results.
- Audit event timeline.

### Review Evidence Timeline

Shows which regulatory version affected a review finding.

Key elements:

- Review time and planned publish date.
- Applied knowledge version.
- Previous version summary.
- Change reason for the current risk assessment.
- Evidence quote summary and source citation.

## Demo Scenario

Use a deposit advertisement:

```text
최대 연 5.0%, 누구나 최고금리 혜택
```

Before the update, FinProof identifies a conditional disclosure issue and recommends adding
preferential-rate conditions.

The Regulatory Knowledge Agent then detects a new or amended internal standard requiring stronger
near-copy disclosure for maximum-rate claims:

```text
최고금리 표현 시 기본금리, 우대조건, 적용 한도, 적용 기간을 인접 영역에 함께 표시해야 한다.
```

The agent maps the change to deposit products, rate display, short copy, and mobile banner review.
After the knowledge base is automatically versioned and reindexed, the same advertisement is
reviewed again. The review agents now cite the new active standard and raise the issue severity,
recommending copy such as:

```text
기본금리 연 2.0%, 우대조건 충족 시 최고 연 5.0%
```

This demonstrates that a regulation or internal-standard change is reflected in review evidence
without a manual knowledge upload step.

## MVP Scope

Included:

- Regulatory source registration and source health tracking.
- Snapshot creation with content hashing.
- Section-level normalization.
- Change-set detection.
- AI interpretation and impact mapping.
- Automated knowledge document and evidence chunk versioning.
- Quality gates for citation, schema, contradiction, retrieval regression, effective date, and
  rollback readiness.
- Audit events for source checks, change detection, activation, indexing, and rollback.
- UI surfaces for source dashboard, change-set detail, and review evidence timeline.

Excluded:

- Hard-coded rule deployment.
- Existing campaign recall and review queue automation.
- Full regulator API coverage for every source.
- Human approval workflow.
- Overseas regulation interpretation.
- Perfect PDF/HWP extraction for every document form.

## Roadmap

Phase 1: Regulatory Knowledge Auto-Update

Automatically update RAG knowledge from changed regulatory and internal sources. This design covers
this phase.

Phase 2: Rule Suggestion Agent

Generate suggested prohibited expressions, required disclosures, risk levels, and checklist changes
from active change sets. Suggestions are not automatically deployed in this phase.

Phase 3: Active Campaign Impact Scan

Match active or previously approved advertisements against regulatory change impact tags and create
candidate re-review queues.

Phase 4: Autonomous Rule Deployment

Deploy low-risk machine-readable rule changes automatically after enough quality-gate performance
history exists.

## Risks And Mitigations

- Incorrect AI interpretation: require citation coverage, structured schemas, and contradiction
  checks before activation.
- Poor document extraction: store normalization confidence and fail quality gates for uncertain
  sections.
- Retrieval drift: run regression queries before active indexing.
- Effective-date errors: bind every change set and chunk to applicability dates and review planned
  publication dates.
- Audit gaps: store snapshot, change set, generated knowledge version, gate result, and rollback
  ids in audit events.
- Scope creep: keep MVP limited to knowledge-base activation and leave rule deployment and campaign
  recall to later phases.

## Acceptance Criteria

- A compliance administrator can register tracked regulatory and internal sources.
- The source watcher creates a new snapshot only when source content or relevant metadata changes.
- The diff agent emits section-level change sets with previous text, new text, change type, and
  source citations.
- The interpretation and impact agents map changes to product types, channels, and review
  categories.
- Quality gates block activation when citations, schema, effective dates, retrieval regression, or
  rollback readiness fail.
- Passing change sets automatically create active knowledge document and evidence chunk versions.
- Superseded document and chunk versions remain available for historical audit.
- Review analysis retrieves newly active chunks for applicable future reviews.
- Review evidence can show which regulatory change set caused a current finding.
- Audit logs connect source check, snapshot, change detection, interpretation, versioning, indexing,
  and rollback events.

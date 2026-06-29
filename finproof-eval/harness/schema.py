"""
FinProof eval — data contracts.

These models mirror the TypeScript types FinProof already emits
(AgentFinding, RagEvidenceCandidate, RiskLevel, suggestedAction).
The harness runs OFFLINE on exported review outputs, so nothing here
imports or depends on the FinProof codebase — it only agrees on shapes.

Keep RISK_LEVELS / SUGGESTED_ACTIONS in sync with
  src/server/analysis/risk-policy.ts
  (agentInput.outputSchema.allowedSuggestedActions)
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# --- enums (mirror risk-policy.ts) -----------------------------------------
# riskRank in the TS code is ordered; we encode the same ordering so that
# "under-classification" (predicting lower risk than truth) is detectable.
class RiskLevel(str, Enum):
    info = "info"
    low = "low"
    medium = "medium"
    high = "high"


RISK_ORDER = {RiskLevel.info: 0, RiskLevel.low: 1, RiskLevel.medium: 2, RiskLevel.high: 3}


class SuggestedAction(str, Enum):
    approve = "approve"
    change_request = "change_request"
    hold = "hold"


# --- RAG layer (mirror RagEvidenceCandidate) --------------------------------
class EvidenceCandidate(BaseModel):
    id: str
    title: str
    quote_summary: str = Field(alias="quoteSummary")
    relevance_score: float = Field(alias="relevanceScore")
    source_type: str = Field(alias="sourceType")  # law | internal_policy | case_history | product_doc
    document_id: Optional[str] = Field(default=None, alias="documentId")

    class Config:
        populate_by_name = True


# --- agent output (mirror AgentFinding) -------------------------------------
class Finding(BaseModel):
    id: str
    agent: str
    issue_type: str = Field(alias="issueType")
    risk_level: RiskLevel = Field(alias="riskLevel")
    title: str
    target_text: str = Field(alias="targetText")
    description: str
    suggested_action: SuggestedAction = Field(alias="suggestedAction")
    evidence_candidate_ids: list[str] = Field(default_factory=list, alias="evidenceCandidateIds")
    confidence: float = 0.72

    class Config:
        populate_by_name = True


class ReviewOutput(BaseModel):
    """One review case as FinProof actually produced it (the system-under-test)."""
    review_case_id: str = Field(alias="reviewCaseId")
    retrieved_evidence: list[EvidenceCandidate] = Field(default_factory=list, alias="retrievedEvidence")
    findings: list[Finding] = Field(default_factory=list)
    # operational signals from the router/orchestrator
    escalated: bool = False
    model_tier_used: Optional[str] = Field(default=None, alias="modelTierUsed")

    class Config:
        populate_by_name = True


# --- gold labels (mined from reviewer overrides in the audit log) -----------
class GoldFinding(BaseModel):
    """A violation a human reviewer confirmed should exist."""
    issue_type: str
    target_text: str            # the offending copy span the reviewer flagged
    risk_level: RiskLevel       # reviewerRiskLevel
    final_action: SuggestedAction  # finalAction
    # ids of evidence chunks a reviewer considered the *correct* basis (optional)
    relevant_evidence_ids: list[str] = Field(default_factory=list)


class GoldCase(BaseModel):
    review_case_id: str
    # the full set of evidence ids that *should* be retrievable for this case
    # (used for context recall). Optional — recall is skipped if absent.
    gold_relevant_evidence_ids: list[str] = Field(default_factory=list)
    expected_findings: list[GoldFinding] = Field(default_factory=list)
    # if the case is a clean ad with no violations, expected_findings == []
    is_clean: bool = False


class EvalPair(BaseModel):
    """One aligned (gold, system output) row."""
    gold: GoldCase
    output: ReviewOutput

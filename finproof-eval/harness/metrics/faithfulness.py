"""
LLM-as-judge — the only metric that needs a model.

Measures FAITHFULNESS: is each claim in a finding's `description` actually
supported by the evidence the finding cites? Anything unsupported is a
hallucination. We deliberately use a *different, stronger* model than the
one under test to avoid self-preference bias.

Provider-agnostic: pass any callable `complete(system, user) -> str`.
A default OpenAI/Anthropic-style fetch wrapper is provided.
"""

from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass
from typing import Callable, Protocol

from ..schema import EvalPair, Finding


class Completer(Protocol):
    def __call__(self, system: str, user: str) -> str: ...


JUDGE_SYSTEM = """You are a strict compliance-review auditor.
You are given a FINDING produced by an AI agent about a financial advertisement,
and the EVIDENCE chunks that finding cited. Decide, claim by claim, whether the
finding's reasoning is SUPPORTED by the cited evidence.

A claim is UNSUPPORTED (a hallucination) if it asserts a regulation, fact, or
obligation that does not appear in, and cannot be directly inferred from, the
cited evidence. Citing a real chunk that does not actually back the claim still
counts as unsupported.

Return ONLY JSON, no prose:
{"claims_total": <int>, "claims_supported": <int>, "verdict": "supported"|"partial"|"unsupported", "unsupported_claims": ["..."]}"""


def _judge_user(finding: Finding, evidence_texts: list[str]) -> str:
    return json.dumps(
        {
            "finding": {
                "riskLevel": finding.risk_level.value,
                "targetText": finding.target_text,
                "description": finding.description,
            },
            "citedEvidence": evidence_texts,
        },
        ensure_ascii=False,
    )


@dataclass
class FaithfulnessScore:
    findings_judged: int = 0
    claims_total: int = 0
    claims_supported: int = 0
    unsupported_findings: int = 0  # findings with verdict != "supported"

    @property
    def faithfulness(self) -> float:
        """Fraction of claims grounded in cited evidence (RAGAS-style)."""
        return self.claims_supported / self.claims_total if self.claims_total else 1.0

    @property
    def hallucination_rate(self) -> float:
        """Fraction of findings containing >=1 unsupported claim."""
        return self.unsupported_findings / self.findings_judged if self.findings_judged else 0.0


def score_faithfulness(pairs: list[EvalPair], complete: Completer) -> FaithfulnessScore:
    score = FaithfulnessScore()
    for pair in pairs:
        ev_by_id = {e.id: e for e in pair.output.retrieved_evidence}
        for finding in pair.output.findings:
            cited = [ev_by_id[i] for i in finding.evidence_candidate_ids if i in ev_by_id]
            if not cited:
                # a finding citing nothing real is fully unsupported by definition
                score.findings_judged += 1
                score.claims_total += 1
                score.unsupported_findings += 1
                continue
            texts = [f"[{e.source_type}] {e.title}: {e.quote_summary}" for e in cited]
            raw = complete(JUDGE_SYSTEM, _judge_user(finding, texts))
            parsed = _safe_json(raw)
            total = int(parsed.get("claims_total", 1) or 1)
            supported = min(int(parsed.get("claims_supported", 0) or 0), total)
            score.findings_judged += 1
            score.claims_total += total
            score.claims_supported += supported
            if parsed.get("verdict", "unsupported") != "supported":
                score.unsupported_findings += 1
    return score


def _safe_json(text: str) -> dict:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```")[1].lstrip("json").strip() if "```" in t else t
    start, end = t.find("{"), t.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(t[start : end + 1])
        except json.JSONDecodeError:
            pass
    return {}


# --- default completer (OpenAI Responses API; swap freely) ------------------
def openai_completer(model: str = "gpt-5.5") -> Completer:
    """Use a HIGH-precision model as judge — stronger than the system under test."""
    api_key = os.environ["OPENAI_API_KEY"]

    def complete(system: str, user: str) -> str:
        body = json.dumps({"model": model, "instructions": system, "input": user}).encode()
        req = urllib.request.Request(
            "https://api.openai.com/v1/responses",
            data=body,
            headers={"content-type": "application/json", "authorization": f"Bearer {api_key}"},
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
        # Responses API: prefer output_text, else dig into output[].content[]
        if isinstance(data.get("output_text"), str):
            return data["output_text"]
        for out in data.get("output", []):
            for part in out.get("content", []):
                if part.get("type") == "output_text":
                    return part.get("text", "")
        return ""

    return complete

"""
Deterministic metrics — no LLM needed, compare system output to gold labels.

These are the highest-ROI layer: risk/action accuracy, issue detection,
citation validity, escalation appropriateness, confidence calibration,
and the retrieval metrics (precision/recall + the 0.72 threshold sweep).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from ..schema import (
    EvalPair,
    Finding,
    GoldCase,
    GoldFinding,
    RISK_ORDER,
    ReviewOutput,
    RiskLevel,
)


# --- matching: align predicted findings to gold findings --------------------
def _norm(text: str) -> set[str]:
    return {t for t in "".join(c if c.isalnum() else " " for c in text.lower()).split() if len(t) >= 2}


def _overlap(a: str, b: str) -> float:
    sa, sb = _norm(a), _norm(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def match_findings(
    preds: list[Finding], golds: list[GoldFinding], threshold: float = 0.4
) -> tuple[list[tuple[Finding, GoldFinding]], list[Finding], list[GoldFinding]]:
    """Greedy bipartite match on target_text overlap. Returns (matched, false_positives, missed)."""
    remaining_gold = list(golds)
    matched: list[tuple[Finding, GoldFinding]] = []
    false_positives: list[Finding] = []

    for pred in preds:
        best, best_score = None, threshold
        for g in remaining_gold:
            s = _overlap(pred.target_text, g.target_text)
            if s >= best_score:
                best, best_score = g, s
        if best is not None:
            matched.append((pred, best))
            remaining_gold.remove(best)
        else:
            false_positives.append(pred)

    return matched, false_positives, remaining_gold  # remaining_gold == missed


# --- Layer 3: issue detection (precision / recall / F1) ---------------------
@dataclass
class DetectionScore:
    tp: int = 0
    fp: int = 0
    fn: int = 0

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if (self.tp + self.fp) else 0.0

    @property
    def recall(self) -> float:
        return self.tp / (self.tp + self.fn) if (self.tp + self.fn) else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if (p + r) else 0.0


def issue_detection(pairs: list[EvalPair]) -> DetectionScore:
    score = DetectionScore()
    for pair in pairs:
        matched, fps, missed = match_findings(pair.output.findings, pair.gold.expected_findings)
        score.tp += len(matched)
        score.fp += len(fps)
        score.fn += len(missed)
    return score


# --- Layer 3: risk-level accuracy (safety-weighted) -------------------------
@dataclass
class RiskScore:
    exact: int = 0
    total: int = 0
    under_classified: int = 0  # predicted LOWER risk than truth — the dangerous error
    over_classified: int = 0
    confusion: Counter = field(default_factory=Counter)

    @property
    def accuracy(self) -> float:
        return self.exact / self.total if self.total else 0.0

    @property
    def under_rate(self) -> float:
        """Fraction of decisions where the agent under-stated risk. In compliance this is the metric that matters most."""
        return self.under_classified / self.total if self.total else 0.0


def risk_accuracy(pairs: list[EvalPair]) -> RiskScore:
    score = RiskScore()
    for pair in pairs:
        matched, _, _ = match_findings(pair.output.findings, pair.gold.expected_findings)
        for pred, gold in matched:
            score.total += 1
            score.confusion[(gold.risk_level.value, pred.risk_level.value)] += 1
            if pred.risk_level == gold.risk_level:
                score.exact += 1
            elif RISK_ORDER[pred.risk_level] < RISK_ORDER[gold.risk_level]:
                score.under_classified += 1
            else:
                score.over_classified += 1
    return score


# --- Layer 3: action accuracy -----------------------------------------------
def action_accuracy(pairs: list[EvalPair]) -> float:
    correct = total = 0
    for pair in pairs:
        matched, _, _ = match_findings(pair.output.findings, pair.gold.expected_findings)
        for pred, gold in matched:
            total += 1
            correct += int(pred.suggested_action == gold.final_action)
    return correct / total if total else 0.0


# --- Layer 2: citation validity (cheap anti-hallucination guard) ------------
def citation_validity(pairs: list[EvalPair]) -> float:
    """Every cited evidence id must exist in what was actually retrieved.
    (Semantic support is checked separately by the LLM judge.)"""
    valid = total = 0
    for pair in pairs:
        available = {e.id for e in pair.output.retrieved_evidence}
        for f in pair.output.findings:
            for eid in f.evidence_candidate_ids:
                total += 1
                valid += int(eid in available)
    return valid / total if total else 1.0


# --- Layer 4: escalation appropriateness ------------------------------------
def escalation_recall(pairs: list[EvalPair]) -> float:
    """Of cases that truly contain a high-risk violation, how many escalated to a higher tier?"""
    should = escalated = 0
    for pair in pairs:
        truth_high = any(g.risk_level == RiskLevel.high for g in pair.gold.expected_findings)
        if truth_high:
            should += 1
            escalated += int(pair.output.escalated)
    return escalated / should if should else 1.0


# --- Layer 4: confidence calibration (Expected Calibration Error) -----------
def expected_calibration_error(pairs: list[EvalPair], bins: int = 10) -> float:
    rows: list[tuple[float, int]] = []  # (confidence, correct?)
    for pair in pairs:
        matched, fps, _ = match_findings(pair.output.findings, pair.gold.expected_findings)
        for pred, gold in matched:
            rows.append((pred.confidence, int(pred.risk_level == gold.risk_level)))
        for fp in fps:
            rows.append((fp.confidence, 0))  # confident-but-wrong
    if not rows:
        return 0.0
    ece, n = 0.0, len(rows)
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        bucket = [(c, ok) for c, ok in rows if (lo <= c < hi or (b == bins - 1 and c == 1.0))]
        if not bucket:
            continue
        avg_conf = sum(c for c, _ in bucket) / len(bucket)
        acc = sum(ok for _, ok in bucket) / len(bucket)
        ece += (len(bucket) / n) * abs(avg_conf - acc)
    return ece


# --- Layer 1: retrieval + the 0.72 threshold question -----------------------
def retrieval_metrics(pairs: list[EvalPair]) -> dict[str, float]:
    """Context precision/recall using gold_relevant_evidence_ids (skipped if absent)."""
    prec_num = prec_den = rec_num = rec_den = 0
    for pair in pairs:
        gold_ids = set(pair.gold.gold_relevant_evidence_ids)
        if not gold_ids:
            continue
        retrieved_ids = {e.id for e in pair.output.retrieved_evidence}
        prec_num += len(retrieved_ids & gold_ids)
        prec_den += len(retrieved_ids)
        rec_num += len(retrieved_ids & gold_ids)
        rec_den += len(gold_ids)
    return {
        "context_precision": prec_num / prec_den if prec_den else 0.0,
        "context_recall": rec_num / rec_den if rec_den else 0.0,
    }


def threshold_sweep(pairs: list[EvalPair], lo: float = 0.4, hi: float = 0.85, step: float = 0.01) -> dict[str, float]:
    """Find the relevance_score cutoff that maximizes retrieval F1.
    This is the data-driven answer to 'should the threshold be 0.72 or 0.55?'"""
    best_t, best_f1 = lo, 0.0
    t = lo
    while t <= hi:
        tp = fp = fn = 0
        for pair in pairs:
            gold_ids = set(pair.gold.gold_relevant_evidence_ids)
            if not gold_ids:
                continue
            kept = {e.id for e in pair.output.retrieved_evidence if e.relevance_score >= t}
            tp += len(kept & gold_ids)
            fp += len(kept - gold_ids)
            fn += len(gold_ids - kept)
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        if f1 > best_f1:
            best_t, best_f1 = t, f1
        t += step
    return {"best_threshold": round(best_t, 3), "best_f1": round(best_f1, 4)}

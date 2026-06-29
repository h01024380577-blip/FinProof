"""
Runner — load aligned (gold, output) pairs, compute every metric, print a scorecard.

Usage:
    # deterministic metrics only (no API key needed):
    python -m harness.runner --pairs datasets/pairs.jsonl

    # include LLM-judge faithfulness:
    OPENAI_API_KEY=... python -m harness.runner --pairs datasets/pairs.jsonl --judge

Input format (pairs.jsonl) — one JSON object per line:
    {"gold": {GoldCase...}, "output": {ReviewOutput...}}

The `output` block is whatever FinProof exported for that review case;
the `gold` block is mined from reviewer overrides (see datasets/README).
"""

from __future__ import annotations

import argparse
import json

from .metrics import decision as d
from .metrics.faithfulness import openai_completer, score_faithfulness
from .schema import EvalPair


def load_pairs(path: str) -> list[EvalPair]:
    pairs: list[EvalPair] = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                pairs.append(EvalPair.model_validate_json(line))
    return pairs


def run(pairs: list[EvalPair], use_judge: bool) -> dict:
    det = d.issue_detection(pairs)
    risk = d.risk_accuracy(pairs)
    report: dict = {
        "n_cases": len(pairs),
        # Layer 1 — retrieval
        "retrieval": d.retrieval_metrics(pairs),
        "threshold_sweep": d.threshold_sweep(pairs),
        # Layer 2 — grounding (cheap part)
        "citation_validity": round(d.citation_validity(pairs), 4),
        # Layer 3 — decision quality
        "issue_detection": {
            "precision": round(det.precision, 4),
            "recall": round(det.recall, 4),
            "f1": round(det.f1, 4),
            "tp": det.tp, "fp": det.fp, "fn": det.fn,
        },
        "risk": {
            "accuracy": round(risk.accuracy, 4),
            "under_classified_rate": round(risk.under_rate, 4),  # the safety-critical one
            "over_classified": risk.over_classified,
            "confusion": {f"{k[0]}->{k[1]}": v for k, v in risk.confusion.items()},
        },
        "action_accuracy": round(d.action_accuracy(pairs), 4),
        # Layer 4 — operational
        "escalation_recall": round(d.escalation_recall(pairs), 4),
        "confidence_ece": round(d.expected_calibration_error(pairs), 4),
    }

    if use_judge:
        f = score_faithfulness(pairs, openai_completer())
        report["faithfulness"] = round(f.faithfulness, 4)
        report["hallucination_rate"] = round(f.hallucination_rate, 4)

    return report


def print_scorecard(r: dict) -> None:
    print("\n" + "=" * 52)
    print(f"  FinProof eval — {r['n_cases']} cases")
    print("=" * 52)
    print("\n  [L1] Retrieval")
    print(f"    context precision      {r['retrieval']['context_precision']:.3f}")
    print(f"    context recall         {r['retrieval']['context_recall']:.3f}")
    print(f"    optimal threshold      {r['threshold_sweep']['best_threshold']} "
          f"(F1={r['threshold_sweep']['best_f1']:.3f})")
    print("\n  [L2] Grounding")
    print(f"    citation validity      {r['citation_validity']:.3f}")
    if "faithfulness" in r:
        print(f"    faithfulness           {r['faithfulness']:.3f}")
        print(f"    hallucination rate     {r['hallucination_rate']:.3f}")
    print("\n  [L3] Decision quality")
    det, risk = r["issue_detection"], r["risk"]
    print(f"    issue detection F1     {det['f1']:.3f}  (P {det['precision']:.3f} / R {det['recall']:.3f})")
    print(f"    risk accuracy          {risk['accuracy']:.3f}")
    print(f"    >> under-class. rate   {risk['under_classified_rate']:.3f}  (lower is safer)")
    print(f"    action accuracy        {r['action_accuracy']:.3f}")
    print("\n  [L4] Operational")
    print(f"    escalation recall      {r['escalation_recall']:.3f}")
    print(f"    confidence ECE         {r['confidence_ece']:.3f}  (lower is better)")
    print("=" * 52 + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", required=True)
    ap.add_argument("--judge", action="store_true", help="run LLM-as-judge faithfulness (needs OPENAI_API_KEY)")
    ap.add_argument("--out", help="write full report JSON here")
    args = ap.parse_args()

    pairs = load_pairs(args.pairs)
    report = run(pairs, use_judge=args.judge)
    print_scorecard(report)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
        print(f"  full report -> {args.out}\n")


if __name__ == "__main__":
    main()

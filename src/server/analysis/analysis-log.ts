/**
 * Structured single-line JSON logging for the analysis pipeline.
 *
 * Each event is emitted as one JSON line to stdout, which systemd redirects to
 * /var/log/finproof/analysis-worker.log and the CloudWatch Agent ships to the
 * /finproof/analysis-worker log group. Emitting one compact JSON object per line
 * lets CloudWatch Logs Insights auto-extract fields (evt, stage, case, agent, …)
 * and streams each stage in near real-time while an analysis is still running.
 *
 * Logging must never break analysis, so serialization failures are swallowed.
 */
export function logAnalysisEvent(payload: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify({ evt: "analysis", ts: new Date().toISOString(), ...payload }));
  } catch {
    // ignore logging/serialization failures — observability must not affect the run
  }
}

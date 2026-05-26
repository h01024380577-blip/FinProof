export function sampleDataEnabled(env: Record<string, string | undefined> = process.env) {
  return env.FINPROOF_ENABLE_SAMPLE_DATA === "true";
}

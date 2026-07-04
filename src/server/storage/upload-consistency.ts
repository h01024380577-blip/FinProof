type Env = Record<string, string | undefined>;

export type UploadStorageConsistency = {
  risky: boolean;
  adapter: string;
  dbHost?: string;
  detail: string;
};

const LOCAL_DB_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "host.docker.internal"
]);

function extractDbHost(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    // Fall back to a tolerant parse if the URL has characters URL() rejects
    // (e.g. unencoded chars in the password): take the host between `@` and the
    // next `:`/`/`.
    const match = /@([^/:?]+)/.exec(url);
    return match?.[1];
  }
}

/**
 * Detects the orphan-prone upload configuration that produced the unreachable
 * review-file incident: file bytes are written by the `local-metadata` adapter to
 * *this* machine's disk, while metadata rows are written to a *remote* database that
 * a different (e.g. prod S3) environment serves from. That environment can never
 * resolve the `local/...` key, so the file 404s — an orphan.
 *
 * Safe combinations (not risky): s3 adapter (durable, served consistently), or a
 * local adapter paired with a local database (single-machine dev). Pure function,
 * no side effects — mirrors {@link assessRegulatoryStorageDurability}.
 */
export function assessUploadStorageConsistency(env: Env = process.env): UploadStorageConsistency {
  const adapter = env.FINPROOF_STORAGE_ADAPTER?.trim() || "local-metadata";

  if (adapter !== "local-metadata") {
    return { risky: false, adapter, detail: `${adapter} 스토리지 — 서빙 환경과 일관됨` };
  }

  const dbUrl = env.DATABASE_URL ?? env.TEST_DATABASE_URL;

  if (!dbUrl) {
    return { risky: false, adapter, detail: "DB 미설정 — 원격 업로드 위험 없음" };
  }

  const dbHost = extractDbHost(dbUrl);

  if (!dbHost || LOCAL_DB_HOSTS.has(dbHost)) {
    return { risky: false, adapter, dbHost, detail: `로컬 저장소 + 로컬 DB(${dbHost ?? "unknown"}) — 안전` };
  }

  return {
    risky: true,
    adapter,
    dbHost,
    detail:
      `로컬 파일 저장소(local-metadata)로 원격 DB(${dbHost})에 업로드하면 바이트가 이 머신에만 ` +
      `저장되고 메타데이터만 원격 DB에 남아, 다른 서빙 환경(예: prod S3)에서 조회되지 않는 orphan이 ` +
      `됩니다. FINPROOF_STORAGE_ADAPTER=s3 로 설정하거나 로컬 DB를 사용하세요.`
  };
}

/**
 * Emits a single structured warning (one JSON line to stdout, shipped to CloudWatch)
 * when the upload configuration is orphan-prone. Best-effort observability only — it
 * never blocks the upload and never throws.
 */
export function warnCrossEnvUpload(
  env: Env = process.env,
  log: (payload: Record<string, unknown>) => void = defaultStorageLog
): void {
  try {
    const assessment = assessUploadStorageConsistency(env);

    if (!assessment.risky) {
      return;
    }

    log({
      evt: "storage",
      level: "warn",
      reason: "cross_env_upload",
      adapter: assessment.adapter,
      dbHost: assessment.dbHost,
      detail: assessment.detail
    });
  } catch {
    // observability must never affect uploads
  }
}

/** The storageProvider each configured serving adapter is able to resolve. */
const SERVABLE_PROVIDER_BY_ADAPTER: Record<string, string> = {
  s3: "s3",
  "local-metadata": "local"
};

export type UnservableReason = "provider_mismatch" | "bytes_missing";

/**
 * Explains why the content route could not read a file's bytes. If the file's
 * `storageProvider` is one the currently configured adapter cannot resolve (e.g. a
 * `local` file under a prod `s3` adapter — the orphan incident), it's a
 * `provider_mismatch`. Otherwise the provider matches but the bytes are gone —
 * `bytes_missing`.
 */
export function classifyUnservableFile(env: Env = process.env, storageProvider: string): UnservableReason {
  const adapter = env.FINPROOF_STORAGE_ADAPTER?.trim() || "local-metadata";
  const servable = SERVABLE_PROVIDER_BY_ADAPTER[adapter];

  return servable && servable === storageProvider ? "bytes_missing" : "provider_mismatch";
}

function defaultStorageLog(payload: Record<string, unknown>): void {
  try {
    console.warn(JSON.stringify({ ts: new Date().toISOString(), ...payload }));
  } catch {
    // ignore serialization failures
  }
}

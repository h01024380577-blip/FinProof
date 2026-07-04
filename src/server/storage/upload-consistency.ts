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

export type ReviewSourceFile = {
  storageProvider: string;
  name: string;
};

/**
 * Fails fast when *every* uploaded review source is unresolvable by the active
 * adapter because of a `provider_mismatch` (e.g. all `local` files served by a prod
 * `s3` adapter — the rc-upload-003 orphan incident). Without this guard the pipeline
 * runs OCR, extracts nothing, and aborts with the misleading "광고 원문 추출 실패 …
 * OCR 제공자 설정을 확인" message that sends debugging down the wrong path. When at
 * least one source is servable, or there are no sources, this is a no-op — the normal
 * extraction path (and {@link classifyUnservableFile}) handles the rest.
 *
 * Callers pass only real uploaded review sources (sample/non-review files excluded).
 */
export function assertReviewSourcesServable(env: Env, files: ReviewSourceFile[]): void {
  if (files.length === 0) {
    return;
  }

  const adapter = env.FINPROOF_STORAGE_ADAPTER?.trim() || "local-metadata";

  // Only the durable shared adapter (s3) produces the unrecoverable orphan: bytes written
  // to a machine's local disk can never be resolved from a different serving environment.
  // A local-metadata adapter mismatch is a dev/cross-env concern surfaced by
  // assessUploadStorageConsistency — extraction, not this guard, decides those.
  if (adapter !== "s3") {
    return;
  }

  const mismatched = files.filter(
    (file) => classifyUnservableFile(env, file.storageProvider) === "provider_mismatch"
  );

  if (mismatched.length < files.length) {
    return;
  }

  const providers = Array.from(new Set(mismatched.map((file) => file.storageProvider))).join(", ");
  const fileNames = mismatched.map((file) => file.name).slice(0, 4).join(", ");

  throw new Error(
    [
      `업로드 파일이 현재 서버 저장소(${adapter})와 다른 방식(${providers})으로 저장돼 본문을 읽을 수 없습니다.`,
      "해당 파일들은 이 서버에서 서빙·분석할 수 없는 orphan 상태입니다 —",
      `${adapter} 어댑터로 다시 업로드해 주세요.`,
      fileNames ? `대상 파일: ${fileNames}` : ""
    ]
      .filter(Boolean)
      .join(" ")
  );
}

/**
 * Maps an {@link UnservableReason} to the error code + human message the content route
 * returns. A `provider_mismatch` (the orphan incident) previously surfaced to the viewer
 * as a bare 404 "확인할 수 없다" with no cause; this names the real reason and the remedy.
 */
export function describeUnservableFile(reason: UnservableReason): { code: string; message: string } {
  if (reason === "provider_mismatch") {
    return {
      code: "STORAGE_PROVIDER_MISMATCH",
      message:
        "이 파일은 현재 서버 저장소와 다른 방식으로 업로드돼 본문을 읽을 수 없습니다. " +
        "공유 저장소(s3) 어댑터로 다시 업로드해 주세요."
    };
  }

  return {
    code: "STORAGE_BYTES_MISSING",
    message: "파일 메타데이터는 있으나 저장된 본문을 찾을 수 없습니다."
  };
}

function defaultStorageLog(payload: Record<string, unknown>): void {
  try {
    console.warn(JSON.stringify({ ts: new Date().toISOString(), ...payload }));
  } catch {
    // ignore serialization failures
  }
}

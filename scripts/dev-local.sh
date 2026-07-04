#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

CODEX_NODE_BIN="/Users/owner/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"

if [ -d "$CODEX_NODE_BIN" ]; then
  export PATH="$CODEX_NODE_BIN:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run the FinProof local dev server." >&2
  echo "Install Node.js or keep the Codex bundled runtime available at: $CODEX_NODE_BIN" >&2
  exit 1
fi

export FINPROOF_ANALYSIS_EXECUTION_MODE="${FINPROOF_ANALYSIS_EXECUTION_MODE:-inline}"
export FINPROOF_STORAGE_ADAPTER="${FINPROOF_STORAGE_ADAPTER:-local-metadata}"
export FINPROOF_LOCAL_UPLOAD_DIR="${FINPROOF_LOCAL_UPLOAD_DIR:-$PWD/.finproof-uploads}"

mkdir -p "$FINPROOF_LOCAL_UPLOAD_DIR"

exec node_modules/.bin/next dev --turbopack -p "${PORT:-3000}"

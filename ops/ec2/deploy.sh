#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/finproof-agent/current"
SERVICE_NAME="finproof-agent"
WORKER_SERVICE_NAME="finproof-agent-analysis-worker"
RUNTIME_ENV="/etc/finproof-agent/finproof-agent.env"
RELEASE_ENV="/etc/finproof-agent/finproof-agent.release.env"

cd "$APP_DIR"

load_env_file() {
  local env_file="$1"
  local assignments

  assignments=$(ENV_FILE="$env_file" node <<'NODE'
const { readFileSync } = require("node:fs");

const envFile = process.env.ENV_FILE;

for (const rawLine of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();

  if (!line || line.startsWith("#")) {
    continue;
  }

  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

  if (!match) {
    throw new Error("Invalid env assignment in " + envFile + ": " + rawLine);
  }

  const key = match[1];
  let value = match[2];

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  process.stdout.write(key + "=" + value + "\n");
}
NODE
  )

  while IFS= read -r assignment; do
    if [ -n "$assignment" ]; then
      export "$assignment"
    fi
  done <<< "$assignments"
}

if [ -f "$RUNTIME_ENV" ]; then
  load_env_file "$RUNTIME_ENV"
fi

if [ -f "$RELEASE_ENV" ]; then
  load_env_file "$RELEASE_ENV"
fi

npm ci --include=dev
npm run db:generate
npm run build
npm run db:deploy

sudo systemctl daemon-reload
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl restart "$WORKER_SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$WORKER_SERVICE_NAME"
npm run ops:readiness

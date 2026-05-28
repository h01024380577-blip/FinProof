#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/finproof-agent/current"
SERVICE_NAME="finproof-agent"
WORKER_SERVICE_NAME="finproof-agent-analysis-worker"
RUNTIME_ENV="/etc/finproof-agent/finproof-agent.env"
RELEASE_ENV="/etc/finproof-agent/finproof-agent.release.env"

cd "$APP_DIR"

if [ -f "$RUNTIME_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$RUNTIME_ENV"
  set +a
fi

if [ -f "$RELEASE_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$RELEASE_ENV"
  set +a
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

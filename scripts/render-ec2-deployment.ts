import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Ec2SystemdOptions = {
  appName: string;
  appDirectory: string;
  envFile: string;
  port: number;
  user: string;
  group: string;
};

type Ec2DeploymentArtifact = {
  path: string;
  content: string;
  executable?: boolean;
};

const DEFAULT_OPTIONS: Ec2SystemdOptions = {
  appName: "finproof-agent",
  appDirectory: "/opt/finproof-agent/current",
  envFile: "/etc/finproof-agent/finproof-agent.env",
  port: 3000,
  user: "finproof",
  group: "finproof"
};

function trimLines(value: string) {
  return `${value.trim()}\n`;
}

export function renderEc2SystemdUnit(options: Ec2SystemdOptions = DEFAULT_OPTIONS) {
  return trimLines(`
    [Unit]
    Description=FinProof Agent Next.js runtime
    After=network-online.target
    Wants=network-online.target

    [Service]
    Type=simple
    User=${options.user}
    Group=${options.group}
    WorkingDirectory=${options.appDirectory}
    EnvironmentFile=${options.envFile}
    Environment=NODE_ENV=production
    Environment=NEXT_TELEMETRY_DISABLED=1
    ExecStart=/usr/bin/env npm run start -- -H 0.0.0.0 -p ${options.port}
    Restart=always
    RestartSec=5
    TimeoutStopSec=30
    KillSignal=SIGINT
    NoNewPrivileges=true
    PrivateTmp=true
    ProtectSystem=full
    ProtectHome=true

    [Install]
    WantedBy=multi-user.target
  `).replace(/^ {4}/gm, "");
}

export function renderEc2AnalysisWorkerSystemdUnit(options: Ec2SystemdOptions = DEFAULT_OPTIONS) {
  return trimLines(`
    [Unit]
    Description=FinProof Agent analysis worker
    After=network-online.target
    Wants=network-online.target

    [Service]
    Type=simple
    User=${options.user}
    Group=${options.group}
    WorkingDirectory=${options.appDirectory}
    EnvironmentFile=${options.envFile}
    Environment=NODE_ENV=production
    Environment=NEXT_TELEMETRY_DISABLED=1
    ExecStart=/usr/bin/env npm run ops:analysis:worker -- --loop
    Restart=always
    RestartSec=5
    TimeoutStopSec=30
    KillSignal=SIGINT
    NoNewPrivileges=true
    PrivateTmp=true
    ProtectSystem=full
    ProtectHome=true

    [Install]
    WantedBy=multi-user.target
  `).replace(/^ {4}/gm, "");
}

export function renderEc2RuntimeEnvExample() {
  return trimLines(`
    # Runtime env for /etc/finproof-agent/finproof-agent.env on AWS EC2.
    # Keep the migration URL out of this file; it belongs in release-only secrets.
    PORT=3000
    FINPROOF_AUTH_MODE=jwt
    FINPROOF_AUTH_JWKS_URL=
    FINPROOF_AUTH_JWT_ISSUER=
    FINPROOF_AUTH_JWT_AUDIENCE=finproof-agent
    # Temporary HS256 fallback for non-OIDC environments. Prefer JWKS above for production.
    FINPROOF_AUTH_JWT_SECRET=
    FINPROOF_REVIEW_STORE=prisma
    DATABASE_URL=postgresql://prisma.<project-ref>:<password>@<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1

    FINPROOF_MODEL_PROVIDER=router
    OPENAI_API_KEY=
    GEMINI_API_KEY=
    FINPROOF_MODEL_DEFAULT_TEXT=gpt-5-mini
    FINPROOF_MODEL_ESCALATION_TEXT=gpt-5.4
    FINPROOF_MODEL_HIGHEST_PRECISION_TEXT=gpt-5.5
    FINPROOF_MODEL_MULTIMODAL=gpt-5-mini
    FINPROOF_MODEL_MULTIMODAL_ESCALATION=gpt-5.4
    FINPROOF_EMBEDDING_MODEL=text-embedding-3-small
    FINPROOF_EMBEDDING_ESCALATION_MODEL=text-embedding-3-large

    FINPROOF_OCR_PROVIDER=openai
    FINPROOF_OCR_MODEL=gpt-5-mini
    FINPROOF_OCR_MAX_INLINE_BYTES=20971520
    FINPROOF_PDFTOTEXT_PATH=/usr/bin/pdftotext
    FINPROOF_PDFTOPPM_PATH=/usr/bin/pdftoppm
    FINPROOF_OCR_PDF_RENDER_MAX_PAGES=3
    FINPROOF_RAG_PROVIDER=postgres
    FINPROOF_RAG_TOP_K=4
    FINPROOF_RAG_MIN_SCORE=0.72
    FINPROOF_RAG_MAX_CONTEXT_CHARS=6000
    FINPROOF_RERANK_PROVIDER=cohere
    COHERE_API_KEY=
    FINPROOF_RERANK_MODEL=rerank-v3.5
    FINPROOF_RERANK_TOP_K=4
    FINPROOF_ANALYSIS_EXECUTION_MODE=queued
    FINPROOF_WORKER_TENANT_ID=tenant-demo
    FINPROOF_ANALYSIS_WORKER_ID=finproof-analysis-worker

    FINPROOF_UPLOAD_SCAN_PROVIDER=http
    FINPROOF_UPLOAD_SCAN_ENDPOINT=
    FINPROOF_UPLOAD_SCAN_API_KEY=

    FINPROOF_STORAGE_ADAPTER=s3
    FINPROOF_S3_BUCKET=finproof-s3
    AWS_REGION=us-east-1
  `).replace(/^ {4}/gm, "");
}

export function renderEc2ReleaseEnvExample() {
  return trimLines(`
    # Release-only env for migrations on AWS EC2 or CI.
    # Load this only around npm run db:deploy / npm run db:seed.
    DATABASE_URL=postgresql://prisma.<project-ref>:<password>@<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
    DIRECT_URL=postgresql://prisma.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres
  `).replace(/^ {4}/gm, "");
}

export function renderEc2DeployScript(options: Ec2SystemdOptions = DEFAULT_OPTIONS) {
  const releaseEnvFile = options.envFile.replace(/\.env$/, ".release.env");

  return trimLines(`
    #!/usr/bin/env bash
    set -euo pipefail

    APP_DIR="${options.appDirectory}"
    SERVICE_NAME="${options.appName}"
    WORKER_SERVICE_NAME="${options.appName}-analysis-worker"
    RUNTIME_ENV="${options.envFile}"
    RELEASE_ENV="${releaseEnvFile}"

    cd "$APP_DIR"

    load_env_file() {
      local env_file="$1"
      local assignments

      assignments=$(ENV_FILE="$env_file" node <<'NODE'
    const { readFileSync } = require("node:fs");

    const envFile = process.env.ENV_FILE;

    for (const rawLine of readFileSync(envFile, "utf8").split(/\\r?\\n/)) {
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

      process.stdout.write(key + "=" + value + "\\n");
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
  `).replace(/^ {4}/gm, "");
}

export function buildEc2DeploymentArtifacts(
  options: Ec2SystemdOptions = DEFAULT_OPTIONS
): Ec2DeploymentArtifact[] {
  return [
    {
      path: "ops/ec2/finproof-agent.service",
      content: renderEc2SystemdUnit(options)
    },
    {
      path: "ops/ec2/finproof-agent-analysis-worker.service",
      content: renderEc2AnalysisWorkerSystemdUnit(options)
    },
    {
      path: "ops/ec2/finproof-agent.env.example",
      content: renderEc2RuntimeEnvExample()
    },
    {
      path: "ops/ec2/finproof-agent.release.env.example",
      content: renderEc2ReleaseEnvExample()
    },
    {
      path: "ops/ec2/deploy.sh",
      content: renderEc2DeployScript(options),
      executable: true
    }
  ];
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

function writeArtifacts(artifacts: Ec2DeploymentArtifact[]) {
  for (const artifact of artifacts) {
    const targetPath = path.resolve(process.cwd(), artifact.path);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, artifact.content);

    if (artifact.executable) {
      chmodSync(targetPath, 0o755);
    }

    console.log(`wrote ${artifact.path}`);
  }
}

if (isMainModule()) {
  const artifacts = buildEc2DeploymentArtifacts();

  if (process.argv.includes("--write")) {
    writeArtifacts(artifacts);
  } else {
    for (const artifact of artifacts) {
      console.log(`# ${artifact.path}`);
      console.log(artifact.content);
    }
  }
}

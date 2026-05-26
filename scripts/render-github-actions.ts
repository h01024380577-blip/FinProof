import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type GithubActionsArtifact = {
  path: string;
  content: string;
};

function trimLines(value: string) {
  return `${value.trim()}\n`;
}

export function renderBackendCiWorkflow() {
  return trimLines(`
    name: Backend CI

    on:
      pull_request:
      push:
        branches: [main]

    permissions:
      contents: read

    jobs:
      verify:
        runs-on: ubuntu-latest
        timeout-minutes: 20
        steps:
          - name: Checkout
            uses: actions/checkout@v4

          - name: Setup Node.js
            uses: actions/setup-node@v4
            with:
              node-version: 24
              cache: npm

          - name: Install dependencies
            run: npm ci

          - name: Generate Prisma client
            run: npm run db:generate

          - name: Run tests
            run: npm run test

          - name: Lint
            run: npm run lint

          - name: Build
            run: npm run build
  `).replace(/^ {4}/gm, "");
}

export function renderEc2DeployWorkflow() {
  return trimLines(`
    name: Deploy EC2

    on:
      workflow_dispatch:

    permissions:
      contents: read

    concurrency:
      group: finproof-ec2-production
      cancel-in-progress: false

    jobs:
      deploy:
        runs-on: ubuntu-latest
        environment: production
        timeout-minutes: 30
        steps:
          - name: Checkout
            uses: actions/checkout@v4

          - name: Setup Node.js
            uses: actions/setup-node@v4
            with:
              node-version: 24
              cache: npm

          - name: Verify release
            run: |
              npm ci
              npm run db:generate
              npm run test
              npm run lint
              npm run build

          - name: Prepare SSH key
            run: |
              mkdir -p ~/.ssh
              printf '%s\\n' "\${{ secrets.EC2_SSH_PRIVATE_KEY }}" > ~/.ssh/finproof_agent
              chmod 600 ~/.ssh/finproof_agent

          - name: Trust EC2 host
            run: ssh-keyscan -H "\${{ secrets.EC2_HOST }}" >> ~/.ssh/known_hosts

          - name: Sync release to EC2
            env:
              EC2_HOST: \${{ secrets.EC2_HOST }}
              EC2_USER: \${{ secrets.EC2_USER }}
              EC2_APP_DIR: \${{ vars.EC2_APP_DIR || '/opt/finproof-agent/current' }}
            run: |
              rsync -az --delete \\
                --exclude='.git' \\
                --exclude='.github' \\
                --exclude='node_modules' \\
                --exclude='.next' \\
                --exclude='.env' \\
                --exclude='security' \\
                -e "ssh -i ~/.ssh/finproof_agent" \\
                ./ "$EC2_USER@$EC2_HOST:$EC2_APP_DIR/"

          - name: Run EC2 deploy script
            env:
              EC2_HOST: \${{ secrets.EC2_HOST }}
              EC2_USER: \${{ secrets.EC2_USER }}
              EC2_APP_DIR: \${{ vars.EC2_APP_DIR || '/opt/finproof-agent/current' }}
            run: |
              ssh -i ~/.ssh/finproof_agent "$EC2_USER@$EC2_HOST" \\
                "cd '$EC2_APP_DIR' && bash ops/ec2/deploy.sh"
  `).replace(/^ {4}/gm, "");
}

export function buildGithubActionsArtifacts(): GithubActionsArtifact[] {
  return [
    {
      path: ".github/workflows/backend-ci.yml",
      content: renderBackendCiWorkflow()
    },
    {
      path: ".github/workflows/deploy-ec2.yml",
      content: renderEc2DeployWorkflow()
    }
  ];
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

function writeArtifacts(artifacts: GithubActionsArtifact[]) {
  for (const artifact of artifacts) {
    const targetPath = path.resolve(process.cwd(), artifact.path);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, artifact.content);
    console.log(`wrote ${artifact.path}`);
  }
}

if (isMainModule()) {
  const artifacts = buildGithubActionsArtifacts();

  if (process.argv.includes("--write")) {
    writeArtifacts(artifacts);
  } else {
    for (const artifact of artifacts) {
      console.log(`# ${artifact.path}`);
      console.log(artifact.content);
    }
  }
}

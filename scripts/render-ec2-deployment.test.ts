import {
  buildEc2DeploymentArtifacts,
  renderEc2AnalysisWorkerSystemdUnit,
  renderEc2ReleaseEnvExample,
  renderEc2RuntimeEnvExample,
  renderEc2SystemdUnit
} from "./render-ec2-deployment";

describe("EC2 deployment artifacts", () => {
  it("renders a systemd unit for the production Next.js server", () => {
    const unit = renderEc2SystemdUnit({
      appName: "finproof-agent",
      appDirectory: "/opt/finproof-agent/current",
      envFile: "/etc/finproof-agent/finproof-agent.env",
      port: 3000,
      user: "finproof",
      group: "finproof"
    });

    expect(unit).toContain("Description=FinProof Agent Next.js runtime");
    expect(unit).toContain("User=finproof");
    expect(unit).toContain("WorkingDirectory=/opt/finproof-agent/current");
    expect(unit).toContain("EnvironmentFile=/etc/finproof-agent/finproof-agent.env");
    expect(unit).toContain("Environment=NODE_ENV=production");
    expect(unit).toContain("ExecStart=/usr/bin/env npm run start -- -H 0.0.0.0 -p 3000");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("WantedBy=multi-user.target");
  });

  it("renders a systemd unit for the analysis worker loop", () => {
    const unit = renderEc2AnalysisWorkerSystemdUnit({
      appName: "finproof-agent",
      appDirectory: "/opt/finproof-agent/current",
      envFile: "/etc/finproof-agent/finproof-agent.env",
      port: 3000,
      user: "finproof",
      group: "finproof"
    });

    expect(unit).toContain("Description=FinProof Agent analysis worker");
    expect(unit).toContain("User=finproof");
    expect(unit).toContain("WorkingDirectory=/opt/finproof-agent/current");
    expect(unit).toContain("EnvironmentFile=/etc/finproof-agent/finproof-agent.env");
    expect(unit).toContain("ExecStart=/usr/bin/env npm run ops:analysis:worker -- --loop");
    expect(unit).toContain("Restart=always");
  });

  it("keeps runtime and release-only Supabase secrets separate", () => {
    const runtimeEnv = renderEc2RuntimeEnvExample();
    const releaseEnv = renderEc2ReleaseEnvExample();

    expect(runtimeEnv).toContain("DATABASE_URL=");
    expect(runtimeEnv).toContain("FINPROOF_AUTH_JWKS_URL=");
    expect(runtimeEnv).toContain("FINPROOF_AUTH_JWT_ISSUER=");
    expect(runtimeEnv).toContain("FINPROOF_AUTH_JWT_AUDIENCE=finproof-agent");
    expect(runtimeEnv).toContain("FINPROOF_ANALYSIS_EXECUTION_MODE=queued");
    expect(runtimeEnv).toContain("FINPROOF_WORKER_TENANT_ID=tenant-demo");
    expect(runtimeEnv).toContain("FINPROOF_UPLOAD_SCAN_PROVIDER=http");
    expect(runtimeEnv).toContain("FINPROOF_UPLOAD_SCAN_ENDPOINT=");
    expect(runtimeEnv).not.toContain("DIRECT_URL=");
    expect(releaseEnv).toContain("DIRECT_URL=");
    expect(releaseEnv).toContain("DATABASE_URL=");
  });

  it("builds the expected EC2 artifact set", () => {
    const artifacts = buildEc2DeploymentArtifacts();

    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "ops/ec2/finproof-agent.service",
      "ops/ec2/finproof-agent-analysis-worker.service",
      "ops/ec2/finproof-agent.env.example",
      "ops/ec2/finproof-agent.release.env.example",
      "ops/ec2/deploy.sh"
    ]);
  });

  it("builds before running database migrations in the deploy script", () => {
    const deployScript = buildEc2DeploymentArtifacts().find(
      (artifact) => artifact.path === "ops/ec2/deploy.sh"
    )?.content;

    expect(deployScript).toBeDefined();
    expect(deployScript!.indexOf("npm run build")).toBeLessThan(
      deployScript!.indexOf("npm run db:deploy")
    );
    expect(deployScript).toContain('RUNTIME_ENV="/etc/finproof-agent/finproof-agent.env"');
    expect(deployScript).toContain('if [ -f "$RUNTIME_ENV" ]; then');
    expect(deployScript).toContain('sudo systemctl restart "$SERVICE_NAME"');
    expect(deployScript).toContain('sudo systemctl restart "$WORKER_SERVICE_NAME"');
  });
});

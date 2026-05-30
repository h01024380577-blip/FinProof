import {
  buildGithubActionsArtifacts,
  renderBackendCiWorkflow,
  renderEc2DeployWorkflow
} from "./render-github-actions";

describe("GitHub Actions workflow artifacts", () => {
  it("renders backend CI checks for pull requests and main pushes", () => {
    const workflow = renderBackendCiWorkflow();

    expect(workflow).toContain("name: Backend CI");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run db:generate");
    expect(workflow).toContain("npm run test");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm run build");
  });

  it("renders a manual EC2 deployment workflow using SSH secrets", () => {
    const workflow = renderEc2DeployWorkflow();

    expect(workflow).toContain("name: Deploy EC2");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("tags:");
    expect(workflow).toContain("- deploy-*");
    expect(workflow).toContain("secrets.EC2_SSH_PRIVATE_KEY");
    expect(workflow).toContain("secrets.EC2_HOST");
    expect(workflow).toContain("secrets.EC2_USER");
    expect(workflow).toContain("rsync -az --delete");
    expect(workflow).toContain("bash ops/ec2/deploy.sh");
    expect(workflow).toContain("finproof-ec2-production");
  });

  it("builds the expected workflow artifact set", () => {
    expect(buildGithubActionsArtifacts().map((artifact) => artifact.path)).toEqual([
      ".github/workflows/backend-ci.yml",
      ".github/workflows/deploy-ec2.yml"
    ]);
  });
});

import { buildS3ProvisioningCommands } from "./provision-s3";

describe("S3 provisioning commands", () => {
  it("builds locked-down AWS CLI commands", () => {
    const commands = buildS3ProvisioningCommands({
      bucket: "finproof-prod-artifacts",
      region: "ap-northeast-2"
    });

    expect(commands.map((command) => command.join(" "))).toEqual([
      "aws s3api create-bucket --bucket finproof-prod-artifacts --region ap-northeast-2 --create-bucket-configuration LocationConstraint=ap-northeast-2",
      "aws s3api put-public-access-block --bucket finproof-prod-artifacts --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
      'aws s3api put-bucket-encryption --bucket finproof-prod-artifacts --server-side-encryption-configuration {"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}',
      "aws s3api put-bucket-versioning --bucket finproof-prod-artifacts --versioning-configuration Status=Enabled"
    ]);
  });

  it("omits create-bucket location constraints for us-east-1", () => {
    const commands = buildS3ProvisioningCommands({
      bucket: "finproof-s3",
      region: "us-east-1"
    });

    expect(commands[0]).toEqual(["aws", "s3api", "create-bucket", "--bucket", "finproof-s3"]);
  });
});

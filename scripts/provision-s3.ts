import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { loadDotEnv } from "./load-env";

type ProvisionS3Options = {
  bucket: string;
  region: string;
};

export function buildS3ProvisioningCommands({ bucket, region }: ProvisionS3Options): string[][] {
  const createBucketCommand =
    region === "us-east-1"
      ? ["aws", "s3api", "create-bucket", "--bucket", bucket]
      : [
          "aws",
          "s3api",
          "create-bucket",
          "--bucket",
          bucket,
          "--region",
          region,
          "--create-bucket-configuration",
          `LocationConstraint=${region}`
        ];

  return [
    createBucketCommand,
    [
      "aws",
      "s3api",
      "put-public-access-block",
      "--bucket",
      bucket,
      "--public-access-block-configuration",
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
    ],
    [
      "aws",
      "s3api",
      "put-bucket-encryption",
      "--bucket",
      bucket,
      "--server-side-encryption-configuration",
      '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
    ],
    [
      "aws",
      "s3api",
      "put-bucket-versioning",
      "--bucket",
      bucket,
      "--versioning-configuration",
      "Status=Enabled"
    ]
  ];
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

if (isMainModule()) {
  loadDotEnv();
  const bucket = process.env.FINPROOF_S3_BUCKET;
  const region = process.env.AWS_REGION;
  const execute = process.argv.includes("--execute");

  if (!bucket || !region) {
    console.error("FINPROOF_S3_BUCKET and AWS_REGION are required.");
    process.exit(1);
  }

  for (const command of buildS3ProvisioningCommands({ bucket, region })) {
    if (!execute) {
      console.log(command.join(" "));
      continue;
    }

    const result = spawnSync(command[0], command.slice(1), { stdio: "inherit" });

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

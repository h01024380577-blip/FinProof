import {
  assertBackendDeploymentReady,
  assertBackendProductionReady,
  type BackendReadinessProfile,
  getBackendRuntimeConfig,
  getBackendReadinessProfile,
  redactedBackendRuntimeConfig
} from "../src/server/ops/backend-config";
import { loadDotEnv } from "./load-env";

function profileFromArgs(args: string[]): BackendReadinessProfile | undefined {
  const profileFlag = args.find((arg) => arg.startsWith("--profile="));

  if (profileFlag) {
    return profileFlag.slice("--profile=".length) === "production" ? "production" : "deployment";
  }

  const profileIndex = args.indexOf("--profile");
  const profileValue = profileIndex >= 0 ? args[profileIndex + 1] : undefined;

  if (profileValue) {
    return profileValue === "production" ? "production" : "deployment";
  }

  return undefined;
}

loadDotEnv();
const profile = profileFromArgs(process.argv.slice(2)) ?? getBackendReadinessProfile();
const config = getBackendRuntimeConfig();

try {
  if (profile === "production") {
    assertBackendProductionReady(config);
  } else {
    assertBackendDeploymentReady(config);
  }

  console.log(
    JSON.stringify(
      {
        readinessProfile: profile,
        ...redactedBackendRuntimeConfig(config)
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    JSON.stringify(
      {
        readinessProfile: profile,
        ...redactedBackendRuntimeConfig(config)
      },
      null,
      2
    )
  );
  process.exit(1);
}

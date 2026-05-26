import {
  assertBackendProductionReady,
  getBackendRuntimeConfig,
  redactedBackendRuntimeConfig
} from "../src/server/ops/backend-config";
import { loadDotEnv } from "./load-env";

loadDotEnv();
const config = getBackendRuntimeConfig();

try {
  assertBackendProductionReady(config);
  console.log(JSON.stringify(redactedBackendRuntimeConfig(config), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(JSON.stringify(redactedBackendRuntimeConfig(config), null, 2));
  process.exit(1);
}

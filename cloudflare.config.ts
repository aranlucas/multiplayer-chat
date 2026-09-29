import { bindings, defineConfig, exports } from "cf/config";

import previewConfig from "./preview/cloudflare.config.ts";
import e2eConfig from "./e2e/cloudflare.config.ts";

const productionConfig = defineConfig({
  worker: {
    exports: {
      AgentRoom: exports.durableObject({ storage: "sqlite" }),
      Sandbox: exports.durableObject({ state: "deleted" }),
    },
    name: "relay-multiplayer-agent",
    compatibilityDate: "2026-08-25",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    entrypoint: "src/worker.ts",
    observability: {
      enabled: true,
    },
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
    env: {
      OPENCODE_MODE: bindings.text("live"),
      OPENCODE_PROVIDER: bindings.text("openrouter"),
      CLOUDFLARE_ACCOUNT_ID: bindings.text("d93c650f72e597f96785abba389b0ce4"),
      OPENCODE_MODEL: bindings.text("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free"),
      OPENCODE_MODEL_ALLOWLIST: bindings.text("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free"),
      RAILWAY_ENVIRONMENT_ID: bindings.text("795c1abd-ce4f-41f8-aa26-e7da9c55cc4f"),
      RAILWAY_SANDBOX_REGION: bindings.text("us-west2"),
      RAILWAY_SANDBOX_IDLE_TIMEOUT_MINUTES: bindings.text("120"),
      GITHUB_OAUTH_CLIENT_ID: bindings.text("Ov23li43DfrritRncWry"),
      AGENT_ROOMS: bindings.durableObject({
        worker: "relay-multiplayer-agent",
        exportName: "AgentRoom",
      }),
      ASSETS: bindings.assets(),
    },
  },
});

export default defineConfig((ctx) => {
  if (ctx.mode === "relay-preview") {
    return {
      ...previewConfig,
      worker: { ...previewConfig.worker, entrypoint: "src/preview-worker.ts" },
    };
  }
  if (ctx.mode === "e2e") {
    return { ...e2eConfig, worker: { ...e2eConfig.worker, entrypoint: "src/worker.ts" } };
  }
  return productionConfig;
});

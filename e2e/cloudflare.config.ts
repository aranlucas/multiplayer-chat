import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
  worker: {
    exports: {
      AgentRoom: exports.durableObject({ storage: "sqlite" }),
    },
    name: "relay-multiplayer-agent-e2e",
    compatibilityDate: "2026-08-25",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "../src/worker.ts",
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
    env: {
      OPENCODE_MODE: bindings.text("simulation"),
      OPENCODE_PROVIDER: bindings.text("opencode-zen"),
      OPENCODE_MODEL: bindings.text("opencode/muse-spark-1.2-contributor-free"),
      OPENCODE_MODEL_ALLOWLIST: bindings.text(
        "opencode/big-pickle,opencode/mimo-v2.5-free,opencode/hy3-free,opencode/nemotron-3-ultra-free,opencode/nemotron-3.5-lightning-free,opencode/muse-spark-1.2-contributor-free",
      ),
      CLOUDFLARE_ACCOUNT_ID: bindings.text("local"),
      GITHUB_OAUTH_CLIENT_ID: bindings.text(""),
      AGENT_ROOMS: bindings.durableObject({
        worker: "relay-multiplayer-agent-e2e",
        exportName: "AgentRoom",
      }),
      ASSETS: bindings.assets(),
    },
  },
});

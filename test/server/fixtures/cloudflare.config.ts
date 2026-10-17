import { bindings, defineConfig, exports } from "cf/config";

const sdkConfig = defineConfig({
  worker: {
    exports: {
      OpenCodeTestHost: exports.durableObject({ storage: "sqlite" }),
    },
    name: "relay-sdk-regression",
    compatibilityDate: "2026-08-25",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "opencode-worker.ts",
    env: {
      HOSTS: bindings.durableObject({
        worker: "relay-sdk-regression",
        exportName: "OpenCodeTestHost",
      }),
    },
  },
});

const roomConfig = defineConfig({
  worker: {
    name: "relay-room-regression",
    compatibilityDate: "2026-08-25",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "room-worker.ts",
    exports: { AgentRoom: exports.durableObject({ storage: "sqlite" }) },
    env: {
      AGENT_ROOMS: bindings.durableObject({
        worker: "relay-room-regression",
        exportName: "AgentRoom",
      }),
      OPENCODE_MODE: bindings.text("simulation"),
      OPENCODE_PROVIDER: bindings.text("opencode-zen"),
      OPENCODE_MODEL: bindings.text("opencode/test-model"),
      CLOUDFLARE_ACCOUNT_ID: bindings.text("synthetic-local"),
    },
  },
});

export default defineConfig(({ mode }) => (mode === "room" ? roomConfig : sdkConfig));

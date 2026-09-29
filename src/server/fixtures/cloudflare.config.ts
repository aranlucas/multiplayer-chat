import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
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

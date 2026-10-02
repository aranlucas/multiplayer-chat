import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "relay-multiplayer-agent",
    compatibilityDate: "2026-08-25",
    entrypoint: "../src/preview-worker.ts",
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/__relay/*"],
    },
    env: {
      RELAY_CONTROL_ORIGIN: bindings.text("https://relay-multiplayer-agent.aranlucas.workers.dev"),
      ASSETS: bindings.assets(),
    },
  },
});

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          setupFiles: ["./test/setup-network.ts"],
          include: ["test/**/*.test.{ts,tsx}"],
          exclude: ["test/server/*-workerd.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        plugins: [
          cloudflareTest({
            experimental: {
              newConfig: { configPath: "test/server/fixtures/cloudflare.config.ts" },
            },
            remoteBindings: false,
            // The beta config loader retains the original Worker name in self-bindings.
            // An unqualified class name binds to this project's test isolate.
            // https://github.com/cloudflare/workers-sdk/issues/16012
            miniflare: {
              durableObjects: { HOSTS: { className: "OpenCodeTestHost", useSQLite: true } },
            },
          }),
        ],
        test: {
          name: "sdk-workerd",
          include: ["test/server/embedded-opencode-workerd.test.ts"],
        },
      },
      {
        extends: true,
        plugins: [
          cloudflareTest({
            experimental: {
              newConfig: { configPath: "test/server/fixtures/room-cloudflare.config.ts" },
            },
            remoteBindings: false,
            miniflare: {
              durableObjects: { AGENT_ROOMS: { className: "AgentRoom", useSQLite: true } },
            },
          }),
        ],
        test: {
          name: "room-workerd",
          globalSetup: ["./test/server/preview-setup.ts"],
          include: ["test/server/agent-room-workerd.test.ts"],
        },
      },
    ],
  },
});

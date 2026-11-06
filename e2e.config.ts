import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";

export default {
  tests: "e2e/**/*.e2e.ts",
  targets: [
    {
      name: "chromium",
      engine: web({ viewport: { width: 1440, height: 1000 } }),
      app: {
        url: "http://127.0.0.1:5176",
        command: {
          executable: "pnpm",
          args: [
            "exec",
            "vite",
            "--config",
            "vite.e2e.config.ts",
            "--mode",
            "e2e",
            "--host",
            "127.0.0.1",
            "--port",
            "5176",
            "--strictPort",
          ],
          log: ".e2e/logs/app.log",
          startupTimeout: 120_000,
        },
      },
    },
  ],
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporters: ["list", "junit"],
  trace: "retain-on-failure",
} satisfies E2EConfig;

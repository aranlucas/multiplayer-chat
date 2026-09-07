import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: "client",
          include: ["src/client/**/*.test.ts", "src/client/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./src/client/test-setup.ts"],
        },
      },
      {
        test: {
          name: "server",
          include: ["src/server/**/*.test.ts", "src/shared/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});

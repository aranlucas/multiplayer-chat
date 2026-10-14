import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    setupFiles: ["./test/setup-network.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});

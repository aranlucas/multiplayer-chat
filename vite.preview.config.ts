import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __dirname: JSON.stringify("/"),
    __filename: JSON.stringify("/index.js"),
    __RELAY_BUILD_SHA__: JSON.stringify(
      process.env.WORKERS_CI_COMMIT_SHA ??
        process.env.RELAY_BUILD_SHA ??
        "local-preview",
    ),
  },
  plugins: [
    react(),
    cloudflare({ configPath: "./preview/wrangler.jsonc" }),
  ],
  build: {
    outDir: "dist-preview",
    minify: "terser",
    terserOptions: {
      compress: { passes: 2 },
      format: { comments: false },
    },
  },
});

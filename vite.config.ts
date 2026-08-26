import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // OpenCode's npm audit fetcher includes a CommonJS path helper in its
  // Workerd bundle. It is not used by Relay, but Cloudflare evaluates it at
  // startup, where ESM Workers intentionally do not expose these Node globals.
  define: {
    __dirname: JSON.stringify("/"),
    __filename: JSON.stringify("/index.js"),
  },
  plugins: [react(), cloudflare()],
  build: {
    minify: "terser",
    terserOptions: {
      compress: { passes: 2 },
      format: { comments: false },
    },
  },
});

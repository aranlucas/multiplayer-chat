import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  resolve: { tsconfigPaths: true },
  define: { __dirname: JSON.stringify("/"), __filename: JSON.stringify("/index.js") },
  plugins: [
    cloudflare({
      persistState: false,
      inspectorPort: false,
      remoteBindings: false,
      types: { generate: false },
    }),
  ],
  server: { host: "127.0.0.1", port: 0, watch: null },
});

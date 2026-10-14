import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
  define: {
    __dirname: '"/"',
    __filename: '"/index.js"',
  },
  minify: true,
  types: {
    generate: false,
  },
});

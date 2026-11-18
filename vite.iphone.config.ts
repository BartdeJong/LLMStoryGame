import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5199,
    strictPort: true,
    https: {
      cert: readFileSync(".local-certs/dev-cert.pem"),
      key: readFileSync(".local-certs/dev-key.pem"),
    },
  },
});

import { defineConfig } from "vite";

export default defineConfig({
  // The WebLLM worker is bundled as an ES module worker (it uses dynamic imports).
  worker: { format: "es" },
});

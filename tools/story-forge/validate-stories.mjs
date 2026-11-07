// Bundles validate-stories.ts with esbuild (already installed with Vite) and runs it with Node.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const outDir = resolve(root, "node_modules/.cache/story-forge");
const outFile = resolve(outDir, "validate-stories.mjs");
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(here, "validate-stories.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  define: { "import.meta.env.BASE_URL": '"/"' },
});

const result = spawnSync(process.execPath, [outFile, ...process.argv.slice(2)], { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);

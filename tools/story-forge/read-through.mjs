import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = new URL(".", import.meta.url);
const scriptDir = fileURLToPath(here);
const root = resolve(scriptDir, "../..");
const outDir = resolve(root, "node_modules/.cache/story-forge");
const outFile = resolve(outDir, "read-through-cli.mjs");
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(scriptDir, "read-through-cli.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
});

const result = spawnSync(process.execPath, [outFile, ...process.argv.slice(2)], { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);

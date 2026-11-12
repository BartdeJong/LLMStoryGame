import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const command = process.argv[2];
const entryPoints = {
  "icon-catalog": "icon-catalog.ts",
  "icon-lint": "icon-lint.ts",
  "visual-report": "visual-report.ts",
  "list-visual-requests": "list-visual-requests.ts",
  "bake-areas": "bake-areas.ts",
  "anchor-clues": "anchor-clues.ts",
};
const entry = entryPoints[command];
if (!entry) throw new Error(`Unknown visual tool "${command ?? ""}".`);
const root = resolve(".");
const outDir = resolve(root, "node_modules/.cache/story-forge");
const outFile = resolve(outDir, `${command}.mjs`);
mkdirSync(outDir, { recursive: true });
await build({
  entryPoints: [resolve("tools/story-forge", entry)],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
});
const result = spawnSync(process.execPath, [outFile, ...process.argv.slice(3)], { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);

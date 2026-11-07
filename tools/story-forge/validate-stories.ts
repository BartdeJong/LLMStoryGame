// Validates every pack listed in public/stories/index.json.
// Run through validate-stories.mjs (npm run validate-stories). Exit code 1 on any error.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatIssue, validateStoryPack } from "../../src/story/validate";
import { parseStoryIndex } from "../../src/story/loader";
import { LENGTH_IDS } from "../../src/story/types";

const storiesDir = resolve(process.argv[2] ?? "public/stories");

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

let failed = false;
const fail = (text: string): void => { failed = true; console.error(text); };

const indexFile = resolve(storiesDir, "index.json");
if (!existsSync(indexFile)) {
  fail(`ERROR [INDEX_MISSING] ${indexFile}: index.json not found.`);
  process.exit(1);
}

let index;
try {
  index = parseStoryIndex(readJson(indexFile));
} catch (e) {
  fail(`ERROR [INDEX_INVALID] index.json: ${(e as Error).message}`);
  process.exit(1);
}

for (const entry of index.stories) {
  const file = resolve(storiesDir, `${entry.id}.json`);
  const name = `${entry.id}.json`;
  if (!existsSync(file)) {
    fail(`ERROR [PACK_MISSING] index.json: story "${entry.id}" is listed but ${name} does not exist.`);
    continue;
  }
  let data: unknown;
  try {
    data = readJson(file);
  } catch (e) {
    fail(`ERROR [PACK_NOT_JSON] ${name}: ${(e as Error).message}`);
    continue;
  }

  const report = validateStoryPack(data);
  for (const issue of report.errors) fail(`${name}: ${formatIssue(issue)}`);
  for (const issue of report.warnings) console.warn(`${name}: ${formatIssue(issue)}`);

  if (report.pack) {
    const pack = report.pack;
    if (pack.identity.id !== entry.id) fail(`${name}: ERROR [INDEX_MISMATCH] identity.id: is "${pack.identity.id}" but index.json lists "${entry.id}".`);
    const defined = LENGTH_IDS.filter((id) => pack.lengths[id]);
    if (defined.join() !== [...entry.lengths].sort((a, b) => LENGTH_IDS.indexOf(a) - LENGTH_IDS.indexOf(b)).join()) {
      fail(`${name}: ERROR [INDEX_MISMATCH] index.json lengths: lists [${entry.lengths.join(", ")}] but the pack defines [${defined.join(", ")}].`);
    }
  }
  console.log(`${report.ok ? "OK  " : "FAIL"} ${name} (${report.errors.length} error(s), ${report.warnings.length} warning(s))`);
}

if (index.stories.length === 0) console.warn("WARNING: index.json lists no stories.");
process.exit(failed ? 1 : 0);

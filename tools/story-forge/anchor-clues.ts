// Story Forge step: attaches every clue that is found at a location to an object there (clue.object_id).
// Run through run-visual-tool.mjs:  npm run anchor-clues -- [story-id] [--check]
//   --check  print the decisions and write nothing
// The rule for each clue is in bake/anchors.ts. Only the lines that change are edited, so the rest of each pack keeps
// its layout. Afterwards run  npm run bake-areas -- <story-id> --placements  so the new objects get tiles.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { StoryPack, WorldObject } from "../../src/story/types";
import { anchorClues, type AnchorDecision } from "./bake/anchors";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const storyFilter = args.find((arg) => !arg.startsWith("--"));

const storiesDir = resolve("public/stories");
let problems = 0;
const say = (text: string): void => console.log(text);
const complain = (text: string): void => { problems += 1; console.error(text); };

// ---- text edits (the pack files are hand-formatted, so they are not re-serialised) ----------------------------------

function indexOfOrThrow(text: string, needle: string, from: number, what: string): number {
  const at = text.indexOf(needle, from);
  if (at < 0) throw new Error(`Could not find ${what} in the pack text.`);
  return at;
}

function indentOf(text: string, index: number): string {
  return /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", index) + 1))![0];
}

function endOfString(text: string, start: number): number {
  let j = start + 1;
  while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
  return j;
}

function matchingBracket(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') { i = endOfString(text, i); continue; }
    if (ch === "[" || ch === "{") depth += 1;
    if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("Unbalanced brackets in the pack text.");
}

// Adds "object_id" right after the clue's "id" (the id is always the clue's first key): on a line of its own when the
// clue is laid out over several lines, or inline when the clue is written on one line.
function insertObjectId(text: string, clueId: string, objectId: string): string {
  const clues = indexOfOrThrow(text, '"clues": [', 0, "the clues");
  const idToken = `"id": ${JSON.stringify(clueId)}`;
  const at = indexOfOrThrow(text, idToken, clues, `clue "${clueId}"`);
  const comma = at + idToken.length;
  if (text[comma] !== ",") throw new Error(`Clue "${clueId}" has an unexpected layout.`);
  const lineEnd = text.indexOf("\n", comma);
  const field = `"object_id": ${JSON.stringify(objectId)},`;
  if (text.slice(comma + 1, lineEnd).trim() === "") {
    return `${text.slice(0, comma + 1)}\n${indentOf(text, at)}${field}${text.slice(comma + 1)}`;
  }
  return `${text.slice(0, comma + 1)} ${field}${text.slice(comma + 1)}`;
}

// Appends an object to the "objects" array of a location.
function appendObject(text: string, locationId: string, object: WorldObject): string {
  const locations = indexOfOrThrow(text, '"locations": [', 0, "the locations");
  const at = indexOfOrThrow(text, `"id": ${JSON.stringify(locationId)}`, locations, `location "${locationId}"`);
  const key = indexOfOrThrow(text, '"objects": [', at, `the objects of "${locationId}"`);
  const open = key + '"objects": '.length;
  const close = matchingBracket(text, open);
  const keyIndent = indentOf(text, key);
  const itemIndent = `${keyIndent}  `;
  const body = [
    `${itemIndent}{`,
    `${itemIndent}  "id": ${JSON.stringify(object.id)},`,
    `${itemIndent}  "name": ${JSON.stringify(object.name)},`,
    `${itemIndent}  "description": ${JSON.stringify(object.description)},`,
    `${itemIndent}  "visual": { "icon": ${JSON.stringify(object.visual?.icon)} }`,
    `${itemIndent}}`,
  ].join("\n");
  if (text.slice(open + 1, close).trim() === "") {
    return `${text.slice(0, open)}[\n${body}\n${keyIndent}]${text.slice(close + 1)}`;
  }
  const lastItemEnd = text.lastIndexOf("}", close);
  return `${text.slice(0, lastItemEnd + 1)},\n${body}${text.slice(lastItemEnd + 1)}`;
}

function applyDecision(text: string, decision: AnchorDecision): string {
  if (decision.type === "object") return appendObject(text, decision.locationId, decision.object);
  return insertObjectId(text, decision.clueId, decision.objectId);
}

// ---- main -----------------------------------------------------------------------------------------------------------

const files = readdirSync(storiesDir)
  .filter((f) => f.endsWith(".json") && f !== "index.json")
  .filter((f) => !storyFilter || f === `${storyFilter}.json`);
if (files.length === 0) throw new Error(`No story pack matches "${storyFilter ?? ""}".`);

for (const file of files) {
  const path = resolve(storiesDir, file);
  const original = readFileSync(path, "utf8");
  const pack = JSON.parse(original) as StoryPack;
  let decisions: AnchorDecision[];
  try {
    decisions = anchorClues(pack);
  } catch (error) {
    complain(`ERROR ${pack.identity.id}: ${(error as Error).message}`);
    continue;
  }
  if (decisions.length === 0) {
    say(`${pack.identity.id}: every clue found at a location already has an anchor.`);
    continue;
  }
  for (const decision of decisions) {
    if (decision.type === "clue") say(`  ${decision.locationId}: ${decision.clueId} -> ${decision.objectId} (${decision.reason})`);
  }
  if (checkOnly) continue;

  try {
    let updated = original;
    for (const decision of decisions) updated = applyDecision(updated, decision);
    // the edits add LF line ends; give the file its own line ends back
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    updated = updated.replace(/\r?\n/g, eol);
    // nothing but the anchors may change: the edited text must parse to exactly the pack the decisions describe
    if (!isDeepStrictEqual(JSON.parse(updated), pack)) throw new Error("the anchor edits did not produce the expected pack.");
    writeFileSync(path, updated);
  } catch (error) {
    complain(`ERROR ${pack.identity.id}: ${(error as Error).message}`);
    continue;
  }
  say(`${pack.identity.id}: ${decisions.filter((d) => d.type === "clue").length} clue(s) anchored.`);
}

if (problems > 0) {
  console.error(`${problems} problem(s).`);
  process.exit(1);
}

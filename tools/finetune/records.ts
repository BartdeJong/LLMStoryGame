import { appendFileSync, existsSync, readFileSync, truncateSync } from "node:fs";
import { repeatsCharacterLine } from "../../src/dialogue/quality";
import type { ChatMessage } from "../../src/llm/types";

export const TASKS = ["dialogue", "greeting", "summary", "ending"] as const;
export type Task = (typeof TASKS)[number];

export interface TrainingRecord {
  id: string; // "<session>/<task>/<n>"
  task: Task;
  story: string;
  character: string | null; // cast id; null for summaries and endings
  messages: ChatMessage[]; // system, user, assistant
}

// The first two messages are what the game sent (system, user); the assistant message is the cleaned JSON value.
export function toRecord(input: {
  id: string;
  task: Task;
  story: string;
  character: string | null;
  messages: readonly ChatMessage[];
  value: unknown;
}): TrainingRecord {
  const system = input.messages.find((message) => message.role === "system");
  const user = input.messages.find((message) => message.role === "user");
  if (!system || !user) throw new Error("A record needs the system and user messages of the call.");
  return {
    id: input.id,
    task: input.task,
    story: input.story,
    character: input.character,
    messages: [
      { role: "system", content: system.content },
      { role: "user", content: user.content },
      { role: "assistant", content: JSON.stringify(input.value) },
    ],
  };
}

function comparable(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

// Keeps the lines accepted so far per character. A line is a duplicate when it matches one exactly or repeats
// one the way the game's own repeat check sees it.
export class Deduper {
  // exactOnly skips the fuzzy repeat check (for greetings, which are light rephrasings of a few authored lines).
  constructor(private readonly exactOnly = false) {}

  private readonly lines = new Map<string, string[]>();
  private readonly exact = new Map<string, Set<string>>();

  // Returns why the line is not new, or null (without remembering it).
  check(character: string, line: string): "duplicate" | "repeat" | null {
    if (this.exact.get(character)?.has(comparable(line))) return "duplicate";
    if (!this.exactOnly && repeatsCharacterLine(line, this.lines.get(character) ?? [])) return "repeat";
    return null;
  }

  add(character: string, line: string): void {
    const lines = this.lines.get(character) ?? [];
    lines.push(line);
    this.lines.set(character, lines);
    const exact = this.exact.get(character) ?? new Set<string>();
    exact.add(comparable(line));
    this.exact.set(character, exact);
  }

  // Checks and, when the line is new, remembers it.
  accept(character: string, line: string): "duplicate" | "repeat" | null {
    const reason = this.check(character, line);
    if (!reason) this.add(character, line);
    return reason;
  }
}

function sentenceCount(text: string): number {
  const plain = text.replace(/\b(Mr|Mrs|Ms|Dr|St|Mt|Jr|Sr)\./g, "$1");
  return (plain.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
}

// A summary is at most 280 characters and 2 sentences. Returns the problem, or null when fine.
export function checkSummary(summary: string): string | null {
  const text = summary.trim();
  if (text === "") return "summary is empty";
  if (text.length > 280) return `summary is ${text.length} characters (max 280)`;
  const sentences = sentenceCount(text);
  if (sentences > 2) return `summary has ${sentences} sentences (max 2)`;
  return null;
}

export function checkEnding(ending: { scene: string; epilogue: string }): string | null {
  if (ending.scene.trim() === "") return "ending scene is empty";
  if (ending.epilogue.trim() === "") return "ending epilogue is empty";
  return null;
}

// Every complete line of a JSONL file. A missing file is empty; a truncated or broken line is skipped.
export function readJsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === "object") rows.push(value as Record<string, unknown>);
    } catch {
      // a truncated last line from an interrupted run
    }
  }
  return rows;
}

export const SESSION_DONE_ID = "session/done";

// Sessions that ran to the end: only the explicit marker counts, never the ids of single records.
export function readDoneSessions(path: string): Set<string> {
  const sessions = new Set<string>();
  for (const row of readJsonl(path)) {
    if (row.reason === "done" && typeof row.id === "string" && row.id.endsWith(`/${SESSION_DONE_ID}`)) sessions.add(row.id.split("/")[0]!);
  }
  return sessions;
}

export function readDoneIds(path: string): Set<string> {
  const ids = new Set<string>();
  for (const row of readJsonl(path)) if (typeof row.id === "string") ids.add(row.id);
  return ids;
}

// Makes a JSONL file safe to append to. A last line without a newline is kept (and ended) when it parses;
// only a tail that does not parse is cut off.
export function repairJsonl(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  if (text === "" || text.endsWith("\n")) return;
  const end = text.lastIndexOf("\n") + 1;
  try {
    JSON.parse(text.slice(end));
    appendFileSync(path, "\n");
  } catch {
    truncateSync(path, Buffer.byteLength(text.slice(0, end)));
  }
}

export interface RunIdentity {
  seed: string;
  stories: readonly string[];
  holdout: string | null;
}

// Why an earlier run's files cannot be continued by this run, or null when they can. Catches a holdout
// story leaking into train, and a resume with different settings.
export function checkResume(input: {
  train: readonly Record<string, unknown>[];
  holdout: readonly Record<string, unknown>[];
  manifest: Record<string, unknown> | null;
  run: RunIdentity;
}): string | null {
  const { run } = input;
  if (run.holdout && input.train.some((row) => row.story === run.holdout)) {
    return `train.jsonl already contains rows of the holdout story "${run.holdout}".`;
  }
  const stray = input.holdout.find((row) => row.story !== run.holdout);
  if (stray) return `holdout.jsonl contains a row of story "${String(stray.story)}", not the holdout story ${run.holdout ? `"${run.holdout}"` : "(none)"}.`;
  const manifest = input.manifest;
  if (!manifest) return null;
  if (String(manifest.seed) !== run.seed) return `the manifest was made with seed "${String(manifest.seed)}", this run uses "${run.seed}".`;
  if (JSON.stringify(manifest.stories) !== JSON.stringify(run.stories)) return `the manifest lists stories ${JSON.stringify(manifest.stories)}, this run uses ${JSON.stringify(run.stories)}.`;
  if ((manifest.holdout ?? null) !== run.holdout) return `the manifest holds out ${JSON.stringify(manifest.holdout ?? null)}, this run holds out ${JSON.stringify(run.holdout)}.`;
  return null;
}

// Words a spoken line may use without them being in the prompt.
const COMMON_CAPITALS = new Set([
  "i", "oh", "yes", "no", "mr", "mrs", "ms", "miss", "sir", "madam", "dr", "ah", "well", "hmm", "ha", "hello", "hi", "hey",
  "goodbye", "thanks", "thank", "please", "now", "then", "so", "but", "and", "oh", "o", "ay", "aye", "ahem", "ooh", "mm", "mmm",
]);

function foldWord(word: string): string {
  return word.toLowerCase().replace(/[’]/g, "'").replace(/'s$/, "").replace(/^'+|'+$/g, "");
}

// A cheap guard against invented facts: every capitalised word in the middle of a sentence and every number
// in the reply must appear somewhere in the prompt. `ignore` holds extra words that are always fine (the player's name).
// Returns the words that are not grounded, empty when the line passes.
export function ungroundedWords(line: string, prompt: string, ignore: readonly string[] = []): string[] {
  const haystack = prompt.toLowerCase().replace(/[’]/g, "'");
  const skip = new Set([...COMMON_CAPITALS, ...ignore.flatMap((name) => name.split(/\s+/)).map(foldWord)]);
  const missing: string[] = [];
  const add = (word: string): void => {
    if (!missing.includes(word)) missing.push(word);
  };
  for (const match of line.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const raw = match[0].replace(/[-'’]+$/, "");
    const before = line.slice(0, match.index).replace(/["'“‘\s]+$/u, "");
    const sentenceStart = before === "" || /[.!?:…—–]$/.test(before);
    if (/^\d/.test(raw)) {
      if (!haystack.includes(raw.toLowerCase())) add(raw);
      continue;
    }
    if (!/^\p{Lu}/u.test(raw) || sentenceStart) continue;
    const folded = foldWord(raw);
    if (skip.has(folded) || /^i'/i.test(raw)) continue;
    if (!haystack.includes(folded)) add(raw);
  }
  return missing;
}

export type TaskCounts = Record<Task, number>;

export const MIX_SHARE: Record<Task, number> = { dialogue: 0.8, greeting: 0.1, summary: 0.07, ending: 0.03 };

export function emptyCounts(): TaskCounts {
  return { dialogue: 0, greeting: 0, summary: 0, ending: 0 };
}

// How many records of each task make up `total`: about 80% dialogue, 10% greeting, 7% summary, 3% ending.
export function mixPlan(total: number): TaskCounts {
  const plan = emptyCounts();
  const remainders = TASKS.map((task) => {
    const exact = total * MIX_SHARE[task];
    plan[task] = Math.floor(exact);
    return { task, rest: exact - plan[task] };
  }).sort((a, b) => b.rest - a.rest);
  let left = total - TASKS.reduce((sum, task) => sum + plan[task], 0);
  for (const { task } of remainders) {
    if (left <= 0) break;
    plan[task] += 1;
    left -= 1;
  }
  return plan;
}

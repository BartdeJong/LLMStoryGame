import { appendFileSync, existsSync, readFileSync, truncateSync } from "node:fs";
import { CONVERSATION_END, CONVERSATION_START, GREETING_END, GREETING_START } from "../../src/dialogue/prompt";
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

// A line without case, punctuation or extra spacing, for comparing lines.
export function normalizeLine(text: string): string {
  return comparable(text);
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
  judge: boolean;
  judgeModel: string | null; // the model that judges, null with --no-judge
  judgeThink: string | null; // "off", "low" or "on"; null with --no-judge
  holdoutCount: number | null; // records wanted in holdout.jsonl; null without a holdout story
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
  if ((manifest.holdoutCount ?? null) !== run.holdoutCount) return `the manifest wants ${JSON.stringify(manifest.holdoutCount ?? null)} holdout records, this run wants ${JSON.stringify(run.holdoutCount)}.`;
  if (String(manifest.seed) !== run.seed) return `the manifest was made with seed "${String(manifest.seed)}", this run uses "${run.seed}".`;
  if (JSON.stringify(manifest.stories) !== JSON.stringify(run.stories)) return `the manifest lists stories ${JSON.stringify(manifest.stories)}, this run uses ${JSON.stringify(run.stories)}.`;
  if ((manifest.holdout ?? null) !== run.holdout) return `the manifest holds out ${JSON.stringify(manifest.holdout ?? null)}, this run holds out ${JSON.stringify(run.holdout)}.`;
  if (run.judge && manifest.judge === true && (manifest.judgeModel ?? null) !== run.judgeModel) return `the manifest was judged by "${String(manifest.judgeModel ?? null)}", this run uses "${run.judgeModel}".`;
  if (run.judge && manifest.judge === true && (manifest.judgeThink ?? "on") !== run.judgeThink) return `the manifest was judged with thinking "${String(manifest.judgeThink ?? "on")}", this run uses "${run.judgeThink}".`;
  if (manifest.judge !== run.judge) return `the manifest was made with the judge ${manifest.judge === true ? "on" : "off"}, this run has it ${run.judge ? "on" : "off"}.`;
  return null;
}

// The NPC lines ("You: ...") of the conversation in a dialogue prompt, oldest first.
export function npcHistoryLines(prompt: string): string[] {
  const start = prompt.indexOf(CONVERSATION_START);
  const end = prompt.indexOf(CONVERSATION_END);
  if (start < 0 || end < start) return [];
  return prompt.slice(start + CONVERSATION_START.length, end).split("\n")
    .filter((line) => line.startsWith("You: "))
    .map((line) => line.slice(5).trim());
}

// True when the line repeats, word for word or nearly, something the NPC already said in this prompt's history.
export function repeatsHistory(line: string, prompt: string): boolean {
  const history = npcHistoryLines(prompt);
  return history.some((earlier) => comparable(earlier) === comparable(line)) || repeatsCharacterLine(line, history);
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

function words(text: string): string[] {
  return comparable(text).split(" ").filter(Boolean);
}

function trigrams(text: string): Set<string> {
  const list = words(text);
  const grams = new Set<string>();
  for (let index = 0; index + 3 <= list.length; index += 1) grams.add(list.slice(index, index + 3).join(" "));
  return grams;
}

// Exact and near-duplicate check for longer texts (summaries, ending scenes). Exact means equal after lowercasing,
// stripping punctuation and collapsing whitespace; near means a word-trigram Jaccard of at least 0.8.
// Unlike the line check this does not skip short texts or lean on word overlap, which would flag any two
// summaries of the same story.
export class TextDeduper {
  private readonly texts = new Map<string, { exact: Set<string>; grams: Set<string>[] }>();

  check(key: string, text: string): "duplicate" | "repeat" | null {
    const seen = this.texts.get(key);
    if (!seen) return null;
    if (seen.exact.has(comparable(text))) return "duplicate";
    const grams = trigrams(text);
    if (grams.size === 0) return null;
    for (const earlier of seen.grams) {
      if (earlier.size === 0) continue;
      const shared = [...grams].filter((gram) => earlier.has(gram)).length;
      if (shared / (grams.size + earlier.size - shared) >= 0.8) return "repeat";
    }
    return null;
  }

  add(key: string, text: string): void {
    const seen = this.texts.get(key) ?? { exact: new Set<string>(), grams: [] };
    seen.exact.add(comparable(text));
    seen.grams.push(trigrams(text));
    this.texts.set(key, seen);
  }
}

// What the player last said in a dialogue prompt (the last "Player: ..." line of the conversation).
export function lastPlayerLine(prompt: string): string | null {
  const start = prompt.indexOf(CONVERSATION_START);
  const end = prompt.indexOf(CONVERSATION_END);
  if (start < 0 || end < start) return null;
  const lines = prompt.slice(start + CONVERSATION_START.length, end).split("\n").filter((line) => line.startsWith("Player: "));
  return lines.length > 0 ? lines[lines.length - 1]!.slice(8).trim() : null;
}

// The group a reject reason counts under in the manifest: judge reasons keep their problem names (sorted), digits become N, free-text
// details (ungrounded words, model call counts, brackets) are dropped.
export function reasonBucket(reason: string): string {
  const bucket = reason.replace(/^(ungrounded):.*$/, "$1").replace(/\s*[(\[].*$/, "").trim() || reason;
  const judge = /^judge ([a-z_,]+)$/.exec(bucket);
  if (judge) return `judge ${judge[1]!.split(",").sort().join(",")}`;
  return bucket.replace(/\d+/g, "N");
}

// The authored greeting a greeting prompt asks the model to rephrase (null for other prompts).
export function seedGreeting(prompt: string): string | null {
  const start = prompt.indexOf(GREETING_START);
  const end = prompt.indexOf(GREETING_END);
  if (start < 0 || end < start) return null;
  return prompt.slice(start + GREETING_START.length, end).trim();
}

// True when the greeting is the authored one word for word (ignoring case, punctuation and spacing).
export function copiesSeedGreeting(line: string, prompt: string): boolean {
  const seed = seedGreeting(prompt);
  return seed !== null && seed !== "" && comparable(seed) === comparable(line);
}

// Appends one JSON row as one write of one whole line. The call is synchronous, so workers that run at the same
// time in one process can never interleave partial lines.
export function appendJsonl(path: string, row: unknown): void {
  appendFileSync(path, `${JSON.stringify(row)}\n`);
}

// How many records of each task a run may still add. Reading `allowed` and calling `add` with no await in
// between keeps the quotas exact however many workers there are.
export class Quota {
  readonly plan: TaskCounts;

  constructor(readonly counts: TaskCounts, readonly count: number) {
    this.plan = mixPlan(count);
  }

  total(): number {
    return TASKS.reduce((sum, task) => sum + this.counts[task], 0);
  }

  // A task may add a record while it is under its quota and, until dialogue is full, no further ahead of its
  // share than the run so far, so greetings, summaries and endings spread over the sessions.
  allowed(task: Task): boolean {
    if (this.total() >= this.count || this.counts[task] >= this.plan[task]) return false;
    if (task === "dialogue" || this.counts.dialogue >= this.plan.dialogue) return true;
    return this.counts[task] < Math.ceil(MIX_SHARE[task] * (this.total() + 1));
  }

  add(task: Task): void {
    this.counts[task] += 1;
  }
}

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveAsk } from "../../src/dialogue/askAbout";
import { ConversationController } from "../../src/dialogue/controller";
import type { DialogueTurn } from "../../src/dialogue/controller";
import { LLMClient } from "../../src/llm/client";
import { getLengthView } from "../../src/story/loader";
import type { LengthView } from "../../src/story/loader";
import { writeEnding } from "../../src/story/ending";
import { SUMMARY_EVERY_AREAS } from "../../src/story/state";
import { buildSummaryRequest } from "../../src/story/summary";
import type { StoryPack } from "../../src/story/types";
import { formatIssue, validateStoryPack } from "../../src/story/validate";
import { DEFAULT_OLLAMA_HOST, MAX_CONSECUTIVE_OUTAGES, OllamaBackend } from "./ollamaBackend";
import type { OllamaError, RecordedCall } from "./ollamaBackend";
import { flattenAskOptions, parsePlayerMessages, pickPlayerAction, playerMessagesRequest } from "./playerTurns";
import {
  Deduper,
  MIX_SHARE,
  TASKS,
  checkEnding,
  checkResume,
  checkSummary,
  emptyCounts,
  mixPlan,
  readDoneSessions,
  SESSION_DONE_ID,
  readJsonl,
  repairJsonl,
  toRecord,
  ungroundedWords,
} from "./records";
import type { Task, TaskCounts } from "./records";
import { buildContext, createSeededRandom, pickCharacter, sampleStoryState } from "./sampleState";

interface Args {
  model: string;
  count: number;
  out: string;
  seed: string;
  holdout: string | undefined;
  stories: string[] | undefined;
  host: string;
  temperature: number | undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) fail(`Unexpected argument "${flag ?? ""}". Flags are --model --count --out --seed --holdout --stories --host --temperature.`);
    values.set(flag.slice(2), value);
  }
  const known = ["model", "count", "out", "seed", "holdout", "stories", "host", "temperature"];
  for (const key of values.keys()) if (!known.includes(key)) fail(`Unknown flag --${key}.`);
  const model = values.get("model");
  if (!model) fail("Usage: npm run finetune-data -- --model <ollama tag> [--count 200] [--out finetune-data] [--seed 1] [--holdout <story id>] [--stories a,b] [--host url] [--temperature 0.7]");
  const count = Number(values.get("count") ?? 200);
  if (!Number.isInteger(count) || count < 1) fail("--count must be a positive whole number.");
  const temperature = values.has("temperature") ? Number(values.get("temperature")) : undefined;
  if (temperature !== undefined && !Number.isFinite(temperature)) fail("--temperature must be a number.");
  return {
    model,
    count,
    out: values.get("out") ?? "finetune-data",
    seed: values.get("seed") ?? "1",
    holdout: values.get("holdout"),
    stories: values.get("stories")?.split(",").map((id) => id.trim()).filter(Boolean),
    host: values.get("host") ?? DEFAULT_OLLAMA_HOST,
    temperature,
  };
}

interface Loaded {
  pack: StoryPack;
  view: LengthView;
}

// Same way the story tools read packs: file, validate, length view. loadStoryPack (fetch) is never used.
function loadPack(storyId: string): Loaded {
  const file = resolve("public/stories", `${storyId}.json`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return fail(`Could not read ${file}: ${(error as Error).message}`);
  }
  const report = validateStoryPack(data);
  if (!report.ok || !report.pack) {
    report.errors.forEach((issue) => console.error(formatIssue(issue)));
    return fail(`Story "${storyId}" failed validation (${report.errors.length} error(s)).`);
  }
  if (report.pack.identity.id !== storyId) return fail(`Story file "${storyId}.json" has identity.id "${report.pack.identity.id}".`);
  return { pack: report.pack, view: getLengthView(report.pack) };
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function assistantValue(row: Record<string, unknown>): Record<string, unknown> {
  const messages = row.messages as { role: string; content: string }[] | undefined;
  try {
    return JSON.parse(messages?.[2]?.content ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

const args = parseArgs(process.argv.slice(2));
const storyIds = args.stories ?? readdirSync(resolve("public/stories"))
  .filter((file) => file.endsWith(".json") && file !== "index.json")
  .map((file) => file.replace(/\.json$/, ""))
  .sort();
if (storyIds.length === 0) fail("No stories to use.");
if (args.holdout && !storyIds.includes(args.holdout)) fail(`--holdout "${args.holdout}" is not one of the stories: ${storyIds.join(", ")}`);
const stories = storyIds.map((id) => ({ id, ...loadPack(id) }));

const outDir = resolve(args.out);
mkdirSync(outDir, { recursive: true });
const files = {
  train: resolve(outDir, "train.jsonl"),
  holdout: resolve(outDir, "holdout.jsonl"),
  rejects: resolve(outDir, "rejects.jsonl"),
  manifest: resolve(outDir, "manifest.json"),
};
for (const path of [files.train, files.holdout, files.rejects]) repairJsonl(path);
let previousManifest: Record<string, unknown> | null = null;
if (existsSync(files.manifest)) {
  try {
    previousManifest = JSON.parse(readFileSync(files.manifest, "utf8")) as Record<string, unknown>;
  } catch {
    fail(`${files.manifest} is not valid JSON. Use another --out or remove the old files.`);
  }
}
const resumeProblem = checkResume({
  train: readJsonl(files.train),
  holdout: readJsonl(files.holdout),
  manifest: previousManifest,
  run: { seed: args.seed, stories: storyIds, holdout: args.holdout ?? null },
});
if (resumeProblem) fail(`Cannot continue in ${outDir}: ${resumeProblem} Use another --out or remove the old files.`);

const backend = new OllamaBackend({ host: args.host, ...(args.temperature !== undefined ? { temperature: args.temperature } : {}) });
const client = new LLMClient(backend, { pauseWhenHidden: false });
try {
  await client.load(args.model);
} catch (error) {
  fail((error as Error).message);
}

// Resume state: what earlier runs wrote.
const doneSessions = readDoneSessions(files.rejects);
const counts: TaskCounts = emptyCounts();
const lineDeduper = new Deduper();
const greetingDeduper = new Deduper(true);
const endingDeduper = new Deduper(true);
for (const path of [files.train, files.holdout]) {
  for (const row of readJsonl(path)) {
    const task = row.task as Task;
    if (!TASKS.includes(task)) continue;
    counts[task] += 1;
    const character = String(row.character ?? "");
    const value = assistantValue(row);
    if (task === "dialogue" && typeof value.line === "string") lineDeduper.add(character, value.line);
    if (task === "greeting" && typeof value.line === "string") greetingDeduper.add(character, value.line);
    if (task === "ending" && typeof value.scene === "string") endingDeduper.add("ending", value.scene);
  }
}
const plan = mixPlan(args.count);
const total = (): number => TASKS.reduce((sum, task) => sum + counts[task], 0);
const rejectCounts = new Map<string, number>();

// A task may add a record while it is under its quota and, until dialogue is full, no further ahead of its
// share than the run so far, so greetings, summaries and endings spread over the sessions.
function allowed(task: Task): boolean {
  if (total() >= args.count || counts[task] >= plan[task]) return false;
  if (task === "dialogue" || counts.dialogue >= plan.dialogue) return true;
  return counts[task] < Math.ceil(MIX_SHARE[task] * (total() + 1));
}

const startedAt = Date.now();
let acceptedThisRun = 0;

class CircuitOpen extends Error {}

// Takes what the backend recorded since the last call. Stops the run when Ollama keeps failing.
function take(): { calls: RecordedCall[]; failures: OllamaError[] } {
  const taken = { calls: backend.drain(), failures: backend.drainFailures() };
  checkBreaker();
  return taken;
}

function checkBreaker(): void {
  if (backend.consecutiveOutages >= MAX_CONSECUTIVE_OUTAGES) {
    throw new CircuitOpen(`${backend.consecutiveOutages} HTTP or connection failures in a row; Ollama looks unavailable.`);
  }
}

// An outage says nothing about the sample, so nothing is written for it and the session is not marked done.
const hasOutage = (failures: readonly OllamaError[]): boolean => failures.some((failure) => failure.kind !== "context");
const contextFailure = (failures: readonly OllamaError[]): string | undefined => failures.find((failure) => failure.kind === "context")?.message;

function emit(split: "train" | "holdout", record: ReturnType<typeof toRecord>, shown: string): void {
  appendFileSync(files[split], `${JSON.stringify(record)}\n`);
  counts[record.task] += 1;
  acceptedThisRun += 1;
  const seconds = (Date.now() - startedAt) / 1000 / acceptedThisRun;
  console.log(`[${total()}/${args.count}] ${split} ${record.task}${record.character ? ` ${record.character}` : ""}: ${shown} (${seconds.toFixed(1)}s/example)`);
}

function reject(input: { id: string; task: Task; story: string; character: string | null; reason: string; calls: RecordedCall[]; line?: string }): void {
  const reason = input.reason.replace(/[:(].*$/, "").trim() || input.reason;
  rejectCounts.set(reason, (rejectCounts.get(reason) ?? 0) + 1);
  appendFileSync(files.rejects, `${JSON.stringify({
    id: input.id,
    task: input.task,
    story: input.story,
    character: input.character,
    reason: input.reason,
    ...(input.line !== undefined ? { line: input.line } : {}),
    raw: input.calls.map((call) => call.text),
  })}\n`);
  console.log(`  rejected ${input.task} (${input.reason})`);
}

async function runSession(index: number): Promise<void> {
  const sessionId = `s${String(index).padStart(5, "0")}`;
  const story = stories[index % stories.length]!;
  const { pack, view } = story;
  const split = story.id === args.holdout ? "holdout" : "train";
  const rng = createSeededRandom(`${args.seed}:${sessionId}`);
  backend.beginSession(`${args.seed}:${sessionId}`);
  const outageMark = backend.totalOutages;
  const { state, endingReached } = sampleStoryState(pack, view, rng);
  const character = pickCharacter(pack, view, state, rng);
  console.log(`session ${sessionId}: ${story.id}, ${character.name}${endingReached ? ", after the ending" : ""}, ${state.visitedAreas.length} areas visited`);

  // The rolling summary, as the game writes it once enough areas were visited. It becomes the state's summary.
  if (!endingReached && state.visitedAreas.length >= SUMMARY_EVERY_AREAS) {
    take();
    const result = await client.generateJSON(buildSummaryRequest(pack, view, state));
    const { calls, failures } = take();
    const id = `${sessionId}/summary/0`;
    const summary = result.value.summary.trim();
    const problem = hasOutage(failures) ? "outage" : contextFailure(failures) ?? (result.status !== "ok" ? `summary status ${result.status}` : calls.length !== 1 ? `summary took ${calls.length} model calls` : checkSummary(summary));
    if (problem === "outage") console.log("  summary skipped: Ollama failed");
    else if (problem) reject({ id, task: "summary", story: story.id, character: null, reason: problem, calls });
    else {
      state.summary = summary;
      if (allowed("summary")) emit(split, toRecord({ id, task: "summary", story: story.id, character: null, messages: calls[0]!.messages, value: { summary } }), summary);
    }
  }

  const context = buildContext(pack, view, state, character);
  const controller = new ConversationController(client, pack, state, character, context, { speculate: false, random: rng });

  const handle = (task: Task, turn: DialogueTurn, turnIndex: number): void => {
    const { calls, failures } = take();
    const id = `${sessionId}/${task}/${turnIndex}`;
    const base = { id, task, story: story.id, character: character.id, calls, line: turn.line };
    if (hasOutage(failures)) return console.log("  turn skipped: Ollama failed");
    const overflow = contextFailure(failures);
    if (overflow) return reject({ ...base, reason: overflow });
    // An authored fallback or deflection without a model call is not a sample, so there is nothing to reject.
    if (calls.length === 0) return;
    if (turn.quality !== "generated") return reject({ ...base, reason: `quality ${turn.quality}` });
    if (calls.length !== 1) return reject({ ...base, reason: `needed ${calls.length} model calls (repair or reminder)` });
    const missing = ungroundedWords(turn.line, calls[0]!.messages.map((message) => message.content).join("\n"), [pack.identity.player.name]);
    if (missing.length > 0) return reject({ ...base, reason: `ungrounded: ${missing.join(", ")}` });
    const deduper = task === "greeting" ? greetingDeduper : lineDeduper;
    const duplicate = deduper.check(character.id, turn.line);
    if (duplicate) return reject({ ...base, reason: `${duplicate} line` });
    if (!allowed(task)) return;
    deduper.add(character.id, turn.line);
    emit(split, toRecord({ id, task, story: story.id, character: character.id, messages: calls[0]!.messages, value: { line: turn.line } }), `"${turn.line}"`);
  };

  take();
  const greeting = await controller.start();
  handle("greeting", greeting, 0);

  if (allowed("dialogue")) {
    const turnCount = 2 + Math.floor(rng() * 5);
    let teacher: string[] = [];
    try {
      const request = playerMessagesRequest({
        character,
        locationName: context.locationName,
        summary: context.storySummary,
        topics: character.knowledge.map((item) => item.ask).slice(0, 6),
      }, 4 + Math.floor(rng() * 5), rng);
      teacher = parsePlayerMessages(await backend.chatJson(request.messages, request.schema));
    } catch (error) {
      console.log(`  player messages unavailable: ${(error as Error).message}`);
      checkBreaker();
    }
    let choices = greeting.choices;
    for (let turnIndex = 1; turnIndex <= turnCount && allowed("dialogue"); turnIndex += 1) {
      const askable = flattenAskOptions(controller.askOptions())
        .filter((entry) => resolveAsk(pack, state, character, entry.subject).source !== "deflection");
      const action = pickPlayerAction(rng, { teacher, choices, askable, last: turnIndex === turnCount });
      if (!action) break;
      take();
      const turn = action.kind === "ask" ? await controller.askAbout(action.subject) : await controller.reply(action.text);
      handle("dialogue", turn, turnIndex);
      choices = turn.choices;
    }
  }
  controller.close();

  if (allowed("ending")) {
    const ending = view.endings[Math.floor(rng() * view.endings.length)]!;
    const variant = ending.flawed && rng() < 0.5 ? ending.flawed : null;
    take();
    const scene = await writeEnding(client, pack, ending, variant);
    const { calls, failures } = take();
    const source = variant ?? ending;
    const id = `${sessionId}/ending/0`;
    const value = { scene: scene.scene, epilogue: scene.epilogue };
    const label = `${ending.id}${variant ? " (flawed)" : ""}`;
    const problem = hasOutage(failures) ? "outage" : contextFailure(failures) ?? (calls.length !== 1 ? `ending took ${calls.length} model calls`
      : scene.scene === source.scene_outline ? "ending fell back to the outline"
      : checkEnding(value) ?? (endingDeduper.check("ending", value.scene) ? "duplicate ending" : null));
    if (problem === "outage") console.log("  ending skipped: Ollama failed");
    else if (problem) reject({ id, task: "ending", story: story.id, character: null, reason: `${problem} [${label}]`, calls });
    else {
      endingDeduper.add("ending", value.scene);
      emit(split, toRecord({ id, task: "ending", story: story.id, character: null, messages: calls[0]!.messages, value }), `${label}: ${value.epilogue}`);
    }
  }
  // Only a session that ran to the end without an outage is done; an interrupted one is run again.
  if (backend.totalOutages === outageMark) {
    appendFileSync(files.rejects, `${JSON.stringify({ id: `${sessionId}/${SESSION_DONE_ID}`, reason: "done" })}\n`);
  }
}

function writeManifest(): void {
  const final = emptyCounts();
  const split = { train: emptyCounts(), holdout: emptyCounts() };
  for (const name of ["train", "holdout"] as const) {
    for (const row of readJsonl(files[name])) {
      const task = row.task as Task;
      if (TASKS.includes(task)) {
        split[name][task] += 1;
        final[task] += 1;
      }
    }
  }
  const rejectReasons: Record<string, number> = {};
  for (const row of readJsonl(files.rejects)) {
    const reason = String(row.reason ?? "unknown").replace(/[:(\[].*$/, "").trim();
    if (reason === "done") continue;
    rejectReasons[reason] = (rejectReasons[reason] ?? 0) + 1;
  }
  const elapsed = (Date.now() - startedAt) / 1000;
  writeFileSync(files.manifest, `${JSON.stringify({
    model: args.model,
    host: args.host,
    temperatureOverride: args.temperature ?? null,
    seed: args.seed,
    gitCommit: gitCommit(),
    stories: storyIds,
    holdout: args.holdout ?? null,
    requestedCount: args.count,
    counts: { total: TASKS.reduce((sum, task) => sum + final[task], 0), byTask: final, train: split.train, holdout: split.holdout },
    rejects: rejectReasons,
    lastRun: { acceptedRecords: acceptedThisRun, seconds: Math.round(elapsed), secondsPerAcceptedExample: acceptedThisRun > 0 ? Number((elapsed / acceptedThisRun).toFixed(1)) : null },
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

if (!existsSync(files.manifest)) writeManifest();

console.log(`Model ${args.model} at ${args.host}; stories ${storyIds.join(", ")}${args.holdout ? ` (holdout ${args.holdout})` : ""}; ${total()}/${args.count} records already present.`);
const maxSessions = args.count * 20;
for (let index = 0; index < maxSessions && total() < args.count; index += 1) {
  const sessionId = `s${String(index).padStart(5, "0")}`;
  if (doneSessions.has(sessionId)) continue;
  try {
    await runSession(index);
  } catch (error) {
    if (error instanceof CircuitOpen) {
      writeManifest();
      console.error(`${error.message} Stopped at ${sessionId}; run the same command again to resume.`);
      process.exit(1);
    }
    console.error(`session ${sessionId} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    appendFileSync(files.rejects, `${JSON.stringify({ id: `${sessionId}/session/0`, task: "dialogue", reason: "session error", raw: [String((error as Error).message)] })}\n`);
  }
}

writeManifest();
const final = emptyCounts();
for (const row of [...readJsonl(files.train), ...readJsonl(files.holdout)]) if (TASKS.includes(row.task as Task)) final[row.task as Task] += 1;
const elapsed = (Date.now() - startedAt) / 1000;
console.log(`Done: ${total()} records (${TASKS.map((task) => `${task} ${final[task]}`).join(", ")}); ${[...rejectCounts.values()].reduce((a, b) => a + b, 0)} rejected this run.`);
if (acceptedThisRun > 0) console.log(`Average ${(elapsed / acceptedThisRun).toFixed(1)}s per accepted example this run.`);
if (args.holdout && readJsonl(files.train).some((row) => row.story === args.holdout)) {
  console.error(`train.jsonl contains rows of the holdout story "${args.holdout}". Do not use this data.`);
  process.exit(1);
}
console.log(`Train data: ${files.train}`);
await client.unload();

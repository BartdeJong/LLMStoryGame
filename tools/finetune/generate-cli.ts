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
import type { ChatMessage } from "../../src/llm/types";
import type { StoryPack } from "../../src/story/types";
import { formatIssue, validateStoryPack } from "../../src/story/validate";
import { DEFAULT_OLLAMA_HOST, MAX_CONSECUTIVE_OUTAGES, OllamaBackend } from "./ollamaBackend";
import type { OllamaError, RecordedCall } from "./ollamaBackend";
import { decideSummary, judgeProblemReason, runJudge } from "./judge";
import type { JudgeKind, JudgeOutcome } from "./judge";
import { withPhrase, askLabelReadsWell, flattenAskOptions, parsePlayerMessages, pickPlayerAction, pickRecordedTurns, playerMessagesRequest } from "./playerTurns";
import {
  Quota,
  appendJsonl,
  TASKS,
  checkEnding,
  checkResume,
  checkSummary,
  copiesSeedGreeting,
  normalizeLine,
  reasonBucket,
  repeatsHistory,
  emptyCounts,
  readDoneSessions,
  SESSION_DONE_ID,
  readJsonl,
  repairJsonl,
  toRecord,
  ungroundedWords,
} from "./records";
import type { Task } from "./records";
import { CircuitOpen, FatalRequest, fatalRequestMessage, throwIfTripped } from "./breaker";
import { canMarkSessionDone, rebuildResumeState, sessionDecision } from "./resume";
import { afterSkippedTurn, attemptWithResamples, restoreState, snapshotState } from "./rollback";
import type { AttemptVerdict } from "./rollback";
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
  judge: boolean;
  judgeModel: string;
  judgeThink: "off" | "low" | "on";
  concurrency: number;
  holdoutCount: number; // holdout records to write; 0 without a holdout story
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  let judge = true;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (flag === "--no-judge") {
      judge = false;
      index -= 1;
      continue;
    }
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) fail(`Unexpected argument "${flag ?? ""}". Flags are --model --count --out --seed --holdout --stories --host --temperature --no-judge --judge-model --judge-think --concurrency --holdout-count.`);
    values.set(flag.slice(2), value);
  }
  const known = ["holdout-count", "concurrency", "judge-think", "judge-model", "model", "count", "out", "seed", "holdout", "stories", "host", "temperature"];
  for (const key of values.keys()) if (!known.includes(key)) fail(`Unknown flag --${key}.`);
  const model = values.get("model");
  if (!model) fail("Usage: npm run finetune-data -- --model <ollama tag> [--count 200] [--out finetune-data] [--seed 1] [--holdout <story id>] [--stories a,b] [--host url] [--temperature 0.7] [--no-judge] [--judge-model <tag>] [--judge-think off|low|on (low needs a judge model that supports think levels)] [--concurrency N] [--holdout-count N]");
  const judgeThink = values.get("judge-think") ?? "on";
  if (judgeThink !== "off" && judgeThink !== "low" && judgeThink !== "on") fail("--judge-think must be off, low or on.");
  const concurrency = Number(values.get("concurrency") ?? 1);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) fail("--concurrency must be a whole number from 1 to 16.");
  const count = Number(values.get("count") ?? 200);
  if (values.has("holdout-count") && !values.has("holdout")) fail("--holdout-count needs --holdout <story id>.");
  // --count counts train records; the holdout story gets its own number (a tenth of --count unless given).
  const holdoutCount = !values.has("holdout") ? 0 : values.has("holdout-count") ? Number(values.get("holdout-count")) : Math.round(count / 10);
  if (!Number.isInteger(holdoutCount) || holdoutCount < 0) fail("--holdout-count must be a whole number, 0 or more.");
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
    judge,
    judgeModel: values.get("judge-model") ?? model,
    judgeThink: judgeThink as Args["judgeThink"],
    concurrency,
    holdoutCount,
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
  run: { seed: args.seed, stories: storyIds, holdout: args.holdout ?? null, judge: args.judge, judgeModel: args.judge ? args.judgeModel : null, judgeThink: args.judge ? args.judgeThink : null, holdoutCount: args.holdout ? args.holdoutCount : null },
});
if (resumeProblem) fail(`Cannot continue in ${outDir}: ${resumeProblem} Use another --out or remove the old files.`);

// One backend and client per worker, so each session has its own recorded calls, seed counters and failure counts.
interface Worker {
  backend: OllamaBackend;
  client: LLMClient;
  incomplete: boolean; // the judge gave no verdict somewhere in the current session
}
const workers: Worker[] = [];
for (let index = 0; index < args.concurrency; index += 1) {
  const workerBackend = new OllamaBackend({ host: args.host, ...(args.temperature !== undefined ? { temperature: args.temperature } : {}) });
  const workerClient = new LLMClient(workerBackend, { pauseWhenHidden: false });
  try {
    await workerClient.load(args.model);
  } catch (error) {
    fail((error as Error).message);
  }
  workers.push({ backend: workerBackend, client: workerClient, incomplete: false });
}
const backend = workers[0]!.backend;
if (args.judge && args.judgeModel !== args.model) {
  try {
    await backend.checkModel(args.judgeModel);
  } catch (error) {
    fail(`--judge-model: ${(error as Error).message}`);
  }
}

// Resume state: what earlier runs wrote.
const doneSessions = readDoneSessions(files.rejects);
const { lineDeduper, greetingDeduper, summaryDeduper, endingDeduper, phrases, sessionLines } = rebuildResumeState(
  [...readJsonl(files.train), ...readJsonl(files.holdout)],
);
const MAX_DIALOGUE_PER_SESSION = 3;
// Train and holdout have their own quotas: --count counts train records, --holdout-count holdout records.
const splitCounts = { train: emptyCounts(), holdout: emptyCounts() };
for (const name of ["train", "holdout"] as const) {
  for (const row of readJsonl(files[name])) if (TASKS.includes(row.task as Task)) splitCounts[name][row.task as Task] += 1;
}
const quotas = { train: new Quota(splitCounts.train, args.count), holdout: new Quota(splitCounts.holdout, args.holdoutCount) };
const total = (): number => quotas.train.total() + quotas.holdout.total();
const rejectCounts = new Map<string, number>();

const startedAt = Date.now();
let acceptedThisRun = 0;

// A worker that sees an invalid request stops every worker, like a tripped breaker.
function fatalRequest(detail: string): never {
  const message = fatalRequestMessage(detail, args.judgeThink === "low");
  breakerReason = message;
  throw new FatalRequest(message);
}


// Verdicts where the model said fail without a reason, so code kept the pass.
const judgeStats = { modelSaidFailKept: 0 };
const MAX_TURN_RESAMPLES = 2;
// How often a rejected turn was played again: turns played, rescued by a resample, given up on (the turn is
// skipped; `endedEarly` counts the sessions cut short by two skipped turns in a row) or aborted (an outage or a
// missing verdict).
const resampleStats = { turns: 0, firstTryRejected: 0, rescued: 0, exhausted: 0, aborted: 0, endedEarly: 0 };

// Takes what the backend recorded since the last call. Stops the run when Ollama keeps failing.
function take(w: Worker): { calls: RecordedCall[]; failures: OllamaError[] } {
  const taken = { calls: w.backend.drain(), failures: w.backend.drainFailures() };
  checkBreaker();
  return taken;
}

// Once any worker sees too many failures in a row the whole run stops: every worker talks to the same server.
let breakerReason: string | null = null;
function checkBreaker(): void {
  if (!breakerReason) {
    for (const worker of workers) {
      if (worker.backend.consecutiveRequestErrors >= MAX_CONSECUTIVE_OUTAGES) {
        breakerReason = `${worker.backend.consecutiveRequestErrors} requests in a row were rejected as invalid (HTTP 400); the settings cannot work.`;
      } else if (worker.backend.consecutiveUnreadable >= MAX_CONSECUTIVE_OUTAGES) {
        breakerReason = `${worker.backend.consecutiveUnreadable} judge verdicts in a row could not be read; the judge is not working.`;
      } else if (worker.backend.consecutiveOutages >= MAX_CONSECUTIVE_OUTAGES) {
        breakerReason = `${worker.backend.consecutiveOutages} HTTP or connection failures in a row; Ollama looks unavailable.`;
      }
    }
  }
  if (breakerReason) throw new CircuitOpen(breakerReason);
}

// An outage says nothing about the sample, so nothing is written for it and the session is not marked done.
const hasOutage = (failures: readonly OllamaError[]): boolean => failures.some((failure) => failure.kind === "http" || failure.kind === "connection");
// A prompt that did not fit, or one Ollama rejected as invalid (HTTP 400, with its error body): the sample is
// rejected with that as the reason. Only a run of them in a row stops the run.
const contextFailure = (failures: readonly OllamaError[]): string | undefined => {
  const failure = failures.find((entry) => entry.kind === "context" || entry.kind === "request");
  if (!failure) return undefined;
  return failure.kind === "request" ? `request rejected (${failure.message})` : failure.message;
};

// The fact-check call. It goes around the game's pipeline, so it is not one of the turn's model calls.
// Without a verdict the session cannot be called done; the problem is logged as a reject.
async function judged(
  w: Worker,
  kind: JudgeKind,
  messages: readonly ChatMessage[],
  text: string,
  meta: { id: string; task: Task; story: string; character: string | null; calls: RecordedCall[]; line?: string },
): Promise<JudgeOutcome> {
  const outcome = await runJudge(args.judge ? w.backend : null, kind, messages, text, {
    model: args.judgeModel,
    think: args.judgeThink === "off" ? false : args.judgeThink === "low" ? "low" : true,
  });
  w.backend.drainFailures(); // judge failures belong to no game turn
  if (outcome.status !== "unavailable" && args.judge) w.backend.noteVerdict();
  if (outcome.status === "pass" && outcome.modelSaidFail) judgeStats.modelSaidFailKept += 1;
  if (outcome.status === "unavailable" && outcome.kind === "request") fatalRequest(outcome.error);
  if (outcome.status === "unavailable") {
    console.log(`  judge unavailable (${outcome.kind}): ${outcome.error}`);
    w.incomplete = true;
    if (outcome.kind === "unreadable") w.backend.noteUnreadable();
    const reason = judgeProblemReason(outcome);
    if (reason) reject({ ...meta, reason, note: outcome.error });
    checkBreaker();
  }
  return outcome;
}

function emit(split: "train" | "holdout", record: ReturnType<typeof toRecord>, shown: string): void {
  throwIfTripped(breakerReason); // once a breaker has tripped, nothing more is written
  appendJsonl(files[split], record);
  quotas[split].add(record.task);
  acceptedThisRun += 1;
  const seconds = (Date.now() - startedAt) / 1000 / acceptedThisRun;
  console.log(`[train ${quotas.train.total()}/${args.count}${args.holdout ? `, holdout ${quotas.holdout.total()}/${args.holdoutCount}` : ""}] ${split} ${record.task}${record.character ? ` ${record.character}` : ""}: ${shown} (${seconds.toFixed(1)}s/example)`);
}

function reject(input: { id: string; task: Task; story: string; character: string | null; reason: string; calls: RecordedCall[]; line?: string; note?: string; attempt?: number }): void {
  const reason = reasonBucket(input.reason);
  rejectCounts.set(reason, (rejectCounts.get(reason) ?? 0) + 1);
  appendFileSync(files.rejects, `${JSON.stringify({
    id: input.id,
    task: input.task,
    story: input.story,
    character: input.character,
    reason: input.reason,
    ...(input.line !== undefined ? { line: input.line } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.attempt ? { attempt: input.attempt } : {}),
    raw: input.calls.map((call) => call.text),
  })}\n`);
  console.log(`  rejected ${input.task} (${input.reason})`);
}

async function runSession(index: number, w: Worker): Promise<void> {
  const { backend, client } = w;
  const sessionId = `s${String(index).padStart(5, "0")}`;
  const story = stories[index % stories.length]!;
  const { pack, view } = story;
  const split = story.id === args.holdout ? "holdout" : "train";
  const allowed = (task: Task): boolean => quotas[split].allowed(task);
  const rng = createSeededRandom(`${args.seed}:${sessionId}`);
  backend.beginSession(`${args.seed}:${sessionId}`);
  const outageMark = backend.totalOutages;
  w.incomplete = false;
  const { state, endingReached } = sampleStoryState(pack, view, rng);
  const character = pickCharacter(pack, view, state, rng);
  console.log(`session ${sessionId}: ${story.id}, ${character.name}${endingReached ? ", after the ending" : ""}, ${state.visitedAreas.length} areas visited`);

  // The rolling summary, as the game writes it once enough areas were visited. It becomes the state's summary.
  if (!endingReached && state.visitedAreas.length >= SUMMARY_EVERY_AREAS) {
    take(w);
    const result = await client.generateJSON(buildSummaryRequest(pack, view, state));
    const { calls, failures } = take(w);
    const id = `${sessionId}/summary/0`;
    const summary = result.value.summary.trim();
    const problem = hasOutage(failures) ? "outage" : contextFailure(failures) ?? (result.status !== "ok" ? `summary status ${result.status}` : calls.length !== 1 ? `summary took ${calls.length} model calls` : checkSummary(summary));
    if (problem === "outage") console.log("  summary skipped: Ollama failed");
    else if (problem) reject({ id, task: "summary", story: story.id, character: null, reason: problem, calls });
    else {
      // The summary is the state's summary as soon as the cheap checks pass. Dedupe and judge only decide the record.
      state.summary = summary;
      const meta = { id, task: "summary" as const, story: story.id, character: null, calls, line: summary };
      const action = await decideSummary({
        willEmit: allowed("summary"),
        duplicate: () => summaryDeduper.check(story.id, summary),
        judge: () => judged(w, "summary", calls[0]!.messages, summary, meta),
      });
      if (action.kind === "reject") reject({ ...meta, reason: action.reason, ...(action.note ? { note: action.note } : {}) });
      else if (action.kind === "emit" && allowed("summary") && !summaryDeduper.check(story.id, summary)) {
        summaryDeduper.add(story.id, summary);
        emit(split, toRecord({ id, task: "summary", story: story.id, character: null, messages: calls[0]!.messages, value: { summary } }), summary);
      }
    }
  }

  const context = buildContext(pack, view, state, character);
  const controller = new ConversationController(client, pack, state, character, context, { speculate: false, random: rng });

  let turnAccepted = false;
  let currentAttempt = 0;
  let ended = false; // a turn found no clean reply: nothing further is recorded in this session

  // Checks one reply. "rejected" means play the turn again; "abort" means stop (an outage, a missing verdict).
  // Every reply is judged, recorded or not: a fabricated fact left in the history would end up in later prompts.
  const handle = async (task: Task, turn: DialogueTurn, turnIndex: number, recorded: boolean): Promise<AttemptVerdict> => {
    const { calls, failures } = take(w);
    const id = `${sessionId}/${task}/${turnIndex}`;
    const base = { id, task, story: story.id, character: character.id, calls, line: turn.line, attempt: currentAttempt };
    const bad = (reason: string, note?: string): AttemptVerdict => {
      reject({ ...base, reason, ...(note ? { note } : {}) });
      return "rejected";
    };
    if (hasOutage(failures)) {
      console.log("  turn skipped: Ollama failed");
      return "abort";
    }
    const overflow = contextFailure(failures);
    if (overflow) {
      reject({ ...base, reason: overflow });
      return "abort";
    }
    // An authored fallback or deflection without a model call is not a sample, so there is nothing to check.
    if (calls.length === 0) return "ok";
    if (turn.quality !== "generated") return bad(`quality ${turn.quality}`);
    if (calls.length !== 1) return bad(`needed ${calls.length} model calls (repair or reminder)`);
    // A session that is run again repeats its earlier lines (the seeds are the same). One that is already recorded
    // is accepted without being written again, so it stays in the history and nothing is resampled.
    if (sessionLines.get(sessionId)?.has(normalizeLine(turn.line))) return "ok";
    const promptText = calls[0]!.messages.map((message) => message.content).join("\n");
    const missing = ungroundedWords(turn.line, promptText, [pack.identity.player.name]);
    if (missing.length > 0) return bad(`ungrounded: ${missing.join(", ")}`);
    const userPrompt = calls[0]!.messages.find((message) => message.role === "user")?.content ?? "";
    if (task === "greeting" && copiesSeedGreeting(turn.line, userPrompt)) return bad("copies_seed_greeting");
    if (task === "dialogue" && repeatsHistory(turn.line, userPrompt)) return bad("repeats earlier line");
    const deduper = task === "greeting" ? greetingDeduper : lineDeduper;
    const duplicate = deduper.check(character.id, turn.line);
    if (duplicate) return bad(`${duplicate} line`);
    const verdict = await judged(w, "line", calls[0]!.messages, turn.line, base);
    if (verdict.status === "fail") return bad(verdict.reason, verdict.note);
    if (verdict.status === "unavailable") return "abort";
    // From here to the write there is no await, so other workers cannot slip in between the quota and duplicate
    // checks and the write. A judged line counts for the duplicate check whether or not it becomes a record.
    const taken = deduper.check(character.id, turn.line) !== null;
    if (!taken) deduper.add(character.id, turn.line);
    if (taken || !recorded || !allowed(task)) return "ok";
    emit(split, toRecord({ id, task, story: story.id, character: character.id, messages: calls[0]!.messages, value: { line: turn.line } }), `"${turn.line}"`);
    turnAccepted = true;
    return "ok";
  };

  // Plays one turn. A reply that is rejected is rolled back (history, story state) and asked for again, up to
  // MAX_TURN_RESAMPLES times; if none is clean the session ends here. Returns the accepted turn or null.
  const play = async (task: Task, turnIndex: number, recorded: boolean, run: () => Promise<DialogueTurn>): Promise<{ turn: DialogueTurn | null; status: "ok" | "exhausted" | "abort" }> => {
    const restoreController = controller.checkpoint();
    const snapshot = snapshotState(state);
    const outcome = await attemptWithResamples({
      maxResamples: MAX_TURN_RESAMPLES,
      run: async () => {
        take(w);
        turnAccepted = false;
        return run();
      },
      judge: (turn, attempt) => {
        currentAttempt = attempt;
        return handle(task, turn, turnIndex, recorded);
      },
      rollback: () => {
        restoreController();
        restoreState(state, snapshot);
      },
    });
    resampleStats.turns += 1;
    if (outcome.attempts > 1) resampleStats.firstTryRejected += 1;
    if (outcome.status === "ok") {
      if (outcome.attempts > 1) resampleStats.rescued += 1;
      return { turn: outcome.result, status: "ok" };
    }
    if (outcome.status === "exhausted") resampleStats.exhausted += 1;
    else resampleStats.aborted += 1;
    console.log(`  no clean ${task} reply (${outcome.status})`);
    return { turn: null, status: outcome.status };
  };

  const { turn: greeting } = await play("greeting", 0, true, () => controller.start());
  if (!greeting) ended = true; // without a clean greeting there is no conversation to build on

  if (!ended && allowed("dialogue")) {
    const turnCount = 2 + Math.floor(rng() * 5);
    // Every turn is played so the history builds up, but only a few, spread out, become records.
    const recordedTurns = pickRecordedTurns(turnCount, MAX_DIALOGUE_PER_SESSION, rng);
    let teacher: string[] = [];
    try {
      const request = playerMessagesRequest({
        character,
        locationName: context.locationName,
        summary: context.storySummary,
        topics: character.knowledge.map((item) => item.ask).slice(0, 6),
      }, 4 + Math.floor(rng() * 5), rng);
      teacher = parsePlayerMessages(await backend.chatJson(request.messages, request.schema, { temperature: 1.1 })).filter((message) => phrases.canUse(message));
    } catch (error) {
      console.log(`  player messages unavailable: ${(error as Error).message}`);
      checkBreaker();
    }
    let choices = greeting!.choices;
    let skippedInARow = 0; // turns in a row that found no clean reply
    for (let turnIndex = 1; turnIndex <= turnCount && allowed("dialogue"); turnIndex += 1) {
      const askable = flattenAskOptions(controller.askOptions())
        .filter((entry) => askLabelReadsWell(entry.label) && resolveAsk(pack, state, character, entry.subject).source !== "deflection");
      const action = pickPlayerAction(rng, { teacher, choices: choices.filter((choice) => phrases.canUse(choice)), askable, last: turnIndex === turnCount });
      if (!action) break;
      // The phrase budget counts recorded uses. A use is reserved here (so another worker cannot take the last one
      // while this turn is played) and given back, whatever happens, unless the turn is accepted. A phrase that is
      // over budget at this point skips the action.
      let played: Awaited<ReturnType<typeof play>> | null = null;
      const runTurn = async (): Promise<boolean> => {
        played = await play("dialogue", turnIndex, recordedTurns.has(turnIndex),
          () => (action.kind === "ask" ? controller.askAbout(action.subject) : controller.reply(action.text)));
        return played.turn !== null && turnAccepted;
      };
      if (action.kind === "reply") {
        if ((await withPhrase(phrases, action.text, runTurn)).skipped) continue;
      } else {
        await runTurn();
      }
      const { turn, status } = played as unknown as Awaited<ReturnType<typeof play>>;
      if (!turn) {
        // The turn is already rolled back: skip this player message and go on with the next, unless that happened twice in a row.
        const next = afterSkippedTurn(skippedInARow, status === "abort" ? "abort" : "exhausted");
        skippedInARow = next.skippedInARow;
        if (next.endSession) {
          if (status !== "abort") resampleStats.endedEarly += 1;
          ended = true;
          break;
        }
        continue;
      }
      skippedInARow = 0;
      choices = turn.choices;
    }
  }
  controller.close();

  if (!ended && allowed("ending")) {
    const ending = view.endings[Math.floor(rng() * view.endings.length)]!;
    const variant = ending.flawed && rng() < 0.5 ? ending.flawed : null;
    take(w);
    const scene = await writeEnding(client, pack, ending, variant);
    const { calls, failures } = take(w);
    const source = variant ?? ending;
    const id = `${sessionId}/ending/0`;
    const value = { scene: scene.scene, epilogue: scene.epilogue };
    const label = `${ending.id}${variant ? " (flawed)" : ""}`;
    const problem = hasOutage(failures) ? "outage" : contextFailure(failures) ?? (calls.length !== 1 ? `ending took ${calls.length} model calls`
      : scene.scene === source.scene_outline ? "ending fell back to the outline"
      : checkEnding(value) ?? (endingDeduper.check(story.id, value.scene) ? "duplicate ending" : null));
    if (problem === "outage") console.log("  ending skipped: Ollama failed");
    else if (problem) reject({ id, task: "ending", story: story.id, character: null, reason: `${problem} [${label}]`, calls });
    else {
      const verdict = await judged(w, "ending", calls[0]!.messages, `Scene: ${value.scene}\nEpilogue: ${value.epilogue}`, { id, task: "ending", story: story.id, character: null, calls });
      if (verdict.status === "fail") reject({ id, task: "ending", story: story.id, character: null, reason: `${verdict.reason} [${label}]`, calls, note: verdict.note });
      else if (verdict.status === "pass" && allowed("ending") && !endingDeduper.check(story.id, value.scene)) {
        endingDeduper.add(story.id, value.scene);
        emit(split, toRecord({ id, task: "ending", story: story.id, character: null, messages: calls[0]!.messages, value }), `${label}: ${value.epilogue}`);
      }
    }
  }
  // Only a session that ran to the end without an outage is done; an interrupted one is run again.
  if (canMarkSessionDone({ outagesDuringSession: backend.totalOutages - outageMark, incomplete: w.incomplete })) {
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
    const reason = reasonBucket(String(row.reason ?? "unknown"));
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
    requestedCount: args.count, // train records
    holdoutCount: args.holdout ? args.holdoutCount : null,
    judge: args.judge,
    judgeModel: args.judge ? args.judgeModel : null,
    judgeThink: args.judge ? args.judgeThink : null,
    concurrency: args.concurrency,
    deterministic: args.concurrency === 1,
    concurrencyNote: args.concurrency === 1 ? null : "With concurrency above 1 the content of sessions, not only the order of records, can differ between runs: workers share the duplicate checks, the quotas and the stock-phrase budget, and which session fills a quota depends on timing.",
    counts: { total: TASKS.reduce((sum, task) => sum + final[task], 0), byTask: final, train: split.train, holdout: split.holdout },
    rejects: rejectReasons,
    lastRun: { resamples: resampleStats, judgeModelSaidFailKept: judgeStats.modelSaidFailKept, acceptedRecords: acceptedThisRun, seconds: Math.round(elapsed), secondsPerAcceptedExample: acceptedThisRun > 0 ? Number((elapsed / acceptedThisRun).toFixed(1)) : null },
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

if (!existsSync(files.manifest)) writeManifest();

console.log(`Model ${args.model} at ${args.host}; stories ${storyIds.join(", ")}${args.holdout ? ` (holdout ${args.holdout})` : ""}; train ${quotas.train.total()}/${args.count}${args.holdout ? `, holdout ${quotas.holdout.total()}/${args.holdoutCount}` : ""} records already present.`);
const maxSessions = (args.count + args.holdoutCount) * 20;
let nextSession = 0;

// Each worker takes the next session index that is not done yet. Sessions are independent: each has its own
// rng and seeds, so the data of a session does not depend on how the workers are scheduled.
async function workerLoop(w: Worker): Promise<void> {
  while (nextSession < maxSessions && !breakerReason) {
    const index = nextSession;
    nextSession += 1;
    const sessionId = `s${String(index).padStart(5, "0")}`;
    if (doneSessions.has(sessionId)) continue;
    const decision = sessionDecision({
      isHoldoutStory: stories[index % stories.length]!.id === args.holdout,
      hasHoldout: args.holdout !== undefined,
      trainTotal: quotas.train.total(),
      trainCount: args.count,
      holdoutTotal: quotas.holdout.total(),
      holdoutCount: args.holdoutCount,
    });
    if (decision === "stop") return;
    if (decision === "skip") continue; // this split is full; the session is not marked done
    try {
      await runSession(index, w);
    } catch (error) {
      if (error instanceof CircuitOpen || error instanceof FatalRequest) throw error;
      console.error(`session ${sessionId} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      appendFileSync(files.rejects, `${JSON.stringify({ id: `${sessionId}/session/0`, task: "dialogue", reason: "session error", raw: [String((error as Error).message)] })}\n`);
    }
  }
}

const results = await Promise.allSettled(workers.map((worker) => workerLoop(worker)));
const invalidRequest = results.find((result) => result.status === "rejected" && result.reason instanceof FatalRequest);
if (invalidRequest && invalidRequest.status === "rejected") {
  writeManifest();
  console.error((invalidRequest.reason as Error).message);
  process.exit(1);
}
const tripped = results.find((result) => result.status === "rejected" && result.reason instanceof CircuitOpen);
if (tripped) {
  writeManifest();
  console.error(`${breakerReason ?? "A circuit breaker tripped."} Run the same command again to resume.`);
  process.exit(1);
}
const crashed = results.find((result) => result.status === "rejected");
if (crashed && crashed.status === "rejected") throw crashed.reason;

writeManifest();
const final = emptyCounts();
for (const row of [...readJsonl(files.train), ...readJsonl(files.holdout)]) if (TASKS.includes(row.task as Task)) final[row.task as Task] += 1;
const elapsed = (Date.now() - startedAt) / 1000;
console.log(`Done: ${total()} records (${TASKS.map((task) => `${task} ${final[task]}`).join(", ")}); ${[...rejectCounts.values()].reduce((a, b) => a + b, 0)} rejected this run.`);
console.log(`Turns: ${resampleStats.turns}; rejected on the first try ${resampleStats.firstTryRejected}; rescued by a resample ${resampleStats.rescued}; turns skipped ${resampleStats.exhausted}; sessions ended early ${resampleStats.endedEarly}; aborted ${resampleStats.aborted}.`);
if (acceptedThisRun > 0) console.log(`Average ${(elapsed / acceptedThisRun).toFixed(1)}s per accepted example this run.`);
if (args.holdout && readJsonl(files.train).some((row) => row.story === args.holdout)) {
  console.error(`train.jsonl contains rows of the holdout story "${args.holdout}". Do not use this data.`);
  process.exit(1);
}
console.log(`Train data: ${files.train}`);
for (const worker of workers) await worker.client.unload();

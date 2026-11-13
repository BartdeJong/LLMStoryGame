import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import { ConversationController } from "../../src/dialogue/controller";
import { availableKnowledge, goalHintLine, retrieveKnowledge } from "../../src/dialogue/knowledge";
import { buildDialoguePrompt } from "../../src/dialogue/prompt";
import { LLMClient } from "../../src/llm/client";
import { DIALOGUE_SYSTEM } from "../../src/llm/prompts";
import { getLengthView } from "../../src/story/loader";
import { isRequirementMet } from "../../src/story/requirements";
import { validateStoryPack } from "../../src/story/validate";
import { canMarkSessionDone, rebuildResumeState } from "./resume";
import { afterSkippedTurn, attemptWithResamples, restoreState, snapshotState } from "./rollback";
import { Quota, appendJsonl } from "./records";
import { withPhrase } from "./playerTurns";
import { CircuitOpen, fatalRequestMessage, throwIfTripped } from "./breaker";
import { JUDGE_CONTEXT_CHARS, JUDGE_MAX_TOKENS, JUDGE_SEED, decideSummary, judgeProblemReason, judgeRequest, parseVerdict, runJudge } from "./judge";
import type { JudgeOutcome } from "./judge";
import { MAX_CONSECUTIVE_OUTAGES, NUM_CTX, OllamaBackend } from "./ollamaBackend";
import { PhraseBudget, askLabelReadsWell, parsePlayerMessages, pickPlayerAction, pickRecordedTurns } from "./playerTurns";
import { Deduper, checkEnding, checkResume, checkSummary, mixPlan, readDoneIds, TextDeduper, lastPlayerLine, copiesSeedGreeting, normalizeLine, npcHistoryLines, reasonBucket, readDoneSessions, repeatsHistory, repairJsonl, toRecord, ungroundedWords } from "./records";
import { buildContext, createSeededRandom, openBeatCount, pickCharacter, sampleStoryState } from "./sampleState";

const report = validateStoryPack(fixture);
if (!report.pack) throw new Error("Invalid story fixture");
const pack = report.pack;
const view = getLengthView(pack);

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "finetune-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("sampleStoryState", () => {
  it("is deterministic for a seed", () => {
    const first = sampleStoryState(pack, view, createSeededRandom("seed-a"));
    const second = sampleStoryState(pack, view, createSeededRandom("seed-a"));
    const strip = (value: typeof first) => JSON.stringify({ ...value, state: { ...value.state, progressLog: undefined } });
    expect(strip(first)).toBe(strip(second));
  });

  it("holds earlier must_find, never the whole current one, and keeps the sampled beat open", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const { state, beatIndex, endingReached } = sampleStoryState(pack, view, createSeededRandom(`s${seed}`));
      expect(openBeatCount(view, state)).toBe(beatIndex + 1);
      for (let index = 0; index < beatIndex; index += 1) expect(isRequirementMet(view.beats[index]!.must_find, state)).toBe(true);
      if (!endingReached && beatIndex < view.beats.length - 1) expect(isRequirementMet(view.beats[beatIndex]!.must_find, state)).toBe(false);
      expect(state.visitedAreas).toContain(view.startLocation);
      expect(state.truthsFound.every((id) => pack.truths.some((truth) => truth.id === id))).toBe(true);
    }
  });

  it("marks the ending as reached in roughly 5% of sessions", () => {
    let reached = 0;
    for (let seed = 0; seed < 600; seed += 1) {
      const sampled = sampleStoryState(pack, view, createSeededRandom(`e${seed}`));
      if (sampled.endingReached) {
        reached += 1;
        expect(sampled.state.endingReached?.endingId).toBeTruthy();
      }
    }
    expect(reached).toBeGreaterThan(10);
    expect(reached).toBeLessThan(60);
  });

  it("builds a context the dialogue prompt can use", () => {
    const rng = createSeededRandom("ctx");
    const { state } = sampleStoryState(pack, view, rng);
    const character = pickCharacter(pack, view, state, rng);
    const context = buildContext(pack, view, state, character);
    expect(context.locationName).not.toBe("");
    expect(context.getInventory?.().map((item) => item.id)).toEqual(state.itemsHeld);
  });
});

describe("records", () => {
  it("shapes a record as system, user and the cleaned JSON value", () => {
    const record = toRecord({
      id: "s00001/dialogue/2",
      task: "dialogue",
      story: "example",
      character: "c_mira",
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "usr" }],
      value: { line: "Hello, dear." },
    });
    expect(Object.keys(record)).toEqual(["id", "task", "story", "character", "messages"]);
    expect(record.messages.map((message) => message.role)).toEqual(["system", "user", "assistant"]);
    expect(JSON.parse(record.messages[2]!.content)).toEqual({ line: "Hello, dear." });
  });

  it("dedupes per character, exactly and by the game's repeat check", () => {
    const deduper = new Deduper();
    expect(deduper.accept("mira", "The lantern hook on the square was empty this morning.")).toBeNull();
    expect(deduper.accept("mira", "the lantern hook on the square was empty this morning")).toBe("duplicate");
    expect(deduper.accept("mira", "The lantern hook on the square was empty this morning, dear.")).toBe("repeat");
    expect(deduper.accept("oswin", "The lantern hook on the square was empty this morning.")).toBeNull();
    expect(deduper.accept("mira", "Try the bakery, I baked a fresh loaf for the festival.")).toBeNull();
  });

  it("checks summaries and endings", () => {
    expect(checkSummary("You visited the square. You found the lantern is missing.")).toBeNull();
    expect(checkSummary("")).toMatch(/empty/);
    expect(checkSummary("One. Two. Three.")).toMatch(/sentences/);
    expect(checkSummary("You met Mr. Gruber at St. Bartholomew's. The hat is still missing.")).toBeNull();
    expect(checkSummary("a".repeat(281))).toMatch(/281/);
    expect(checkSummary("a".repeat(280))).toBeNull();
    expect(checkEnding({ scene: "The village cheers.", epilogue: "Warm lights." })).toBeNull();
    expect(checkEnding({ scene: " ", epilogue: "x" })).toMatch(/scene/);
    expect(checkEnding({ scene: "x", epilogue: "" })).toMatch(/epilogue/);
  });

  it("reads done ids, tolerating a missing file and a truncated last line", () => {
    const dir = tempDir();
    const path = join(dir, "train.jsonl");
    expect(readDoneIds(path).size).toBe(0);
    writeFileSync(path, `${JSON.stringify({ id: "a/dialogue/1" })}\n${JSON.stringify({ id: "b/greeting/0" })}\n{"id": "c/dial`);
    expect([...readDoneIds(path)].sort()).toEqual(["a/dialogue/1", "b/greeting/0"]);
    repairJsonl(path);
    appendFileSync(path, `${JSON.stringify({ id: "d/summary/0" })}\n`);
    expect(readFileSync(path, "utf8").split("\n").filter(Boolean)).toHaveLength(3);
    expect(readDoneIds(path).has("d/summary/0")).toBe(true);
  });

  it("splits a total about 80/10/7/3", () => {
    expect(mixPlan(100)).toEqual({ dialogue: 80, greeting: 10, summary: 7, ending: 3 });
    const odd = mixPlan(53);
    expect(odd.dialogue + odd.greeting + odd.summary + odd.ending).toBe(53);
    expect(odd.dialogue).toBeGreaterThanOrEqual(42);
    expect(odd.dialogue).toBeLessThanOrEqual(43);
  });
});

describe("player turns", () => {
  it("parses teacher messages and picks actions", () => {
    expect(parsePlayerMessages('{"messages":["  \\"hi there\\" ","hi there","what lantern?",""]}')).toEqual(["hi there", "what lantern?"]);
    expect(parsePlayerMessages("not json")).toEqual([]);
    const teacher = ["only message"];
    const action = pickPlayerAction(() => 0.9, { teacher, choices: ["Goodbye."], askable: [], last: false });
    expect(action).toEqual({ kind: "reply", text: "only message", source: "teacher" });
    expect(pickPlayerAction(() => 0.9, { teacher, choices: ["Goodbye."], askable: [], last: false })).toBeNull();
  });
});

describe("OllamaBackend with the game's own pipeline", () => {
  it("sends the compact dialogue prompt the game builds, with the WebLLM sampling settings", async () => {
    const requests: { url: string; body?: Record<string, unknown> }[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) });
      if (url.endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "teacher:1b" }] }));
      return new Response(JSON.stringify({ message: { content: '{"line":"The hook on the square was empty this morning, dear!"}' }, eval_count: 12, eval_duration: 1e9 }));
    }) as typeof fetch;

    const backend = new OllamaBackend({ host: "http://fake", fetchImpl: fakeFetch });
    await expect(backend.load("missing:7b")).rejects.toThrow(/teacher:1b/);
    const client = new LLMClient(backend, { pauseWhenHidden: false });
    await client.load("teacher:1b");

    const rng = createSeededRandom("prompt");
    const { state } = sampleStoryState(pack, view, rng);
    const character = pack.cast.find((member) => member.id === "c_mira")!;
    const context = buildContext(pack, view, state, character);
    const controller = new ConversationController(client, pack, state, character, context, { speculate: false, random: rng });

    const text = "What happened to the missing lantern?";
    const expected = buildDialoguePrompt({
      character,
      context,
      turns: [{ speaker: "player", text }],
      facts: retrieveKnowledge(availableKnowledge(pack, state, character), text).map((fact) => fact.item),
      goalHint: goalHintLine(character, state, 0),
      handoverLines: [],
      style: "compact",
    });
    const turn = await controller.reply(text);

    const calls = backend.drain();
    expect(turn.quality).toBe("generated");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tag).toBe("dialogue");
    expect(calls[0]!.messages[0]!.content).toContain(DIALOGUE_SYSTEM);
    expect(calls[0]!.messages[1]!.content).toBe(expected);
    const chat = requests.find((request) => request.url.endsWith("/api/chat"))!.body!;
    expect(chat).toMatchObject({ model: "teacher:1b", stream: false, think: false, options: { temperature: 0.7, top_p: 0.8, num_predict: 256 } });
    expect(chat.format).toBeTruthy();
  });

  it("lets a temperature flag override the dialogue temperature", async () => {
    let body: { options: { temperature: number } } | undefined;
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "m" }] }));
      body = JSON.parse(String(init?.body)) as { options: { temperature: number } };
      return new Response(JSON.stringify({ message: { content: "{}" } }));
    }) as typeof fetch;
    const backend = new OllamaBackend({ fetchImpl: fakeFetch, temperature: 1.1 });
    await backend.load("m", () => {});
    await backend.generate({ messages: [{ role: "user", content: "x" }], maxTokens: 10, temperature: 0.2, signal: new AbortController().signal, tag: "dialogue" });
    expect(body?.options.temperature).toBe(1.1);
  });
});

describe("repairJsonl", () => {
  it("keeps a last line that parses and ends it, and cuts one that does not", () => {
    const dir = tempDir();
    const whole = join(dir, "whole.jsonl");
    writeFileSync(whole, `${JSON.stringify({ id: "a/x/0" })}\n${JSON.stringify({ id: "b/x/0" })}`);
    repairJsonl(whole);
    appendFileSync(whole, `${JSON.stringify({ id: "c/x/0" })}\n`);
    expect([...readDoneIds(whole)]).toEqual(["a/x/0", "b/x/0", "c/x/0"]);

    const cut = join(dir, "cut.jsonl");
    writeFileSync(cut, `${JSON.stringify({ id: "a/x/0" })}\n{"id": "b/x`);
    repairJsonl(cut);
    expect(readFileSync(cut, "utf8")).toBe(`${JSON.stringify({ id: "a/x/0" })}\n`);
    repairJsonl(join(dir, "missing.jsonl"));
  });
});

describe("checkResume", () => {
  const run = { seed: "1", stories: ["example", "other"], holdout: "example", judge: true, judgeModel: "judge:1", judgeThink: "on" };
  const manifest = { seed: "1", stories: ["example", "other"], holdout: "example", judge: true, judgeModel: "judge:1", judgeThink: "on" };

  it("accepts fresh and matching output", () => {
    expect(checkResume({ train: [], holdout: [], manifest: null, run })).toBeNull();
    expect(checkResume({ train: [{ story: "other" }], holdout: [{ story: "example" }], manifest, run })).toBeNull();
  });

  it("refuses a holdout story in train, a foreign story in holdout and changed settings", () => {
    expect(checkResume({ train: [{ story: "example" }], holdout: [], manifest: null, run })).toMatch(/train\.jsonl/);
    expect(checkResume({ train: [], holdout: [{ story: "other" }], manifest: null, run })).toMatch(/holdout\.jsonl/);
    expect(checkResume({ train: [], holdout: [], manifest: { ...manifest, seed: "2" }, run })).toMatch(/seed/);
    expect(checkResume({ train: [], holdout: [], manifest: { ...manifest, stories: ["example"] }, run })).toMatch(/stories/);
    expect(checkResume({ train: [], holdout: [], manifest: { ...manifest, holdout: null }, run })).toMatch(/holds out/);
    expect(checkResume({ train: [], holdout: [], manifest: { ...manifest, judge: false }, run })).toMatch(/judge/);
    expect(checkResume({ train: [], holdout: [], manifest: { ...manifest, judgeModel: "other:2" }, run })).toMatch(/judged by/);
    expect(checkResume({ train: [], holdout: [], manifest: { ...manifest, judgeThink: "off" }, run })).toMatch(/thinking/);
    expect(checkResume({ train: [], holdout: [], manifest, run: { ...run, judgeThink: "low" } })).toMatch(/thinking/);
    expect(checkResume({ train: [], holdout: [], manifest: { seed: "1", stories: ["example", "other"], holdout: "example", judge: false }, run: { ...run, judge: false, judgeModel: null, judgeThink: null } })).toBeNull();
    expect(checkResume({ train: [], holdout: [], manifest, run: { ...run, judge: false } })).toMatch(/judge/);
    expect(checkResume({ train: [], holdout: [{ story: "x" }], manifest: null, run: { ...run, holdout: null } })).toMatch(/holdout\.jsonl/);
  });
});

describe("ungroundedWords", () => {
  const prompt = "You are Mira, a baker. Place: Bakery. The player's name is Paddington. Player: tell me about the lantern at Hollis Square";

  it("passes lines whose proper nouns and numbers are in the prompt", () => {
    expect(ungroundedWords("Oh, I saw it at Hollis Square, Mr. Paddington.", prompt, ["Paddington"])).toEqual([]);
    expect(ungroundedWords("Yes, the lantern is missing. Perhaps Sir would help.", prompt)).toEqual([]);
    expect(ungroundedWords("Well, I'm sure Mira's bakery is fine.", prompt)).toEqual([]);
  });

  it("reports invented names and numbers", () => {
    expect(ungroundedWords("I saw Barnaby near the Tower at 9.", prompt)).toEqual(["Barnaby", "Tower", "9"]);
  });

  it("ignores sentence-initial words and the player's name when given", () => {
    expect(ungroundedWords("Barnaby is away. Tomorrow, then.", prompt)).toEqual([]);
    expect(ungroundedWords("Thank you, Marmalade.", "a hat", ["Marmalade Bear"])).toEqual([]);
    expect(ungroundedWords("Thank you, Marmalade.", "a hat")).toEqual(["Marmalade"]);
  });
});

describe("OllamaBackend failures", () => {
  const generate = (backend: OllamaBackend) =>
    backend.generate({ messages: [{ role: "user", content: "x" }], maxTokens: 10, temperature: 0.2, signal: new AbortController().signal, tag: "dialogue" });
  const tagsThen = (chat: () => Response | Promise<Response>): typeof fetch =>
    (async (input: string | URL | Request) => (String(input).endsWith("/api/tags") ? new Response(JSON.stringify({ models: [{ name: "m" }] })) : chat())) as typeof fetch;

  it("counts HTTP and connection failures in a row and resets on success", async () => {
    let mode: "http" | "down" | "ok" = "http";
    const backend = new OllamaBackend({
      fetchImpl: tagsThen(() => {
        if (mode === "down") throw new TypeError("fetch failed");
        return mode === "http" ? new Response("boom", { status: 500 }) : new Response(JSON.stringify({ message: { content: "{}" } }));
      }),
    });
    await backend.load("m", () => {});
    for (let attempt = 0; attempt < MAX_CONSECUTIVE_OUTAGES - 1; attempt += 1) {
      await expect(generate(backend)).rejects.toThrow(/HTTP 500|Could not reach/);
      mode = mode === "http" ? "down" : "http";
    }
    expect(backend.consecutiveOutages).toBe(MAX_CONSECUTIVE_OUTAGES - 1);
    expect(backend.drainFailures().map((failure) => failure.kind)).toEqual(["http", "connection", "http", "connection"]);
    mode = "ok";
    await generate(backend);
    expect(backend.consecutiveOutages).toBe(0);
    expect(backend.totalOutages).toBe(MAX_CONSECUTIVE_OUTAGES - 1);
  });

  it("rejects a prompt that nearly fills the context, without counting an outage", async () => {
    const backend = new OllamaBackend({ fetchImpl: tagsThen(() => new Response(JSON.stringify({ message: { content: "{}" }, prompt_eval_count: NUM_CTX - 10 }))) });
    await backend.load("m", () => {});
    await expect(generate(backend)).rejects.toThrow(/context overflow/);
    expect(backend.drainFailures().map((failure) => failure.kind)).toEqual(["context"]);
    expect(backend.consecutiveOutages).toBe(0);
    expect(backend.calls).toHaveLength(0);
  });

  it("sends num_ctx, a per-call seed and the WebLLM sampling settings", async () => {
    const bodies: { options: Record<string, number> }[] = [];
    const backend = new OllamaBackend({
      fetchImpl: tagsThen(() => new Response(JSON.stringify({ message: { content: "{}" } }))),
    });
    const spy = (backend as unknown as { fetchImpl: typeof fetch }).fetchImpl;
    (backend as unknown as { fetchImpl: typeof fetch }).fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)) as { options: Record<string, number> });
      return spy(input, init);
    }) as typeof fetch;
    await backend.load("m", () => {});
    backend.beginSession("1:s00001");
    await generate(backend);
    await generate(backend);
    backend.beginSession("1:s00001");
    await generate(backend);
    const [first, second, again] = bodies.map((body) => body.options);
    expect(first).toMatchObject({ num_ctx: NUM_CTX, top_p: 0.8, top_k: 0, repeat_penalty: 1, presence_penalty: 0, frequency_penalty: 0 });
    expect(first!.seed).not.toBe(second!.seed);
    expect(again!.seed).toBe(first!.seed);
  });
});

describe("session done markers", () => {
  it("counts only explicit markers, ignoring record ids and interrupted sessions", () => {
    const dir = tempDir();
    const path = join(dir, "rejects.jsonl");
    expect(readDoneSessions(path).size).toBe(0);
    writeFileSync(path, [
      { id: "s00000/dialogue/1", reason: "ungrounded: X" },
      { id: "s00000/session/done", reason: "done" },
      { id: "s00001/dialogue/1", reason: "quality fallback" },
      { id: "s00002/session/0", reason: "empty" },
    ].map((row) => `${JSON.stringify(row)}\n`).join("") + `{"id": "s00003/session/do`);
    expect([...readDoneSessions(path)]).toEqual(["s00000"]);
  });
});

describe("context overflow guards", () => {
  const fetchOf = (chat: () => Response): typeof fetch =>
    (async (input: string | URL | Request) => (String(input).endsWith("/api/tags") ? new Response(JSON.stringify({ models: [{ name: "m" }] })) : chat())) as typeof fetch;
  const params = (content: string, maxTokens: number) =>
    ({ messages: [{ role: "user" as const, content }], maxTokens, temperature: 0.2, signal: new AbortController().signal, tag: "summary" });

  it("uses num_predict as the margin on prompt_eval_count", async () => {
    const backend = new OllamaBackend({ fetchImpl: fetchOf(() => new Response(JSON.stringify({ message: { content: "{}" }, prompt_eval_count: NUM_CTX - 400 }))) });
    await backend.load("m", () => {});
    await expect(backend.generate(params("x", 300))).resolves.toBeTruthy(); // 400 tokens of room for 300
    await expect(backend.generate(params("x", 500))).rejects.toThrow(/context overflow/);
  });

  it("rejects an oversized prompt before calling Ollama", async () => {
    let chats = 0;
    const backend = new OllamaBackend({ fetchImpl: fetchOf(() => { chats += 1; return new Response(JSON.stringify({ message: { content: "{}" } })); }) });
    await backend.load("m", () => {});
    await expect(backend.generate(params("x".repeat(3 * NUM_CTX), 100))).rejects.toThrow(/context overflow/);
    expect(chats).toBe(0);
    expect(backend.drainFailures().map((failure) => failure.kind)).toEqual(["context"]);
  });
});

describe("ungroundedWords after dashes and ellipses", () => {
  it("treats words after an ellipsis or a dash as sentence starts", () => {
    expect(ungroundedWords("Hmm… Barnaby went that way", "nothing here")).toEqual([]);
    expect(ungroundedWords("It was—Barnaby, of course.", "nothing here")).toEqual([]);
    expect(ungroundedWords("Well – Barnaby knows.", "nothing here")).toEqual([]);
    expect(ungroundedWords("It was Barnaby, of course.", "nothing here")).toEqual(["Barnaby"]);
  });
});

describe("judge", () => {
  const context = [{ role: "system" as const, content: "You are Mira." }, { role: "user" as const, content: "Facts: the hat is missing.\nPlayer: hello" }];
  const tagsThen = (verdict: string, seen: { body?: Record<string, unknown>; chats: number }): typeof fetch =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "m" }] }));
      seen.chats += 1;
      seen.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ message: { content: verdict } }));
    }) as typeof fetch;

  it("builds a strict request with the candidate, the prompt it was given and a problem enum", () => {
    const line = judgeRequest("line", context, "I know her very well.");
    expect(line.messages[0]!.content).toMatch(/strict/);
    expect(line.messages[1]!.content).toContain("Facts: the hat is missing.");
    expect(line.messages[1]!.content).toContain("I know her very well.");
    const problems = (line.schema as { properties: { problems: { items: { enum: string[] } } } }).properties.problems.items.enum;
    expect(problems).toEqual(["invents_fact", "contradicts_prompt", "reveals_secret", "ignores_player", "repeats_earlier_line", "too_long", "out_of_character", "modern_or_meta", "breaks_answer_plan", "copies_seed_greeting"]);
    expect(line.messages[0]!.content).toMatch(/factual claims/);
    // The claim scope names what is not a claim, and shows real pass and fail cases.
    expect(line.messages[0]!.content).toMatch(/NOT claims: sensory flavour/);
    expect(line.messages[0]!.content).toMatch(/warm bun/);
    expect(line.messages[0]!.content).toMatch(/clock tower/);
    expect(line.messages[0]!.content).toMatch(/receipt confirms the ward was paid/);
    expect(line.messages[0]!.content).toMatch(/very unusual for him/);
    const ending = judgeRequest("ending", context, "x");
    expect(ending.messages[0]!.content).toMatch(/who did what, how and why/);
    expect(ending.messages[0]!.content).toMatch(/cheering villagers/);
    expect(ending.messages[0]!.content).not.toMatch(/clock tower/);
    expect(line.messages[0]!.content).toMatch(/What do you need/);
    const shape = line.schema as { required: string[]; properties: { claims: { items: { required: string[] } } } };
    expect(shape.required).toEqual(["claims", "problems", "verdict"]);
    expect(shape.properties.claims.items.required).toEqual(["text", "support"]);
    const text = (judgeRequest("summary", context, "x").schema as { properties: { problems: { items: { enum: string[] } } } }).properties.problems.items.enum;
    expect(text).toEqual(["invents_fact", "contradicts_prompt", "too_long"]);
  });

  it("derives the verdict from the claims, ignoring the model's own verdict field", () => {
    const prompt = "Facts: the hat peg in the hall is empty. Jonathan says the hat was not on the peg at breakfast.";
    const supported = '{"claims":[{"text":"the hat peg is empty","support":"the hat peg in the hall is empty"}],"problems":[],"verdict":"fail"}';
    expect(parseVerdict(supported, "line", prompt)).toMatchObject({ verdict: "pass", problems: [], unsupported: [] });
    const invented = '{"claims":[{"text":"the ledger was signed with Vale\'s hand","support":null},{"text":"the hat peg is empty","support":"hat peg in the hall is empty"}],"problems":[],"verdict":"pass"}';
    expect(parseVerdict(invented, "line", prompt)).toMatchObject({
      verdict: "fail",
      problems: ["invents_fact"],
      unsupported: ["the ledger was signed with Vale's hand"],
      note: "unsupported: the ledger was signed with Vale's hand",
    });
    // A quote that is not in the prompt is no support.
    expect(parseVerdict('{"claims":[{"text":"the ward was paid","support":"the ward received full payment on Tuesday"}],"problems":[]}', "line", prompt)?.verdict).toBe("fail");
    expect(parseVerdict('{"claims":[{"text":"x","support":"null"}],"problems":[]}', "line", prompt)?.unsupported).toEqual(["x"]);
    // No claims and no problems passes; a listed problem fails even when every claim is supported.
    expect(parseVerdict('{"claims":[],"problems":[],"verdict":"fail"}', "line", prompt)?.verdict).toBe("pass");
    expect(parseVerdict('{"claims":[],"problems":["ignores_player","bogus"],"verdict":"pass"}', "line", prompt)).toMatchObject({ verdict: "fail", problems: ["ignores_player"] });
    expect(parseVerdict('{"claims":[],"problems":["reveals_secret"]}', "summary", prompt)).toMatchObject({ verdict: "pass", problems: [] });
    expect(parseVerdict('{"verdict":"pass"}', "line", prompt)).toBeNull();
    expect(parseVerdict("nope", "line", prompt)).toBeNull();
  });

  it("calls Ollama at temperature 0 with a fixed seed, outside the recorded calls", async () => {
    const seen: { body?: Record<string, unknown>; chats: number } = { chats: 0 };
    const backend = new OllamaBackend({ fetchImpl: tagsThen('<think>hmm</think>{"claims":[{"text":"damp air holds secrets","support":null}],"problems":["ignores_player"],"verdict":"pass"}', seen), temperature: 1.3 });
    await backend.load("m", () => {});
    const outcome = await runJudge(backend, "line", context, "The damp air holds secrets.", { model: "judge:1" });
    expect(outcome).toEqual({ status: "fail", reason: "judge ignores_player,invents_fact", note: "unsupported: damp air holds secrets" });
    // Only the judge thinks, with a generous budget, at temperature 0 and a fixed seed, on the judge model.
    expect(seen.body).toMatchObject({ model: "judge:1", stream: false, think: true, options: { temperature: 0, seed: JUDGE_SEED, num_predict: JUDGE_MAX_TOKENS } });
    expect(seen.body?.format).toBeTruthy();
    // The judge is not one of the turn's model calls: the one-call accept rule still sees none.
    expect(backend.calls).toHaveLength(0);
  });

  it("passes without calling Ollama when the judge is off", async () => {
    const seen: { body?: Record<string, unknown>; chats: number } = { chats: 0 };
    void tagsThen("{}", seen);
    expect(await runJudge(null, "line", context, "anything")).toEqual({ status: "pass" });
    expect(seen.chats).toBe(0);
  });

  it("reports an Ollama failure as unavailable and counts it as an outage", async () => {
    const backend = new OllamaBackend({
      fetchImpl: (async (input: string | URL | Request) => {
        if (String(input).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "m" }] }));
        return new Response("down", { status: 503 });
      }) as typeof fetch,
    });
    await backend.load("m", () => {});
    expect((await runJudge(backend, "line", context, "x")).status).toBe("unavailable");
    expect(backend.consecutiveOutages).toBe(1);
    const seen: { body?: Record<string, unknown>; chats: number } = { chats: 0 };
    const garbled = new OllamaBackend({ fetchImpl: tagsThen("not json", seen) });
    await garbled.load("m", () => {});
    expect((await runJudge(garbled, "line", context, "x")).status).toBe("unavailable");
  });
});

describe("dedupe and variety rules", () => {
  const prompt = "intro\nCONVERSATION:\nYou: Welcome to the bakery, dear. Have a bun and tell me what brings you.\nPlayer: What do you need?\nEND CONVERSATION\nAnswer plan";

  it("reads the NPC lines of the prompt history and rejects verbatim or near-verbatim repeats", () => {
    expect(npcHistoryLines(prompt)).toEqual(["Welcome to the bakery, dear. Have a bun and tell me what brings you."]);
    expect(repeatsHistory("Welcome to the bakery, dear. Have a bun and tell me what brings you.", prompt)).toBe(true);
    expect(repeatsHistory("welcome to the bakery dear have a bun and tell me what brings you", prompt)).toBe(true);
    expect(repeatsHistory("Welcome to the bakery, dear. Have a bun and tell me what brings you today.", prompt)).toBe(true);
    expect(repeatsHistory("I need flour for the festival cake.", prompt)).toBe(false);
    expect(repeatsHistory("Hello", "no conversation here")).toBe(false);
  });

  it("finds near-duplicate summaries across sessions", () => {
    const deduper = new Deduper();
    expect(deduper.accept("example", "You visited the bakery and learned the lantern is missing.")).toBeNull();
    expect(deduper.accept("example", "You visited the bakery and learned that the lantern is missing.")).toBe("repeat");
    expect(deduper.accept("example", "You visited the bakery and learned the lantern is missing.")).toBe("duplicate");
    expect(deduper.accept("other", "You visited the bakery and learned the lantern is missing.")).toBeNull();
  });

  it("caps recorded turns per session and spreads them over the conversation", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const rng = createSeededRandom(`cap${seed}`);
      for (let turns = 2; turns <= 6; turns += 1) {
        const picked = [...pickRecordedTurns(turns, 3, rng)].sort((a, b) => a - b);
        expect(picked.length).toBe(Math.min(3, turns));
        expect(picked.every((turn) => turn >= 1 && turn <= turns)).toBe(true);
        if (turns === 6) {
          expect(picked[0]).toBeLessThanOrEqual(2);
          expect(picked[2]).toBeGreaterThanOrEqual(5);
        }
      }
    }
  });

  it("limits stock phrases per run", () => {
    const budget = new PhraseBudget(2);
    for (let use = 0; use < 2; use += 1) {
      expect(budget.canUse("Goodbye.")).toBe(true);
      budget.use("goodbye");
    }
    expect(budget.canUse("GOODBYE!")).toBe(false);
    expect(budget.canUse("What do you need?")).toBe(true);
    expect(budget.canUse("What do you know about the lantern?")).toBe(true);
    budget.use("What do you know about the lantern?");
    expect(budget.canUse("What do you know about the lantern?")).toBe(true);
  });

  it("keeps ask-about subjects whose names read well in the game's ask text", () => {
    expect(askLabelReadsWell("Sherlock Holmes")).toBe(true);
    expect(askLabelReadsWell("Duplicate ledger")).toBe(true);
    expect(askLabelReadsWell("Jonathan says the hat was not on the peg at breakfast.")).toBe(false);
    expect(askLabelReadsWell("The hat peg in the hall is empty. Paddington's old hat is n\u2026")).toBe(false);
  });
});

describe("judge without a verdict", () => {
  const context = [{ role: "system" as const, content: "generic writer system message" }, { role: "user" as const, content: "Facts: the hat is missing." }];
  const fetchWith = (chat: () => Response): typeof fetch =>
    (async (input: string | URL | Request) => (String(input).endsWith("/api/tags") ? new Response(JSON.stringify({ models: [{ name: "m" }] })) : chat())) as typeof fetch;

  it("tells unreadable, context and outage apart and names the reject reason", async () => {
    const unreadable = new OllamaBackend({ fetchImpl: fetchWith(() => new Response(JSON.stringify({ message: { content: "no json" } }))) });
    await unreadable.load("m", () => {});
    const a = await runJudge(unreadable, "line", context, "x");
    expect(a).toMatchObject({ status: "unavailable", kind: "unreadable" });
    expect(judgeProblemReason(a)).toBe("judge unreadable");

    const overflow = new OllamaBackend({ fetchImpl: fetchWith(() => new Response(JSON.stringify({ message: { content: "{}" }, prompt_eval_count: 8100 }))) });
    await overflow.load("m", () => {});
    const b = await runJudge(overflow, "line", context, "x");
    expect(b).toMatchObject({ status: "unavailable", kind: "context" });
    expect(judgeProblemReason(b)).toBe("judge context");

    const down = new OllamaBackend({ fetchImpl: fetchWith(() => new Response("x", { status: 500 })) });
    await down.load("m", () => {});
    const c = await runJudge(down, "line", context, "x");
    expect(c).toMatchObject({ status: "unavailable", kind: "outage" });
    expect(judgeProblemReason(c)).toBeNull();
    expect(judgeProblemReason({ status: "pass" })).toBeNull();
  });

  it("counts unreadable verdicts separately and resets only on a parsed verdict", () => {
    const backend = new OllamaBackend();
    for (let attempt = 0; attempt < MAX_CONSECUTIVE_OUTAGES - 1; attempt += 1) backend.noteUnreadable();
    expect(backend.consecutiveUnreadable).toBe(MAX_CONSECUTIVE_OUTAGES - 1);
    expect(backend.consecutiveOutages).toBe(0);
    expect(backend.totalOutages).toBe(0);
    backend.noteVerdict();
    expect(backend.consecutiveUnreadable).toBe(0);
    for (let attempt = 0; attempt < MAX_CONSECUTIVE_OUTAGES; attempt += 1) backend.noteUnreadable();
    expect(backend.consecutiveUnreadable).toBe(MAX_CONSECUTIVE_OUTAGES);
  });

  it("keeps the judge prompt small: no writer system message, bounded context", () => {
    const small = judgeRequest("line", context, "cand");
    expect(small.messages[1]!.content).not.toContain("generic writer system message");
    expect(small.messages[0]!.content.length + small.messages[1]!.content.length).toBeLessThan(5000);
    const huge = judgeRequest("line", [{ role: "user", content: "z".repeat(100000) }], "cand");
    expect(huge.messages[1]!.content.length).toBeLessThan(JUDGE_CONTEXT_CHARS + 300);
  });
});

describe("seeds of game calls", () => {
  it("are not moved by chatJson calls between them", async () => {
    const run = async (withSideCalls: boolean): Promise<number[]> => {
      const seeds: number[] = [];
      const backend = new OllamaBackend({
        fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
          if (String(input).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "m" }] }));
          const body = JSON.parse(String(init?.body)) as { options: { seed: number; temperature: number } };
          if (body.options.temperature !== 0) seeds.push(body.options.seed);
          return new Response(JSON.stringify({ message: { content: "{}" } }));
        }) as typeof fetch,
      });
      await backend.load("m", () => {});
      backend.beginSession("1:s00007");
      const game = () => backend.generate({ messages: [{ role: "user", content: "x" }], maxTokens: 10, temperature: 0.5, signal: new AbortController().signal, tag: "dialogue" });
      await game();
      if (withSideCalls) await backend.chatJson([{ role: "user", content: "j" }], {}, { temperature: 0, exact: true });
      await game();
      if (withSideCalls) await backend.chatJson([{ role: "user", content: "j" }], {}, { temperature: 0, exact: true });
      await game();
      return seeds;
    };
    const plain = await run(false);
    expect(plain).toHaveLength(3);
    expect(new Set(plain).size).toBe(3);
    expect(await run(true)).toEqual(plain);
  });
});

describe("stock phrase budget on resume", () => {
  it("reads the last player message of a dialogue prompt and rebuilds the budget from it", () => {
    const prompt = "x\nCONVERSATION:\nYou: Hello.\nPlayer: Goodbye.\nYou: Bye.\nPlayer: Thanks!\nEND CONVERSATION\ny";
    expect(lastPlayerLine(prompt)).toBe("Thanks!");
    expect(lastPlayerLine("no conversation")).toBeNull();
    const budget = new PhraseBudget(2);
    for (let row = 0; row < 2; row += 1) {
      const said = lastPlayerLine(prompt);
      if (said) budget.use(said);
    }
    expect(budget.canUse("thanks")).toBe(false);
    expect(budget.canUse("Goodbye.")).toBe(true);
  });
});

describe("summary decision", () => {
  const never = async (): Promise<JudgeOutcome> => { throw new Error("judge must not run"); };

  it("skips dedupe and judge when no record will be written", async () => {
    expect(await decideSummary({ willEmit: false, duplicate: () => { throw new Error("no dedupe"); }, judge: never })).toEqual({ kind: "skip" });
  });

  it("rejects a duplicate without judging, rejects a judge fail, emits a pass", async () => {
    expect(await decideSummary({ willEmit: true, duplicate: () => "duplicate", judge: never })).toEqual({ kind: "reject", reason: "duplicate summary" });
    expect(await decideSummary({ willEmit: true, duplicate: () => null, judge: async () => ({ status: "fail", reason: "judge invents_fact", note: "n" }) }))
      .toEqual({ kind: "reject", reason: "judge invents_fact", note: "n" });
    expect(await decideSummary({ willEmit: true, duplicate: () => null, judge: async () => ({ status: "pass" }) })).toEqual({ kind: "emit" });
  });

  it("reports a missing verdict as incomplete, so the session is not marked done", async () => {
    const outcome: JudgeOutcome = { status: "unavailable", kind: "unreadable", error: "x" };
    expect(await decideSummary({ willEmit: true, duplicate: () => null, judge: async () => outcome })).toEqual({ kind: "incomplete", outcome });
  });
});

describe("TextDeduper and reject buckets", () => {
  it("finds exact matches after normalising and near-duplicates by word trigrams, per key", () => {
    const deduper = new TextDeduper();
    const summary = "You visited the bakery and the library, and learned that the festival lantern is missing from the square.";
    deduper.add("example", summary);
    expect(deduper.check("example", "YOU visited the bakery and the library; and learned that the festival lantern is missing from the square")).toBe("duplicate");
    expect(deduper.check("example", "You visited the bakery and the library, and learned that the festival lantern is missing from the plaza.")).toBe("repeat");
    expect(deduper.check("example", "You walked to the clock tower and found a note about the keys to the old cellar door.")).toBeNull();
    expect(deduper.check("example", "You visited the bakery and learned about the lantern.")).toBeNull();
    expect(deduper.check("other", summary)).toBeNull();
    expect(deduper.check("example:", summary)).toBeNull();
  });

  it("keeps judge problem names in the bucket and drops free-text details", () => {
    expect(reasonBucket("judge invents_fact,ignores_player")).toBe("judge ignores_player,invents_fact");
    expect(reasonBucket("judge too_long [e_lantern (flawed)]")).toBe("judge too_long");
    expect(reasonBucket("ungrounded: Barnaby, Tower")).toBe("ungrounded");
    expect(reasonBucket("needed 2 model calls (repair or reminder)")).toBe("needed N model calls");
    expect(reasonBucket("judge too_long,invents_fact")).toBe("judge invents_fact,too_long");
    expect(reasonBucket("summary is 301 characters (max 280)")).toBe("summary is N characters");
    expect(reasonBucket("summary has 3 sentences (max 2)")).toBe("summary has N sentences");
    expect(reasonBucket("repeats earlier line")).toBe("repeats earlier line");
  });
});

describe("resume", () => {
  const row = (task: string, story: string, character: string | null, value: unknown, user = "u") => ({
    id: `s/${task}/0`,
    task,
    story,
    character,
    messages: [{ role: "system", content: "s" }, { role: "user", content: user }, { role: "assistant", content: JSON.stringify(value) }],
  });

  it("rebuilds counts, duplicate checks and the stock-phrase budget from saved records", () => {
    const talk = "CONVERSATION:\nYou: Hi.\nPlayer: Goodbye.\nEND CONVERSATION";
    const state = rebuildResumeState([
      row("dialogue", "a", "c_mira", { line: "The hook on the square was empty this morning." }, talk),
      row("dialogue", "a", "c_mira", { line: "Try the bakery for a fresh loaf of bread." }, talk),
      row("greeting", "a", "c_mira", { line: "Hello, dear, come in." }),
      row("summary", "a", null, { summary: "You visited the bakery and learned the lantern is missing." }),
      row("ending", "b", null, { scene: "The village gathers beneath the lanterns and welcomes the morning together." }),
      { task: "unknown", story: "a" },
    ]);
    expect(state.counts).toEqual({ dialogue: 2, greeting: 1, summary: 1, ending: 1 });
    expect(state.lineDeduper.check("c_mira", "the hook on the square was empty this morning")).toBe("duplicate");
    expect(state.greetingDeduper.check("c_mira", "Hello, dear, come in.")).toBe("duplicate");
    expect(state.summaryDeduper.check("a", "You visited the bakery and learned the lantern is missing.")).toBe("duplicate");
    expect(state.summaryDeduper.check("b", "You visited the bakery and learned the lantern is missing.")).toBeNull();
    expect(state.endingDeduper.check("b", "The village gathers beneath the lanterns and welcomes the morning together.")).toBe("duplicate");
    expect(state.endingDeduper.check("a", "The village gathers beneath the lanterns and welcomes the morning together.")).toBeNull();
    expect(state.phrases.canUse("Goodbye.")).toBe(true); // used twice, budget is 3
    state.phrases.use("goodbye");
    expect(state.phrases.canUse("Goodbye.")).toBe(false);
  });

  it("starts empty without records", () => {
    const state = rebuildResumeState([]);
    expect(state.counts).toEqual({ dialogue: 0, greeting: 0, summary: 0, ending: 0 });
    expect(state.phrases.canUse("Goodbye.")).toBe(true);
  });

  it("marks a session done only with no outage and a verdict for every judged text", () => {
    expect(canMarkSessionDone({ outagesDuringSession: 0, incomplete: false })).toBe(true);
    expect(canMarkSessionDone({ outagesDuringSession: 1, incomplete: false })).toBe(false);
    expect(canMarkSessionDone({ outagesDuringSession: 0, incomplete: true })).toBe(false);
    expect(canMarkSessionDone({ outagesDuringSession: 2, incomplete: true })).toBe(false);
  });
});

describe("rolling back a rejected turn", () => {
  const scripted = (lines: string[]) => {
    const prompts: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "m" }] }));
      const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
      prompts.push(body.messages.find((message) => message.role === "user")!.content);
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ line: lines[prompts.length - 1] }) } }));
    }) as typeof fetch;
    return { prompts, fetchImpl };
  };

  it("keeps a rejected line, and what it marked as told, out of the next prompt", async () => {
    const fabricated = "I sketched the missing lantern myself, three days ago, in my little brown notebook.";
    const { prompts, fetchImpl } = scripted([fabricated, "The hook on the square was empty this morning, dear.", "Try the library, dear, Oswin knows his books."]);
    const backend = new OllamaBackend({ fetchImpl });
    await backend.load("m", () => {});
    const client = new LLMClient(backend, { pauseWhenHidden: false });
    await client.load("m");
    const rng = createSeededRandom("rollback");
    const { state } = sampleStoryState(pack, view, rng);
    const character = pack.cast.find((member) => member.id === "c_mira")!;
    const controller = new ConversationController(client, pack, state, character, buildContext(pack, view, state, character), { speculate: false, random: rng });

    const before = snapshotState(state);
    const restoreController = controller.checkpoint();
    const rejected = await controller.reply("What happened to the missing lantern?");
    expect(rejected.line).toBe(fabricated);
    expect(controller.getTurns()).toHaveLength(2);
    restoreController();
    restoreState(state, before);
    expect(controller.getTurns()).toHaveLength(0);
    expect(state).toEqual(before);

    // The same question again, then a follow-up: neither prompt may carry the rejected line.
    const again = await controller.reply("What happened to the missing lantern?");
    expect(again.line).toMatch(/hook on the square/);
    await controller.reply("Where should I look next?");
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).not.toContain(fabricated);
    expect(prompts[2]).not.toContain(fabricated);
    expect(prompts[2]).toContain("hook on the square");
    expect(prompts[2].match(/Player: What happened to the missing lantern\?/g)).toHaveLength(1);
  });
});

describe("resampling", () => {
  it("replays a rejected turn after a rollback and stops at the first clean one", async () => {
    const log: string[] = [];
    let run = 0;
    const outcome = await attemptWithResamples({
      maxResamples: 2,
      run: async () => `line${++run}`,
      judge: async (line, attempt) => {
        log.push(`judge ${line} #${attempt}`);
        return line === "line2" ? "ok" : "rejected";
      },
      rollback: () => log.push("rollback"),
    });
    expect(outcome).toEqual({ status: "ok", result: "line2", attempts: 2 });
    expect(log).toEqual(["judge line1 #0", "rollback", "judge line2 #1"]);
  });

  it("gives up after the resamples, rolls every attempt back and ends the session there", async () => {
    let rollbacks = 0;
    let run = 0;
    const outcome = await attemptWithResamples({ maxResamples: 2, run: async () => ++run, judge: async () => "rejected", rollback: () => { rollbacks += 1; } });
    expect(outcome).toEqual({ status: "exhausted", result: null, attempts: 3 });
    expect(rollbacks).toBe(3);
  });

  it("stops at once on an abort", async () => {
    let run = 0;
    const outcome = await attemptWithResamples({ maxResamples: 2, run: async () => ++run, judge: async () => "abort", rollback: () => {} });
    expect(outcome).toEqual({ status: "abort", result: null, attempts: 1 });
    expect(run).toBe(1);
  });
});

describe("copies_seed_greeting", () => {
  const prompt = "Rephrase the greeting.\nGREETING TO REPHRASE:\nOh, hello, dear! Have a bun and tell me what brings you by.\nEND GREETING\nReturn JSON";

  it("flags a greeting that is the authored one, apart from case and punctuation", () => {
    expect(copiesSeedGreeting("Oh, hello, dear! Have a bun and tell me what brings you by.", prompt)).toBe(true);
    expect(copiesSeedGreeting("oh hello dear have a bun and tell me what brings you by", prompt)).toBe(true);
    expect(copiesSeedGreeting("Hello, dear! Do have a bun and tell me what brings you by.", prompt)).toBe(false);
    expect(copiesSeedGreeting("Oh, hello, dear!", "a dialogue prompt without a seed")).toBe(false);
  });
});

describe("claim support threshold", () => {
  const prompt = "Facts: the supply receipt shows the ward ordered bandages. Mr Vale's signature is on the duplicate ledger.";
  const verdictFor = (support: string) =>
    parseVerdict(JSON.stringify({ claims: [{ text: "a claim", support }], problems: [] }), "line", prompt)?.verdict;

  it("accepts a quote after normalising case, punctuation and possessives, at 60% word overlap", () => {
    expect(verdictFor("THE SUPPLY RECEIPT, shows the ward ORDERED bandages!")).toBe("pass");
    expect(verdictFor("Vale signature is on the duplicate ledger")).toBe("pass");
    // 3 of 5 words (supply, receipt, ward) are in the prompt: exactly 60%
    expect(verdictFor("supply receipt ward payment tuesday")).toBe("pass");
    // 2 of 5: below the threshold
    expect(verdictFor("supply receipt invoice payment tuesday")).toBe("fail");
    expect(verdictFor("")).toBe("fail");
  });
});

describe("skipping an exhausted turn", () => {
  it("skips the first, ends the session after two in a row, and ends at once on an abort", () => {
    expect(afterSkippedTurn(0, "exhausted")).toEqual({ skippedInARow: 1, endSession: false });
    expect(afterSkippedTurn(1, "exhausted")).toEqual({ skippedInARow: 2, endSession: true });
    expect(afterSkippedTurn(0, "abort")).toEqual({ skippedInARow: 1, endSession: true });
  });
});

describe("last judge refinements", () => {
  const prompt = "Facts: the ward ordered bandages. The receipt is in the drawer.";
  const parse = (claims: unknown[], extra: Record<string, unknown> = {}) => parseVerdict(JSON.stringify({ claims, problems: [], ...extra }), "line", prompt);

  it("cuts an unclosed think block to the end of the text, so the verdict is unreadable", async () => {
    const answer = '{"claims":[],"problems":[],"verdict":"pass"}';
    const backendFor = (content: string) => new OllamaBackend({
      fetchImpl: (async (input: string | URL | Request) =>
        String(input).endsWith("/api/tags") ? new Response(JSON.stringify({ models: [{ name: "m" }] })) : new Response(JSON.stringify({ message: { content } }))) as typeof fetch,
    });
    const closed = backendFor(`<think>a</think>${answer}`);
    await closed.load("m", () => {});
    expect(await closed.chatJson([{ role: "user", content: "x" }], {})).toBe(answer);
    const unclosed = backendFor(`<think>still thinking ${answer}`);
    await unclosed.load("m", () => {});
    expect(await unclosed.chatJson([{ role: "user", content: "x" }], {})).toBe("");
    expect(await runJudge(unclosed, "line", [{ role: "user", content: "x" }], "y")).toMatchObject({ status: "unavailable", kind: "unreadable" });
    // A think tag that reaches the parser is never a clean answer.
    expect(parseVerdict(`<think>${answer}`, "line", prompt)).toBeNull();
  });

  it("keeps the pass when the model says fail without a reason, and says so in the note and the outcome", async () => {
    expect(parse([], { verdict: "fail" })).toMatchObject({ verdict: "pass", modelSaidFail: true, note: "model said fail" });
    expect(parse([], { verdict: "pass" })).toMatchObject({ verdict: "pass", modelSaidFail: false });
    expect(parse([{ text: "x", support: null }], { verdict: "fail" })).toMatchObject({ verdict: "fail", modelSaidFail: false });
    const backend = new OllamaBackend({
      fetchImpl: (async (input: string | URL | Request) =>
        String(input).endsWith("/api/tags") ? new Response(JSON.stringify({ models: [{ name: "m" }] }))
          : new Response(JSON.stringify({ message: { content: '{"claims":[],"problems":[],"verdict":"fail"}' } }))) as typeof fetch,
    });
    await backend.load("m", () => {});
    expect(await runJudge(backend, "line", [{ role: "user", content: prompt }], "Hello!")).toEqual({ status: "pass", modelSaidFail: true });
  });

  it("counts only words of 4 letters or more, and needs a contiguous quote when fewer than 2 such words", () => {
    // "the ward" has one long word: it must appear as it is.
    expect(parse([{ text: "c", support: "the ward" }])?.verdict).toBe("pass");
    expect(parse([{ text: "c", support: "ward bandages" }])?.verdict).toBe("pass"); // two long words, both in the prompt
    expect(parse([{ text: "c", support: "ward in the drawer" }])?.verdict).toBe("pass"); // two long words, both in the prompt
  });

  it("does not let filler words support a claim", () => {
    expect(parse([{ text: "c", support: "the hat is in it" }])?.verdict).toBe("fail");
    expect(parse([{ text: "c", support: "in the drawer" }])?.verdict).toBe("pass"); // one long word, and the quote is in the prompt as it is
    expect(parse([{ text: "c", support: "drawer in the" }])?.verdict).toBe("fail"); // one long word, but not contiguous in the prompt
  });

  it("recognises lines a session already recorded", () => {
    const row = (id: string, line: string) => ({
      id,
      task: "dialogue",
      story: "a",
      character: "c_mira",
      messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }, { role: "assistant", content: JSON.stringify({ line }) }],
    });
    const state = rebuildResumeState([row("s00001/dialogue/2", "Try the bakery, dear!"), row("s00002/dialogue/1", "Other line.")]);
    expect(state.sessionLines.get("s00001")?.has(normalizeLine("try the bakery dear"))).toBe(true);
    expect(state.sessionLines.get("s00001")?.has(normalizeLine("Other line."))).toBe(false);
    expect(state.sessionLines.get("s00003")).toBeUndefined();
  });
});

describe("judge thinking level", () => {
  const sent = async (think?: boolean | "low") => {
    let body: { think?: unknown } = {};
    const backend = new OllamaBackend({
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "m" }] }));
        body = JSON.parse(String(init?.body)) as { think?: unknown };
        return new Response(JSON.stringify({ message: { content: '{"claims":[],"problems":[],"verdict":"pass"}' } }));
      }) as typeof fetch,
    });
    await backend.load("m", () => {});
    await runJudge(backend, "line", [{ role: "user", content: "x" }], "hi", think === undefined ? {} : { think });
    return body.think;
  };

  it("sends think on by default, off for off and \"low\" for low; the teacher stays off", async () => {
    expect(await sent()).toBe(true);
    expect(await sent(false)).toBe(false);
    expect(await sent("low")).toBe("low");
    let teacherThink: unknown = "unset";
    const backend = new OllamaBackend({
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "m" }] }));
        teacherThink = (JSON.parse(String(init?.body)) as { think?: unknown }).think;
        return new Response(JSON.stringify({ message: { content: "{}" } }));
      }) as typeof fetch,
    });
    await backend.load("m", () => {});
    await backend.generate({ messages: [{ role: "user", content: "x" }], maxTokens: 10, temperature: 0.5, signal: new AbortController().signal, tag: "dialogue" });
    expect(teacherThink).toBe(false);
  });
});

describe("concurrent workers", () => {
  const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

  it("never interleave lines and never exceed the quotas", async () => {
    const dir = tempDir();
    const path = join(dir, "train.jsonl");
    const quota = new Quota({ dialogue: 0, greeting: 0, summary: 0, ending: 0 }, 50);
    const tasks = ["dialogue", "dialogue", "dialogue", "dialogue", "greeting", "summary", "ending"] as const;
    const worker = async (id: number) => {
      for (let step = 0; step < 60; step += 1) {
        const task = tasks[(id + step) % tasks.length]!;
        await pause(Math.random() * 3); // the model call
        // check and write with no await between, as the CLI does
        if (!quota.allowed(task)) continue;
        appendJsonl(path, { id: `w${id}/${step}`, task, text: "x".repeat(2000 + id) });
        quota.add(task);
      }
    };
    await Promise.all([0, 1, 2, 3].map(worker));
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    const rows = lines.map((line) => JSON.parse(line) as { id: string; task: keyof typeof quota.counts });
    expect(rows).toHaveLength(lines.length);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(rows.length).toBe(quota.total());
    expect(rows.length).toBeLessThanOrEqual(50);
    for (const task of ["dialogue", "greeting", "summary", "ending"] as const) {
      expect(rows.filter((row) => row.task === task).length).toBeLessThanOrEqual(quota.plan[task]);
    }
    expect(rows.length).toBeGreaterThan(40);
  });

  it("keep each session's seeds the same however the workers are scheduled", async () => {
    const seedsOf = async (interleaved: boolean) => {
      const seen = new Map<string, number[]>();
      const makeBackend = (name: string) => {
        const backend = new OllamaBackend({
          fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
            if (String(input).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "m" }] }));
            const body = JSON.parse(String(init?.body)) as { options: { seed: number } };
            seen.set(name, [...(seen.get(name) ?? []), body.options.seed]);
            return new Response(JSON.stringify({ message: { content: "{}" } }));
          }) as typeof fetch,
        });
        return backend;
      };
      const a = makeBackend("s1");
      const b = makeBackend("s2");
      await a.load("m", () => {});
      await b.load("m", () => {});
      a.beginSession("1:s00001");
      b.beginSession("1:s00002");
      const call = (backend: OllamaBackend) =>
        backend.generate({ messages: [{ role: "user", content: "x" }], maxTokens: 10, temperature: 0.5, signal: new AbortController().signal, tag: "dialogue" });
      if (interleaved) {
        await Promise.all([call(a), call(b), pause(2)]);
        await Promise.all([call(b), call(a)]);
        await call(a);
      } else {
        await call(a);
        await call(a);
        await call(a);
        await call(b);
        await call(b);
      }
      return { s1: seen.get("s1"), s2: seen.get("s2"), callsA: a.calls.length, callsB: b.calls.length };
    };
    const together = await seedsOf(true);
    const apart = await seedsOf(false);
    expect(together.s1).toEqual(apart.s1);
    expect(together.s2).toEqual(apart.s2);
    expect(new Set([...together.s1!, ...together.s2!]).size).toBe(5);
    // each worker's recorded calls are its own
    expect(together.callsA).toBe(3);
    expect(together.callsB).toBe(2);
  });
});

describe("review items", () => {
  it("reads a manifest without judgeThink as thinking on when the judge was on", () => {
    const manifest = { seed: "1", stories: ["a"], holdout: null, judge: true, judgeModel: "m" };
    const run = { seed: "1", stories: ["a"], holdout: null, judge: true, judgeModel: "m", judgeThink: "on" };
    expect(checkResume({ train: [], holdout: [], manifest, run })).toBeNull();
    expect(checkResume({ train: [], holdout: [], manifest, run: { ...run, judgeThink: "off" } })).toMatch(/thinking "on"/);
  });

  it("treats HTTP 400 as an invalid request, not an outage, and gives a clear message", async () => {
    const backend = new OllamaBackend({
      fetchImpl: (async (input: string | URL | Request) =>
        String(input).endsWith("/api/tags") ? new Response(JSON.stringify({ models: [{ name: "m" }] })) : new Response('{"error":"think level not supported"}', { status: 400 })) as typeof fetch,
    });
    await backend.load("m", () => {});
    const outcome = await runJudge(backend, "line", [{ role: "user", content: "x" }], "hi", { think: "low" });
    expect(outcome).toMatchObject({ status: "unavailable", kind: "request" });
    expect(backend.consecutiveOutages).toBe(0);
    expect(backend.totalOutages).toBe(0);
    expect(backend.drainFailures().map((failure) => failure.kind)).toEqual(["request"]);
    expect(fatalRequestMessage("HTTP 400", true)).toMatch(/--judge-think low.*think levels/);
    expect(fatalRequestMessage("HTTP 400")).not.toMatch(/think levels/);
    expect(fatalRequestMessage("HTTP 400", false)).toContain("HTTP 400");
  });

  it("stops writing once a breaker has tripped", () => {
    expect(() => throwIfTripped(null)).not.toThrow();
    expect(() => throwIfTripped("5 failures in a row")).toThrow(CircuitOpen);
  });

  it("reserves a stock phrase when it is picked and gives it back when the turn is not recorded", () => {
    const budget = new PhraseBudget(2);
    // two workers pick "Goodbye." at the same time
    expect(budget.canUse("Goodbye.")).toBe(true);
    budget.use("Goodbye.");
    expect(budget.canUse("Goodbye.")).toBe(true);
    budget.use("Goodbye.");
    expect(budget.canUse("Goodbye.")).toBe(false); // a third worker cannot take it while both turns are played
    budget.release("Goodbye."); // one turn was not recorded
    expect(budget.canUse("Goodbye.")).toBe(true);
    budget.release("What a day"); // not a watched phrase: nothing happens
    budget.release("Goodbye.");
    budget.release("Goodbye."); // never below zero
    budget.use("Goodbye.");
    budget.use("Goodbye.");
    expect(budget.canUse("Goodbye.")).toBe(false);
  });
});

describe("phrase budget at pick time and with errors", () => {
  it("use() takes nothing and returns false when the phrase is over budget", () => {
    const budget = new PhraseBudget(1);
    expect(budget.use("Goodbye.")).toBe(true);
    expect(budget.use("goodbye")).toBe(false);
    expect(budget.canUse("Goodbye.")).toBe(false);
    budget.release("Goodbye.");
    expect(budget.use("Goodbye.")).toBe(true);
    expect(budget.use("Tell me about the lantern")).toBe(true); // not a watched phrase
    expect(budget.use("Tell me about the lantern")).toBe(true);
  });

  it("keeps a reserved use only for an accepted turn, even when the turn throws", async () => {
    const budget = new PhraseBudget(1);
    expect(await withPhrase(budget, "Goodbye.", async () => true)).toEqual({ skipped: false });
    expect(budget.canUse("Goodbye.")).toBe(false); // kept: it was recorded
    expect(await withPhrase(budget, "Goodbye.", async () => { throw new Error("must not run"); })).toEqual({ skipped: true });

    const other = new PhraseBudget(1);
    await withPhrase(other, "Thanks", async () => false); // rejected or skipped turn
    expect(other.canUse("Thanks")).toBe(true);
    await expect(withPhrase(other, "Thanks", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(other.canUse("Thanks")).toBe(true); // given back after the error too

    // two turns in flight at once cannot both take the last use
    const shared = new PhraseBudget(1);
    const results = await Promise.all([
      withPhrase(shared, "Goodbye.", async () => { await new Promise((done) => setTimeout(done, 5)); return true; }),
      withPhrase(shared, "Goodbye.", async () => true),
    ]);
    expect(results.filter((result) => result.skipped)).toHaveLength(1);
  });

  it("counts HTTP 400 answers in a row on game calls and resets on a good answer", async () => {
    let status = 400;
    const backend = new OllamaBackend({
      fetchImpl: (async (input: string | URL | Request) =>
        String(input).endsWith("/api/tags") ? new Response(JSON.stringify({ models: [{ name: "m" }] }))
          : status === 400 ? new Response('{"error":"bad option"}', { status }) : new Response(JSON.stringify({ message: { content: "{}" } }))) as typeof fetch,
    });
    await backend.load("m", () => {});
    const call = () => backend.generate({ messages: [{ role: "user", content: "x" }], maxTokens: 10, temperature: 0.5, signal: new AbortController().signal, tag: "dialogue" });
    for (let attempt = 0; attempt < MAX_CONSECUTIVE_OUTAGES - 1; attempt += 1) await expect(call()).rejects.toThrow(/HTTP 400.*bad option/);
    expect(backend.consecutiveRequestErrors).toBe(MAX_CONSECUTIVE_OUTAGES - 1);
    expect(backend.consecutiveOutages).toBe(0);
    status = 200;
    await call();
    expect(backend.consecutiveRequestErrors).toBe(0);
    const failure = backend.drainFailures().find((entry) => entry.kind === "request");
    expect(failure?.message).toContain("bad option"); // the error body travels with the failure, for the reject reason
  });
});

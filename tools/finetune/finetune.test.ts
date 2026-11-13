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
import { MAX_CONSECUTIVE_OUTAGES, NUM_CTX, OllamaBackend } from "./ollamaBackend";
import { parsePlayerMessages, pickPlayerAction } from "./playerTurns";
import { Deduper, checkEnding, checkResume, checkSummary, mixPlan, readDoneIds, readDoneSessions, repairJsonl, toRecord, ungroundedWords } from "./records";
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
  const run = { seed: "1", stories: ["example", "other"], holdout: "example" };
  const manifest = { seed: "1", stories: ["example", "other"], holdout: "example" };

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

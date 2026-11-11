import { describe, expect, it, vi } from "vitest";
import fixture from "../story/fixtures/example-pack.json";
import { BedrockGatewayBackend } from "../llm/bedrockGatewayBackend";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import type { MockOptions } from "../llm/mock";
import { Priority } from "../llm/types";
import type { JobEvent } from "../llm/types";
import { getLengthView } from "../story/loader";
import { createStoryState } from "../story/state";
import type { StoryPack } from "../story/types";
import { validateStoryPack } from "../story/validate";
import { ConversationController } from "./controller";
import { QUICK_GOODBYE, QUICK_NEED } from "./knowledge";
import { buildLineRequest } from "./prompt";
import { GreetingPrefetcher } from "./speculation";

const SENTENCES = [
  "Welcome, traveller, the reading room is quiet today.",
  "Ah, that old story always makes the candles flicker.",
  "Mind the creaking stair near the back shelves, friend.",
  "Honestly, I could use a hand with the dusty catalogue.",
  "Somebody left a curious note beside the window earlier.",
  "Every book here has a secret if you listen closely.",
  "Please, take your time and look around as you like.",
  "The lamp by the desk burns brighter when it rains.",
];

function loadPack(): StoryPack {
  const report = validateStoryPack(fixture);
  if (!report.pack) throw new Error("fixture pack is invalid");
  return report.pack;
}

const context = { locationName: "Owl Library", locationMood: "hushed", storySummary: "", inventory: [] };

function setup(options: MockOptions = {}, speculates = true) {
  const pack = loadPack();
  const character = pack.cast.find((c) => c.id === "c_oswin")!;
  const state = createStoryState(getLengthView(pack, "short"));
  let calls = 0;
  const backend = new MockBackend({
    ...options,
    respond: () => JSON.stringify({ line: SENTENCES[calls++ % SENTENCES.length] }),
  });
  if (!speculates) Object.defineProperty(backend, "supportsSpeculation", { value: false });
  const client = new LLMClient(backend, { pauseWhenHidden: false });
  const events: JobEvent[] = [];
  client.on("job", (event) => events.push(event));
  return { pack, character, state, client, backend, events };
}

function newController(env: ReturnType<typeof setup>, speculate = true): ConversationController {
  return new ConversationController(env.client, env.pack, env.state, env.character, context, { random: () => 0, speculate });
}

function speculationCount(choices: readonly string[]): number {
  return Math.min(2, choices.filter((choice) => choice !== QUICK_NEED && choice !== QUICK_GOODBYE).length) + 1;
}

const isRealGeneration = (event: JobEvent): boolean => event.id.startsWith("dialogue-");

describe("speculative replies", () => {
  it("reuses a speculated reply without generating again", async () => {
    const env = setup();
    await env.client.load();
    const controller = newController(env);
    const opening = await controller.start();
    const quick = opening.choices.find((choice) => choice !== QUICK_GOODBYE)!;
    await vi.waitFor(() => expect(env.backend.calls).toBe(1 + speculationCount(opening.choices)));

    const turn = await controller.reply(quick);
    expect(env.events.filter(isRealGeneration)).toEqual([]);
    expect(turn.quality).toBe("generated");
    expect(SENTENCES).toContain(turn.line);
    expect(controller.getTurns().map((entry) => entry.speaker)).toEqual(["character", "player", "character"]);
    controller.close();
  });

  it("uses a speculative job that is still running", async () => {
    const env = setup({ delayMs: 15 });
    await env.client.load();
    const controller = newController(env);
    const opening = await controller.start();
    const turn = await controller.reply(opening.choices.find((choice) => choice !== QUICK_GOODBYE)!);
    expect(turn.quality).toBe("generated");
    expect(env.events.filter(isRealGeneration)).toEqual([]);
    controller.close();
  });

  it("cancels speculation when the player says something else", async () => {
    const env = setup({ delayMs: 20 });
    await env.client.load();
    const controller = newController(env);
    await controller.start();
    const firstRound = new Set(env.events.filter((event) => event.id.startsWith("spec-")).map((event) => event.id));
    expect(firstRound.size).toBeGreaterThan(0);
    await controller.reply("Tell me about the weather outside.");
    expect(env.events.some(isRealGeneration)).toBe(true);
    for (const id of firstRound) {
      const states = env.events.filter((event) => event.id === id).map((event) => event.state);
      expect(states).not.toContain("done");
    }
    expect(env.events.filter((event) => firstRound.has(event.id) && event.state === "cancelled").length).toBeGreaterThan(0);
    controller.close();
  });

  it("changes no state or turns before commit", async () => {
    const env = setup();
    await env.client.load();
    const controller = newController(env);
    const opening = await controller.start();
    const stateBefore = structuredClone(env.state);
    const turnsBefore = structuredClone(controller.getTurns());
    await vi.waitFor(() => expect(env.backend.calls).toBe(1 + speculationCount(opening.choices)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(env.state).toEqual(stateBefore);
    expect(controller.getTurns()).toEqual(turnsBefore);
    controller.close();
  });

  it("stops everything when the conversation closes", async () => {
    const env = setup({ delayMs: 20 });
    await env.client.load();
    const controller = newController(env);
    await controller.start();
    controller.close();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(env.events.some((event) => event.id.startsWith("spec-") && event.state === "done")).toBe(false);
  });

  it("never speculates when the backend does not support it", async () => {
    const env = setup({}, false);
    await env.client.load();
    const controller = newController(env);
    await controller.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(env.backend.calls).toBe(1);
    expect(env.client.supportsSpeculation).toBe(false);
    expect(new BedrockGatewayBackend({ endpoint: "https://gateway.example/invoke", token: "t" }).supportsSpeculation).toBe(false);
    const greetings = new GreetingPrefetcher(env.client);
    greetings.prefetch(env.character, context);
    expect(greetings.size).toBe(0);
  });

  it("does not speculate unless asked to", async () => {
    const env = setup();
    await env.client.load();
    const controller = newController(env, false);
    await controller.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(env.backend.calls).toBe(1);
  });
});

describe("speculative greetings", () => {
  it("reuses a prefetched greeting when the conversation starts", async () => {
    const env = setup();
    await env.client.load();
    const greetings = new GreetingPrefetcher(env.client, () => 0);
    greetings.prefetch(env.character, context);
    await vi.waitFor(() => expect(env.backend.calls).toBe(1));
    const controller = new ConversationController(env.client, env.pack, env.state, env.character, context, {
      random: () => 0,
      greetings,
    });
    const turn = await controller.start();
    expect(env.backend.calls).toBe(1);
    expect(turn.quality).toBe("generated");
    expect(SENTENCES).toContain(turn.line);
  });
});

describe("speculative priority", () => {
  it.each([["dialogue", Priority.Dialogue], ["area", Priority.Area]] as const)(
    "a %s request pre-empts a running speculative job",
    async (_name, priority) => {
      const env = setup({ delayMs: 40 });
      await env.client.load();
      const speculative = env.client.generateJSON({ ...buildLineRequest("hello", { priority: Priority.Speculative }), id: "slow-spec" });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const urgent = await env.client.generateJSON({ ...buildLineRequest("hello", { priority }), id: "urgent" });
      expect(urgent.status).toBe("ok");
      expect((await speculative).status).toBe("cancelled");
    },
  );

  it("keeps at most three speculative jobs queued", async () => {
    const env = setup({ delayMs: 20 });
    await env.client.load();
    const jobs = Array.from({ length: 6 }, (_, index) =>
      env.client.generateJSON({ ...buildLineRequest("hello", { priority: Priority.Speculative }), id: `s${index}` }));
    const results = await Promise.all(jobs);
    // One runs immediately; of the rest only the newest three stay queued.
    expect(results.filter((result) => result.status === "cancelled")).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import type { GenerationParams } from "../llm/types";
import { getLengthView } from "../story/loader";
import { addTruth, createStoryState, giveItem, markClueFound } from "../story/state";
import type { StoryPack } from "../story/types";
import { validateStoryPack } from "../story/validate";
import { askOptions, resolveAsk } from "./askAbout";
import { ConversationController } from "./controller";
import { GREETING_START } from "./prompt";

const context = { locationName: "Owl Library", locationMood: "hushed", storySummary: "", inventory: [] };

function loadPack(): StoryPack {
  const report = validateStoryPack(fixture);
  if (!report.pack) throw new Error(`fixture pack is invalid: ${report.errors.map((e) => e.message).join("; ")}`);
  return report.pack;
}

const LINES = [
  "Quiet voices, please, and mind the shelves.",
  "Hmm, that rings a distant bell somewhere.",
  "Pebblebrook is full of curious folk today.",
  "Ask the clock keeper about brass and oil.",
  "Cardamom buns are best eaten warm, dear.",
  "Every ledger tells a story if you read slowly.",
  "Moonlight makes the tower stairs look longer.",
  "Gardens keep their secrets until morning dew.",
];

// A client that records every prompt and answers with a different clean line each time.
async function recordingClient() {
  const prompts: string[] = [];
  const client = new LLMClient(new MockBackend({
    respond: (params: GenerationParams) => {
      prompts.push(params.messages.map((message) => message.content).join("\n"));
      return JSON.stringify({ line: LINES[(prompts.length - 1) % LINES.length] });
    },
  }), { pauseWhenHidden: false });
  await client.load();
  return { client, prompts };
}

function setup(characterId: string) {
  const pack = loadPack();
  const character = pack.cast.find((member) => member.id === characterId)!;
  const state = createStoryState(getLengthView(pack, "short"));
  return { pack, character, state };
}

describe("ask about: resolution order", () => {
  it("a) an authored reaction wins over matching knowledge", () => {
    const { pack, character, state } = setup("c_oswin");
    giveItem(state, "i_overdue_book");
    const resolution = resolveAsk(pack, state, character, { type: "item", id: "i_overdue_book" });
    expect(resolution.source).toBe("reaction");
    expect(resolution.facts[0]?.item.text).toContain("My overdue book");
  });

  it("b) falls back to knowledge whose keywords match the subject name", () => {
    const { pack, character, state } = setup("c_mira");
    const resolution = resolveAsk(pack, state, character, { type: "cast", id: "c_oswin" });
    expect(resolution.source).toBe("knowledge");
    expect(resolution.facts.map((fact) => fact.item.id)).toContain("k_mira_oswin");
  });

  it("c) uses the relationship for a person, then the need for an item", () => {
    const { pack, character, state } = setup("c_oswin");
    const person = resolveAsk(pack, state, character, { type: "cast", id: "c_hollis" });
    expect(person.source).toBe("relationship");
    expect(person.facts[0]?.item.text).toContain("lends him the tower key");

    const bare = { ...character, reactions: [], knowledge: character.knowledge.filter((item) => item.id !== "k_oswin_book") };
    giveItem(state, "i_overdue_book");
    const need = resolveAsk(pack, state, bare, { type: "item", id: "i_overdue_book" });
    expect(need.source).toBe("need");
    expect(need.requestedItems).toEqual(["i_overdue_book"]);
  });

  it("d) otherwise deflects", () => {
    const { pack, character, state } = setup("c_mira");
    giveItem(state, "i_glass_shard");
    expect(resolveAsk(pack, state, character, { type: "item", id: "i_glass_shard" }).source).toBe("deflection");
  });
});

describe("ask about: controller", () => {
  it("does not call the model for a deflection", async () => {
    const { pack, character, state } = setup("c_mira");
    giveItem(state, "i_glass_shard");
    const { client, prompts } = await recordingClient();
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    await controller.start();
    const before = prompts.length;
    const turn = await controller.askAbout({ type: "item", id: "i_glass_shard" });
    expect(prompts).toHaveLength(before);
    expect(character.deflections).toContain(turn.line);
    expect(state.characterMemory.c_mira?.askedAbout).toEqual(["item:i_glass_shard"]);
  });

  it("refuses subjects the player does not have", async () => {
    const { pack, character, state } = setup("c_mira");
    const { client } = await recordingClient();
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    expect(() => controller.askAbout({ type: "item", id: "i_glass_shard" })).toThrow();
    expect(() => controller.askAbout({ type: "clue", id: "cl_pip_saw" })).toThrow();
  });

  it("reveals a clue from a reaction only when its requirements are met, and never leaks the secret", async () => {
    const { pack, character, state } = setup("c_hollis");
    markClueFound(state, "cl_shard_match");
    const { client, prompts } = await recordingClient();
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    await controller.start();

    const early = await controller.askAbout({ type: "clue", id: "cl_shard_match" });
    expect(state.cluesFound).not.toContain("cl_hollis_confess");
    expect(early.effects.revealedClue).toBeNull();
    expect(prompts.join("\n")).not.toContain("should have said so");

    addTruth(state, "t_taker");
    const later = await controller.askAbout({ type: "clue", id: "cl_shard_match" });
    expect(later.effects.revealedClue).toBe("cl_hollis_confess");
    expect(state.cluesFound).toContain("cl_hollis_confess");
    expect(prompts.at(-1)).toContain("should have said so");
    expect(prompts.at(-1)).toContain("The player is asking you about");
    for (const prompt of prompts) expect(prompt).not.toContain(character.secret);
  });

  it("puts the asked-about line in the compact prompt style too", async () => {
    const { pack, character, state } = setup("c_oswin");
    giveItem(state, "i_overdue_book");
    const prompts: string[] = [];
    const client = new LLMClient(new MockBackend({
      respond: (params: GenerationParams) => {
        prompts.push(params.messages.map((message) => message.content).join("\n"));
        return JSON.stringify({ line: "Quite so, quite so." });
      },
    }), { pauseWhenHidden: false });
    await client.load();
    Object.defineProperty(client, "dialoguePromptStyle", { value: "compact" });
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    await controller.askAbout({ type: "item", id: "i_overdue_book" });
    expect(prompts.at(-1)).toContain("The player is asking you about: Overdue book");
  });

  it("marks subjects not asked about yet", async () => {
    const { pack, character, state } = setup("c_oswin");
    giveItem(state, "i_overdue_book");
    markClueFound(state, "cl_pip_saw");
    state.characterMemory.c_pip = { visits: 1, askedAbout: [] };
    expect(askOptions(pack, state, character)).toMatchObject({
      people: [{ label: "Pip", fresh: true }],
      items: [{ label: "Overdue book", fresh: true }],
      evidence: [{ fresh: true }],
    });
    const { client } = await recordingClient();
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    await controller.askAbout({ type: "item", id: "i_overdue_book" });
    expect(controller.askOptions().items[0]?.fresh).toBe(false);
  });
});

describe("character memory", () => {
  it("greets a first visit as a stranger and a return visit with up to three topics", async () => {
    const { pack, character, state } = setup("c_oswin");
    giveItem(state, "i_overdue_book");
    markClueFound(state, "cl_pip_saw");
    state.characterMemory.c_pip = { visits: 1, askedAbout: [] };
    state.characterMemory.c_mira = { visits: 1, askedAbout: [] };
    state.characterMemory.c_hollis = { visits: 1, askedAbout: [] };
    const { client, prompts } = await recordingClient();

    const first = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    await first.start();
    expect(prompts[0]).toContain(GREETING_START);
    expect(prompts[0]).not.toContain("been here before");
    expect(state.characterMemory.c_oswin?.visits).toBe(1);

    await first.askAbout({ type: "item", id: "i_overdue_book" });
    await first.askAbout({ type: "cast", id: "c_pip" });
    await first.askAbout({ type: "cast", id: "c_mira" });
    await first.askAbout({ type: "cast", id: "c_hollis" });

    prompts.length = 0;
    const second = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    await second.start();
    expect(state.characterMemory.c_oswin?.visits).toBe(2);
    expect(prompts[0]).toContain("The player has been here before");
    expect(prompts[0]).toContain("Topics you already discussed: Hollis, Mira, Pip.");
    expect(prompts[0]).not.toContain("Overdue book");
  });

  it("stores ids only, never reply text", async () => {
    const { pack, character, state } = setup("c_oswin");
    giveItem(state, "i_overdue_book");
    const { client } = await recordingClient();
    const controller = new ConversationController(client, pack, state, character, context, { random: () => 0 });
    await controller.start();
    const turn = await controller.askAbout({ type: "item", id: "i_overdue_book" });
    const stored = JSON.stringify(state.characterMemory);
    expect(stored).not.toContain(turn.line);
    expect(JSON.parse(stored)).toEqual({ c_oswin: { visits: 1, askedAbout: ["item:i_overdue_book"] } });
  });
});

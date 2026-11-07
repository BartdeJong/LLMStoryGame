import { describe, expect, it } from "vitest";
import fixture from "../story/fixtures/example-pack.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import { storyMockRespond } from "../story/mockResponder";
import { getLengthView } from "../story/loader";
import { addTruth, createStoryState, giveItem } from "../story/state";
import type { StoryState } from "../story/state";
import type { StoryPack } from "../story/types";
import { validateStoryPack } from "../story/validate";
import { applyDialogueEffects } from "./effects";
import { buildDialoguePrompt } from "./prompt";
import { ConversationController } from "./controller";

function loadPack(): StoryPack {
  const report = validateStoryPack(fixture);
  if (!report.pack) throw new Error("fixture pack is invalid");
  return report.pack;
}

function freshState(): StoryState {
  const pack = loadPack();
  const view = getLengthView(pack, "short");
  return createStoryState(view);
}

async function makeClient(): Promise<LLMClient> {
  const client = new LLMClient(new MockBackend({ respond: storyMockRespond }), { pauseWhenHidden: false });
  await client.load();
  return client;
}

describe("dialogue effects", () => {
  it("rejects a give_item proposal for an item that is not this character's current reward", () => {
    const pack = loadPack();
    const oswin = pack.cast.find((c) => c.id === "c_oswin")!;
    const state = freshState();
    const applied = applyDialogueEffects(pack, state, oswin, { give_item: "i_glass_shard", reveal_clue: null, goal_progress: null });
    expect(applied).toEqual({ resolvedGoal: null, givenItem: null, revealedClue: null });
    expect(state.itemsHeld).toEqual([]);
  });

  it("rejects a give_item proposal for a nonexistent item id", () => {
    const pack = loadPack();
    const oswin = pack.cast.find((c) => c.id === "c_oswin")!;
    const state = freshState();
    const applied = applyDialogueEffects(pack, state, oswin, { give_item: "i_made_up", reveal_clue: null, goal_progress: null });
    expect(applied.givenItem).toBeNull();
  });

  it("rejects reveal_clue when the clue's requirements are not met", () => {
    const pack = loadPack();
    const oswin = pack.cast.find((c) => c.id === "c_oswin")!;
    const state = freshState();
    // cl_oswin_ledger requires goal state gs_oswin_book, which is not resolved yet.
    const applied = applyDialogueEffects(pack, state, oswin, { give_item: null, reveal_clue: "cl_oswin_ledger", goal_progress: null });
    expect(applied.revealedClue).toBeNull();
    expect(state.truthsFound).toEqual([]);
  });

  it("a goal resolves only once its pack requirement is met, and gives its reward", () => {
    const pack = loadPack();
    const oswin = pack.cast.find((c) => c.id === "c_oswin")!;
    const state = freshState();

    // Same proposal, before the player has the book: rejected.
    let applied = applyDialogueEffects(pack, state, oswin, { give_item: "i_tower_key", reveal_clue: null, goal_progress: 0.9 });
    expect(applied.resolvedGoal).toBeNull();
    expect(state.itemsHeld).toEqual([]);
    expect(state.resolvedGoalStates).toEqual([]);

    giveItem(state, "i_overdue_book");
    applied = applyDialogueEffects(pack, state, oswin, { give_item: "i_tower_key", reveal_clue: null, goal_progress: 0.9 });
    expect(applied.resolvedGoal).toBe("gs_oswin_book");
    expect(applied.givenItem).toBe("i_tower_key");
    expect(state.itemsHeld).toContain("i_tower_key");
    expect(state.resolvedGoalStates).toContain("gs_oswin_book");

    // Resolving again (e.g. a second conversation) does nothing new.
    applied = applyDialogueEffects(pack, state, oswin, { give_item: "i_tower_key", reveal_clue: null, goal_progress: 1 });
    expect(applied.resolvedGoal).toBeNull();
    expect(state.itemsHeld.filter((id) => id === "i_tower_key")).toHaveLength(1);
  });

  it("reveals a clue once its requirement is met and the clue is spoken by this character", () => {
    const pack = loadPack();
    const oswin = pack.cast.find((c) => c.id === "c_oswin")!;
    const state = freshState();
    giveItem(state, "i_overdue_book");
    applyDialogueEffects(pack, state, oswin, { give_item: "i_tower_key", reveal_clue: null, goal_progress: null });
    addTruth(state, "t_night");

    const applied = applyDialogueEffects(pack, state, oswin, { give_item: null, reveal_clue: "cl_oswin_ledger", goal_progress: null });
    expect(applied.revealedClue).toBe("cl_oswin_ledger");
    expect(state.truthsFound).toContain("t_taker");
  });
});

describe("dialogue prompt", () => {
  it("includes only the current conversation's turns", () => {
    const pack = loadPack();
    const oswin = pack.cast.find((c) => c.id === "c_oswin")!;
    const state = freshState();
    const context = { locationName: "Owl Library", locationMood: "hushed", storySummary: "", inventory: [] };

    const promptA = buildDialoguePrompt(oswin, state, context, [
      { speaker: "player", text: "Have you seen anything strange?" },
      { speaker: "character", text: "My book is overdue, that is strange enough." },
    ]);
    expect(promptA).toContain("Have you seen anything strange?");

    // A brand new conversation (e.g. the player left and came back) starts with no turns at all.
    const promptB = buildDialoguePrompt(oswin, state, context, []);
    expect(promptB).not.toContain("Have you seen anything strange?");
    expect(promptB).toContain("the conversation is just starting");
  });

  it("a ConversationController never carries turns from a previous conversation", async () => {
    const pack = loadPack();
    const oswin = pack.cast.find((c) => c.id === "c_oswin")!;
    const state = freshState();
    const context = { locationName: "Owl Library", locationMood: "hushed", storySummary: "", inventory: [] };
    const client = await makeClient();

    const first = new ConversationController(client, pack, state, oswin, context);
    await first.start();
    await first.reply("Hello there!");
    expect(first.getTurns().length).toBeGreaterThan(0);

    const second = new ConversationController(client, pack, state, oswin, context);
    expect(second.getTurns()).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import { bakeSimple } from "./fixtures/bakeSimple";
import { getLengthView } from "./loader";
import { storyMockRespond } from "./mockResponder";
import { buildPackArea } from "./packArea";
import { giveItem } from "./state";
import { StorySession } from "./storySession";
import type { StoryPack } from "./types";
import { validateStoryPack } from "./validate";

function loadExample(): StoryPack {
  const report = validateStoryPack(bakeSimple(example));
  if (!report.pack) throw new Error(report.errors.map((issue) => issue.message).join("; "));
  return report.pack;
}

function newSession(pack: StoryPack): StorySession {
  const client = new LLMClient(new MockBackend({ respond: storyMockRespond }), { pauseWhenHidden: false });
  return new StorySession(pack, getLengthView(pack, "short"), client);
}

describe("clues attached to objects", () => {
  it("puts the clues on the object they are anchored to, not on floating entities", () => {
    const pack = loadExample();
    const view = getLengthView(pack, "short");
    const { area } = buildPackArea(pack, view, "l_clocktower");
    const entities = area.entities ?? [];
    expect(entities.some((entity) => entity.id.startsWith("clue:"))).toBe(false);
    expect(entities.find((entity) => entity.id === "obj:cl_shard_match")).toMatchObject({
      kind: "object", clueIds: ["cl_shard_match"],
    });
    expect(entities.find((entity) => entity.id === "obj:o_workbench")?.clueIds).toEqual(["cl_workbench"]);
  });

  it("examining an object finds its clues once their requirements are met, then reads as plain scenery", () => {
    const pack = loadExample();
    const story = newSession(pack);
    const { area } = buildPackArea(pack, getLengthView(pack, "short"), "l_clocktower");
    const shard = area.entities!.find((entity) => entity.id === "obj:cl_shard_match")!;

    expect(story.hasOpenClues(shard)).toBe(true);
    const glimpse = story.examineClues(shard);
    expect(glimpse?.kind).toBe("glimpse");
    expect(glimpse?.text).toContain("Glass shard");
    expect(glimpse?.text).not.toContain("can wait");
    expect(story.state.leadsSeen).toContain("clue:cl_shard_match");
    expect(story.state.cluesFound).not.toContain("cl_shard_match");

    giveItem(story.state, "i_glass_shard");
    expect(story.examineClues(shard)).toEqual({ kind: "found", text: pack.clues.find((clue) => clue.id === "cl_shard_match")!.text });
    expect(story.state.cluesFound).toContain("cl_shard_match");
    expect(story.allCluesFound(shard)).toBe(true);
    expect(story.examineClues(shard)).toBeNull();
  });

  it("an object is checked once every clue on it is found, and an object without clues never is", () => {
    const pack = loadExample();
    const story = newSession(pack);
    const { area } = buildPackArea(pack, getLengthView(pack, "short"), "l_square");
    const board = area.entities!.find((entity) => entity.id === "obj:o_notice_board")!;
    expect(board.clueIds).toEqual(["cl_notice_board"]);
    expect(story.allCluesFound(board)).toBe(false);
    story.examineClues(board);
    expect(story.allCluesFound(board)).toBe(true);

    const plain = { ...board, clueIds: undefined };
    expect(story.allCluesFound(plain)).toBe(false);
  });

  it("leaves a location object out when an item found there has the same id", () => {
    const pack = loadExample();
    const bakery = pack.locations.find((location) => location.id === "l_bakery")!;
    bakery.objects.push({ id: "i_overdue_book", name: "Overdue book", description: "A dusty book." });
    const { area } = buildPackArea(pack, getLengthView(pack, "short"), "l_bakery");
    const bookEntities = (area.entities ?? []).filter((entity) => entity.packId === "i_overdue_book");
    expect(bookEntities.map((entity) => entity.id)).toEqual(["item:i_overdue_book"]);
  });
});

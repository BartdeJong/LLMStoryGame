import { describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import holmes from "../../public/stories/holmesashenvelope.json";
import paddington from "../../public/stories/paddingtonhat.json";
import { buildDialoguePrompt, AFTER_ENDING_LINE } from "../dialogue/prompt";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import type { GameSave } from "../save/types";
import type { EndingScene } from "./ending";
import { getLengthView } from "./loader";
import { storyMockRespond } from "./mockResponder";
import { StorySession } from "./storySession";
import type { StoryPack } from "./types";
import { validateStoryPack } from "./validate";

function loadPack(data: unknown): StoryPack {
  const report = validateStoryPack(data);
  if (!report.pack) throw new Error(report.errors.map((issue) => issue.message).join("; "));
  return report.pack;
}

async function session(data: unknown): Promise<StorySession> {
  const pack = loadPack(data);
  const client = new LLMClient(new MockBackend({ respond: storyMockRespond }), { pauseWhenHidden: false });
  await client.load();
  return new StorySession(pack, getLengthView(pack), client);
}

const scene = (endingId: string): EndingScene => ({ endingId, endingTitle: "The End", scene: "It ended well.", epilogue: "Everyone was happy." });

const people = (story: StorySession, areaId: string): string[] =>
  (story.getArea(areaId).entities ?? []).filter((entity) => entity.kind === "character").map((entity) => entity.packId!).sort();

describe("epilogue", () => {
  it("gathers everyone at Paddington's party, with Mr Curry only when he came", async () => {
    const story = await session(paddington);
    story.start();
    const party = story.enterEpilogue(scene("e_happy_surprise"))!;
    expect(party.area.id).toBe("l_bandstand");
    expect(people(story, "l_bandstand")).toEqual([
      "c_barnaby", "c_jonathan", "c_judy", "c_mr_brown", "c_mr_gruber", "c_mrs_bird", "c_mrs_brown", "c_mrs_penny",
    ]);
    expect(story.inEpilogue).toBe(true);
    expect(story.epilogue?.player_sprite?.headwear?.style).toBe("bush-hat");

    const withCurry = await session(paddington);
    withCurry.start();
    withCurry.enterEpilogue(scene("e_party_for_everyone"));
    expect(people(withCurry, "l_bandstand")).toContain("c_mr_curry");
  });

  it("closes the doors, the case and the leads after the ending", async () => {
    const story = await session(example);
    story.start();
    const { area } = story.enterEpilogue(scene("e_lantern_returns"))!;
    expect(area.id).toBe("l_square");
    expect(people(story, "l_square")).toEqual(["c_hollis", "c_mira", "c_oswin", "c_pip"]);
    for (const door of area.doors) {
      expect(story.isDoorLocked(area.id, door.id)).toBe(true);
      expect(story.describeDoorLock(area.id, door.id)).toBe(story.epilogue?.door_message);
    }
    expect(story.getEndingChoices(area.id)).toEqual([]);
    expect(story.isLeadLocation(area.id)).toBe(false);
    expect(story.getBrief(area.id)?.description).toBe(story.epilogue?.description);
  });

  it("gives characters their epilogue greeting and nothing left to uncover", async () => {
    const story = await session(holmes);
    story.start();
    story.enterEpilogue(scene("e_public_trial"));
    const entity = story.getArea("l_baker_street").entities!.find((candidate) => candidate.packId === "c_silas")!;
    const silas = story.getCharacter(entity)!;
    expect(silas.greetings).toEqual([story.epilogue!.cast.find((entry) => entry.id === "c_silas")!.greeting]);
    expect(silas.knowledge).toEqual([]);
    expect(silas.statements).toEqual([]);
    expect(silas.goal_states).toEqual([]);
    expect(silas.secret).toBe("");
    expect(people(story, "l_baker_street")).not.toContain("c_vale");
  });

  it("returns to the epilogue when a save made after the ending is loaded", async () => {
    const story = await session(paddington);
    story.start();
    story.enterEpilogue(scene("e_detective_bear"));
    const save = {
      packId: story.pack.identity.id,
      packVersion: story.pack.identity.version,
      length: story.view.length,
      worldSeed: story.worldSeed,
      storyState: structuredClone(story.state),
      areaIds: story.getAreaIds(),
    } as GameSave;
    const loaded = await session(paddington);
    loaded.restoreSave(save);
    expect(loaded.inEpilogue).toBe(true);
    expect(people(loaded, "l_bandstand")).toHaveLength(8);
  });

  it("tells the model the story has ended", () => {
    const prompt = buildDialoguePrompt({
      character: loadPack(example).cast[0]!,
      context: { locationName: "Square", locationMood: "festive", storySummary: "It ended well.", inventory: [], afterEnding: true },
      turns: [],
      facts: [],
      goalHint: "",
      handoverLines: [],
    });
    expect(prompt).toContain(AFTER_ENDING_LINE);
  });
});

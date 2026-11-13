import { describe, expect, it } from "vitest";
import authoredExample from "../../public/stories/example.json";
import { stripLockText } from "./fixtures/stripLockText";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import { getLengthView } from "./loader";
import { storyMockRespond } from "./mockResponder";
import { giveItem } from "./state";
import { StorySession } from "./storySession";
import type { StoryPack } from "./types";
import { validateStoryPack } from "./validate";

const fixture = stripLockText(authoredExample);

function loadPack(): StoryPack {
  const report = validateStoryPack(fixture);
  if (!report.pack) throw new Error("fixture pack is invalid");
  return report.pack;
}

async function makeClient(): Promise<LLMClient> {
  const client = new LLMClient(new MockBackend({ delayMs: 1, respond: storyMockRespond }), { pauseWhenHidden: false });
  await client.load();
  return client;
}

describe("items and doors", () => {
  it("picks up a pack item once; collecting it again does not duplicate it", async () => {
    const pack = loadPack();
    const view = getLengthView(pack, "short");
    const client = await makeClient();
    const story = new StorySession(pack, view, client);
    let area = await story.start();
    const toBakery = area.doors.find((door) => door.targetAreaId === "l_bakery")!;
    area = (await story.enterDoor(area.id, toBakery.id)).area;

    const bookEntity = area.entities?.find((entity) => entity.kind === "key" && entity.packId === "i_overdue_book");
    expect(bookEntity).toBeDefined();

    const first = story.collectItem(bookEntity!);
    expect(first).toMatchObject({ given: true });
    expect(story.state.itemsHeld).toEqual(["i_overdue_book"]);
    expect(story.getArea(area.id).entities).not.toContainEqual(bookEntity);

    const second = story.collectItem(bookEntity!);
    expect(second).toMatchObject({ given: false });
    expect(story.state.itemsHeld).toEqual(["i_overdue_book"]);
  });

  it("a locked door opens only once its required item is held", async () => {
    const pack = loadPack();
    const view = getLengthView(pack, "short");
    const client = await makeClient();
    const story = new StorySession(pack, view, client);
    let area = await story.start();
    const openingClue = area.entities?.find((entity) => entity.clueIds?.includes("cl_notice_board"));
    expect(openingClue).toBeDefined();
    story.examineClues(openingClue!);
    const toLibrary = area.doors.find((door) => door.targetAreaId === "l_library")!;
    area = (await story.enterDoor(area.id, toLibrary.id)).area;

    const towerDoor = area.doors.find((door) => door.targetAreaId === "l_clocktower")!;
    expect(story.isDoorLocked(area.id, towerDoor.id)).toBe(true);
    expect(story.describeDoorLock(area.id, towerDoor.id)).toContain("Tower key");

    giveItem(story.state, "i_tower_key");
    expect(story.isDoorLocked(area.id, towerDoor.id)).toBe(false);
    expect(story.describeDoorLock(area.id, towerDoor.id)).toBeNull();
  });
});

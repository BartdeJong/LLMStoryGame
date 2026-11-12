import { describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import holmes from "../../public/stories/holmesashenvelope.json";
import lanterntide from "../../public/stories/lanterntide.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import { doorPointsForBearings } from "../world/doorSlots";
import { bakeSimple } from "./fixtures/bakeSimple";
import { getLengthView } from "./loader";
import { storyMockRespond } from "./mockResponder";
import { doorSpawn } from "./packArea";
import { recordVisit } from "./state";
import { StorySession } from "./storySession";
import { LENGTH_IDS, type StoryPack } from "./types";
import { validateStoryPack } from "./validate";
import { layoutStoryWorld } from "./worldLayout";

const PACKS: Record<string, unknown> = { example, lanterntide, holmesashenvelope: holmes };
function loadPack(id: string): StoryPack {
  const report = validateStoryPack(bakeSimple(PACKS[id]));
  if (!report.pack) throw new Error(`pack ${id} is invalid`);
  return report.pack;
}

describe("door spots", () => {
  it("puts doors on the edge that matches their bearing", () => {
    const [north, east, south, west] = doorPointsForBearings([0, 90, 180, 270]);
    expect(north).toEqual({ x: 20, y: 2 });
    expect(east).toEqual({ x: 37, y: 12 });
    expect(south).toEqual({ x: 20, y: 21 });
    expect(west).toEqual({ x: 2, y: 12 });
  });

  it("gives doors with the same bearing their own tiles next to each other", () => {
    const points = doorPointsForBearings([90, 90, 90, 450, -270]);
    expect(new Set(points.map(({ x, y }) => `${x},${y}`)).size).toBe(points.length);
    for (const point of points) expect(point.x).toBe(37);
  });
});

describe("story world layout", () => {
  for (const id of Object.keys(PACKS)) {
    it(`gives every place of the pack its own cell, the same for every length: ${id}`, () => {
      const pack = loadPack(id);
      const layout = layoutStoryWorld(pack);

      expect([...layout.keys()].sort()).toEqual(pack.locations.map((location) => location.id).sort());
      expect(new Set([...layout.values()].map(({ column, row }) => `${column},${row}`)).size).toBe(layout.size);
      const longest = [...LENGTH_IDS].reverse().map((length) => pack.lengths[length]).find((definition) => definition)!;
      expect(layout.get(longest.start_location)).toEqual({ column: 0, row: 0 });
      for (const length of LENGTH_IDS) {
        if (!pack.lengths[length]) continue;
        expect(layoutStoryWorld(pack, getLengthView(pack, length))).toEqual(layout);
      }
    });
  }

  it("tells the map and the door signs what the player already knows", () => {
    const pack = loadPack("example");
    const view = getLengthView(pack, "short");
    const client = new LLMClient(new MockBackend({ respond: storyMockRespond }), { pauseWhenHidden: false });
    const story = new StorySession(pack, view, client);
    const square = story.start();
    const toBakery = square.doors.find((door) => door.targetAreaId === "l_bakery")!;
    const toLibrary = square.doors.find((door) => door.targetAreaId === "l_library")!;

    expect(story.isLeadLocation("l_square")).toBe(true);
    expect(story.isLeadLocation("l_library")).toBe(false);
    expect(story.describeDoorLockBriefly(square.id, toBakery.id)).toBeNull();
    expect(story.describeDoorLockBriefly(square.id, toLibrary.id)).toBe("Opens later in the story");
    expect(story.describeDoorDestination(square.id, toBakery.id)).toBe(toBakery.label);

    const { area: bakery, spawn } = story.enterDoor(square.id, toBakery.id);
    const back = bakery.doors.find((door) => door.targetAreaId === square.id)!;
    expect(Math.abs(spawn.x - back.x) + Math.abs(spawn.y - back.y)).toBe(1);
    expect(() => doorSpawn(bakery, back)).not.toThrow();
    expect(story.describeDoorDestination(bakery.id, back.id)).toBe(square.name);
    expect(story.describeDoorDestination(square.id, toBakery.id)).toBe(bakery.name);

    const baker = bakery.entities!.find((entity) => entity.kind === "character" && entity.packId !== undefined)!;
    expect(story.getPeopleMet(bakery.id)).toEqual([]);
    recordVisit(story.state, baker.packId!);
    expect(story.getPeopleMet(bakery.id)).toEqual([baker.name]);
    expect(story.getPeopleMet("l_library")).toEqual([]);
  });
});

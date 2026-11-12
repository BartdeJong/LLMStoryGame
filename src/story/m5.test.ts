import { describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import holmes from "../../public/stories/holmesashenvelope.json";
import lanterntide from "../../public/stories/lanterntide.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import { Tile } from "../world/types";
import { reachableTiles } from "../world/connectivity";
import { bakeSimple } from "./fixtures/bakeSimple";
import { getLengthView, type LengthView } from "./loader";
import { storyMockRespond } from "./mockResponder";
import { buildPackArea, doorSpawn } from "./packArea";
import { buildLocationSlice, locationDoorTargets } from "./slice";
import { giveItem } from "./state";
import { StorySession } from "./storySession";
import type { AuthoredArea, LengthId, StoryPack } from "./types";
import { validateStoryPack } from "./validate";

const PACKS: Record<string, unknown> = { example, lanterntide, holmesashenvelope: holmes };

// Packs get plain hand-made areas here, so these tests do not depend on the real baked maps.
function loadPack(id: string): StoryPack {
  const report = validateStoryPack(bakeSimple(PACKS[id]));
  if (!report.pack) throw new Error(`pack ${id} is invalid: ${report.errors.map((issue) => issue.message).join("; ")}`);
  return report.pack;
}

async function makeClient(): Promise<LLMClient> {
  const client = new LLMClient(new MockBackend({ respond: storyMockRespond }), { pauseWhenHidden: false });
  await client.load();
  return client;
}

const CASES: [string, LengthId][] = [
  ["example", "short"],
  ["lanterntide", "short"], ["lanterntide", "medium"], ["lanterntide", "long"],
  ["holmesashenvelope", "short"], ["holmesashenvelope", "medium"], ["holmesashenvelope", "long"],
];

// Clues have no tiles of their own: they are found by examining the object they are anchored to.
function expectedIds(pack: StoryPack, view: LengthView, locationId: string): string[] {
  const slice = buildLocationSlice(pack, view, locationId);
  return [
    ...slice.characters.map((c) => `char:${c.id}`),
    ...slice.objects.map((o) => `${o.kind === "key_item" ? "item" : "obj"}:${o.id}`),
  ];
}

// Two hand-written areas of the example pack. The square has a "@" start; the library does not.
const SQUARE: AuthoredArea = {
  description: "A tidy square with a notice board.",
  doors: [
    { to: "l_bakery", label: "Bakery door", hint: "Smells of bread." },
    { to: "l_garden", label: "Garden gate", hint: "" },
    { to: "l_library", label: "Library steps", hint: "" },
  ],
  biome: "village",
  palette: "village",
  floor: "cobble",
  wall: "brick",
  map: [
    "##############",
    "#............#",
    "#..@.........#",
    "#............#",
    "1............2",
    "#............#",
    "#............#",
    "######3#######",
  ],
  placements: { o_notice_board: [3, 1] },
  decor: [],
};
const LIBRARY: AuthoredArea = {
  description: "Rows of blue-bound books.",
  doors: [
    { to: "l_square", label: "Front steps", hint: "" },
    { to: "l_clocktower", label: "Tower stair", hint: "" },
  ],
  biome: "building",
  palette: "village",
  floor: "boards",
  wall: "wood",
  map: [
    "#####1######",
    "#..........#",
    "#..........#",
    "#..........#",
    "#..........#",
    "#..........#",
    "#..........#",
    "######2#####",
  ],
  placements: { "char:c_oswin": [3, 2], "obj:o_key_log": [8, 2] },
  decor: [{ icon: "plant", x: 9, y: 5 }],
};

function handWritten(): StoryPack {
  const pack = structuredClone(example) as unknown as StoryPack;
  pack.locations.find((l) => l.id === "l_square")!.area = SQUARE;
  pack.locations.find((l) => l.id === "l_library")!.area = LIBRARY;
  return pack;
}

describe("buildPackArea", () => {
  it("builds the map, doors and entry of the start location from the pack", () => {
    const pack = handWritten();
    const { area, brief } = buildPackArea(pack, getLengthView(pack, "short"), "l_square");

    expect(area).toMatchObject({
      id: "l_square", width: 14, height: 8, biome: "village", palette: "village",
      style: { floor: "cobble", wall: "brick" }, entry: { x: 3, y: 2 },
    });
    expect(area.doors.map((door) => [door.id, door.targetAreaId, door.label, door.kind, door.x, door.y])).toEqual([
      ["door-1", "l_bakery", "Bakery door", "gate", 0, 4],
      ["door-2", "l_garden", "Garden gate", "gate", 13, 4],
      ["door-3", "l_library", "Library steps", "gate", 6, 7],
    ]);
    expect(area.layers.feature[4]![0]).toBe(Tile.Door);
    expect(brief.description).toBe("A tidy square with a notice board.");
    expect(brief.doors.map((door) => door.to)).toEqual(["l_bakery", "l_garden", "l_library"]);
  });

  it("places objects, characters and clues exactly as the pack says, with the usual entity ids", () => {
    const pack = handWritten();
    const { area } = buildPackArea(pack, getLengthView(pack, "short"), "l_library");

    expect(area.entities?.map(({ id, kind, x, y, packId }) => ({ id, kind, x, y, packId }))).toEqual([
      { id: "char:c_oswin", kind: "character", x: 3, y: 2, packId: "c_oswin" },
      { id: "obj:o_key_log", kind: "object", x: 8, y: 2, packId: "o_key_log" },
    ]);
    expect(area.entities?.find((entity) => entity.kind === "character")?.character).toBeDefined();
    // the clue is found by examining the object it is anchored to
    expect(area.entities?.find((entity) => entity.id === "obj:o_key_log")?.clueIds).toEqual(["cl_library_log"]);
    expect(area.entities?.some((entity) => entity.id.startsWith("clue:"))).toBe(false);
    expect(area.spawnPoints.map((point) => point.id)).toEqual(area.entities?.map((entity) => entity.id));
    expect(area.decor).toEqual([{ icon: "plant", x: 9, y: 5 }]);
  });

  it("starts at the first active door's walkable neighbour when the map has no start tile", () => {
    const pack = handWritten();
    const { area } = buildPackArea(pack, getLengthView(pack, "short"), "l_library");
    expect(area.entry).toEqual({ x: 5, y: 1 });
    expect(doorSpawn(area, area.doors[0]!)).toEqual(area.entry);
  });

  it("turns a door to a place outside the length into wall and leaves it out", () => {
    const pack = handWritten();
    pack.lengths.short!.beats[1]!.locations = ["l_library"];
    const view = getLengthView(pack, "short");
    const { area, brief } = buildPackArea(pack, view, "l_library");

    expect(area.doors.map((door) => door.targetAreaId)).toEqual(["l_square"]);
    expect(brief.doors.map((door) => door.to)).toEqual(["l_square"]);
    expect(area.layers.feature[7]![6]).toBe(Tile.Wall);
    expect(area.layers.feature[0]![5]).toBe(Tile.Door);
  });

  it("leaves out characters who are not in the length's cast", () => {
    const pack = handWritten();
    pack.lengths.short!.cast = pack.lengths.short!.cast.filter((id) => id !== "c_oswin");
    const { area, brief } = buildPackArea(pack, getLengthView(pack, "short"), "l_library");
    expect(area.entities?.map((entity) => entity.id)).toEqual(["obj:o_key_log"]);
    expect(brief.characters).toEqual([]);
  });

  it("refuses an area that is missing a placement or the whole block", () => {
    const pack = handWritten();
    delete pack.locations.find((l) => l.id === "l_library")!.area!.placements["char:c_oswin"];
    const view = getLengthView(pack, "short");
    expect(() => buildPackArea(pack, view, "l_library")).toThrow("no placement for \"c_oswin\"");
    delete pack.locations.find((l) => l.id === "l_library")!.area;
    expect(() => buildPackArea(pack, view, "l_library")).toThrow("no baked area");
  });

  it("draws the ink shelf as a shelf", () => {
    const pack = loadPack("lanterntide");
    const view = getLengthView(pack, "long");
    const { brief } = buildPackArea(pack, view, "l_oil_press");
    expect(brief.objects.find((object) => object.packId === "o_ink_shelf")?.icon.shape).toBe("shelf");
  });

  for (const [id, length] of CASES) {
    it(`builds every location with all its things on reachable tiles: ${id} (${length})`, () => {
      const pack = loadPack(id);
      const view = getLengthView(pack, length);
      for (const location of view.locations) {
        const { area } = buildPackArea(pack, view, location.id);
        const ids = new Set((area.entities ?? []).map((entity) => entity.id));
        for (const expected of expectedIds(pack, view, location.id)) expect(ids.has(expected), `${location.id} ${expected}`).toBe(true);
        const reachable = reachableTiles(area);
        const spots = new Set<string>();
        for (const point of [...(area.entities ?? []), ...area.doors]) {
          expect(reachable.has(`${point.x},${point.y}`), `${location.id} ${"id" in point ? point.id : ""}`).toBe(true);
          spots.add(`${point.x},${point.y}`);
        }
        expect(spots.size).toBe((area.entities?.length ?? 0) + area.doors.length);
        expect(area.doors.map((d) => d.targetAreaId).sort()).toEqual(locationDoorTargets(pack, view, location.id).sort());
      }
    });
  }
});

describe("story session", () => {
  it("walks several locations, tracks state and regenerates the summary", async () => {
    const pack = loadPack("example");
    const view = getLengthView(pack, "short");
    const story = new StorySession(pack, view, await makeClient());
    let area = story.start();
    expect(area.id).toBe("l_square");
    const libraryDoor = area.doors.find((door) => door.targetAreaId === "l_library")!;
    expect(story.isDoorLocked(area.id, libraryDoor.id)).toBe(true);
    expect(story.describeDoorLock(area.id, libraryDoor.id)).toContain("Keep exploring nearby");
    expect(() => story.enterDoor(area.id, libraryDoor.id)).toThrow("Keep exploring nearby");
    const openingClue = area.entities?.find((entity) => entity.clueIds?.includes("cl_notice_board"));
    expect(openingClue).toBeDefined();
    expect(story.examineClues(openingClue!)).toContain("festival notice");
    expect(story.isLocationOpen("l_library")).toBe(true);
    expect(story.isDoorLocked(area.id, libraryDoor.id)).toBe(false);
    giveItem(story.state, "i_tower_key");
    for (const target of ["l_bakery", "l_square", "l_library", "l_clocktower"]) {
      const door = area.doors.find((candidate) => candidate.targetAreaId === target);
      expect(door, `door to ${target}`).toBeDefined();
      area = story.enterDoor(area.id, door!.id).area;
      expect(area.id).toBe(target);
    }
    const clueObject = area.entities?.find((entity) => entity.clueIds?.includes("cl_workbench"));
    expect(clueObject).toBeDefined();
    expect(story.examineClues(clueObject!)).toBeTruthy();
    expect(story.state.truthsFound.length).toBe(1);
    expect(story.state.visitedAreas).toEqual(["l_square", "l_bakery", "l_library", "l_clocktower"]);
    expect(story.state).toMatchObject({ packId: "example", length: "short" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(story.state.summary).not.toBe("");
  });
});

import { describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import holmes from "../../public/stories/holmesashenvelope.json";
import lanterntide from "../../public/stories/lanterntide.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import { allPointsReachable } from "../world/connectivity";
import { doorPointsForBearings } from "../world/doorSlots";
import { doorSpawn } from "../world/session";
import type { Area, GridPoint } from "../world/types";
import { buildStoryArea } from "./briefToMap";
import { buildGuard, fallbackBrief } from "./briefs";
import { getLengthView } from "./loader";
import { storyMockRespond } from "./mockResponder";
import { buildLocationSlice, locationDoorTargets } from "./slice";
import { recordVisit } from "./state";
import { StorySession } from "./storySession";
import type { LengthId, StoryPack } from "./types";
import { validateStoryPack } from "./validate";
import { bearingBetween, layoutStoryWorld, storyDoorPoints } from "./worldLayout";

const PACKS: Record<string, unknown> = { example, lanterntide, holmesashenvelope: holmes };
const CASES: [string, LengthId][] = [
  ["example", "short"],
  ["lanterntide", "short"], ["lanterntide", "medium"], ["lanterntide", "long"],
  ["holmesashenvelope", "short"], ["holmesashenvelope", "medium"], ["holmesashenvelope", "long"],
];

function loadPack(id: string): StoryPack {
  const report = validateStoryPack(PACKS[id]);
  if (!report.pack) throw new Error(`pack ${id} is invalid`);
  return report.pack;
}

// Compass bearing of a door as seen from the middle of its area.
function doorBearing(area: Pick<Area, "width" | "height">, door: GridPoint): number {
  const east = (door.x - (area.width - 1) / 2) / ((area.width - 1) / 2);
  const north = ((area.height - 1) / 2 - door.y) / ((area.height - 1) / 2);
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

function turn(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
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
  for (const [id, length] of CASES) {
    it(`gives every place its own cell and turns each door towards its destination: ${id} (${length})`, () => {
      const pack = loadPack(id);
      const view = getLengthView(pack, length);
      const layout = layoutStoryWorld(pack, view);
      const size = { width: 40, height: 24 };

      expect([...layout.keys()].sort()).toEqual(view.locations.map((location) => location.id).sort());
      expect(new Set([...layout.values()].map(({ column, row }) => `${column},${row}`)).size).toBe(layout.size);
      expect(layout.get(view.startLocation)).toEqual({ column: 0, row: 0 });
      expect(layoutStoryWorld(pack, view)).toEqual(layout);

      const doors = new Map<string, GridPoint>();
      for (const location of view.locations) {
        const targets = locationDoorTargets(pack, view, location.id);
        const points = storyDoorPoints(layout, location.id, targets)!;
        expect(new Set(points.map(({ x, y }) => `${x},${y}`)).size).toBe(targets.length);
        targets.forEach((target, index) => doors.set(`${location.id}>${target}`, points[index]!));
      }
      for (const [route, door] of doors) {
        const [from, to] = route.split(">") as [string, string];
        const wanted = bearingBetween(layout.get(from)!, layout.get(to)!);
        expect(turn(doorBearing(size, door), wanted), `${route} faces its destination`).toBeLessThanOrEqual(45);
        const back = doors.get(`${to}>${from}`)!;
        expect(turn(doorBearing(size, back), doorBearing(size, door)), `${route} arrives on the far side`).toBeGreaterThanOrEqual(90);
      }
    });

    it(`keeps every door reachable when the doors face their destinations: ${id} (${length})`, () => {
      const pack = loadPack(id);
      const view = getLengthView(pack, length);
      const layout = layoutStoryWorld(pack, view);
      const guard = buildGuard(pack);
      for (const location of view.locations) {
        const brief = fallbackBrief(buildLocationSlice(pack, view, location.id), guard);
        const points = storyDoorPoints(layout, location.id, brief.doors.map((door) => door.to))!;
        const area = buildStoryArea(brief, `${id}:1`, points);

        expect(area.doors.map(({ x, y }) => ({ x, y }))).toEqual(points);
        expect(allPointsReachable(area), location.id).toBe(true);
        for (const door of area.doors) expect(() => doorSpawn(area, door)).not.toThrow();
        const doorTiles = new Set(area.doors.map(({ x, y }) => `${x},${y}`));
        for (const entity of area.entities ?? []) expect(doorTiles.has(`${entity.x},${entity.y}`), `${location.id} ${entity.id}`).toBe(false);
      }
    });
  }

  it("lets the player leave by one side and arrive on the opposite side", async () => {
    const pack = loadPack("example");
    const view = getLengthView(pack, "short");
    const client = new LLMClient(new MockBackend({ respond: storyMockRespond }), { pauseWhenHidden: false });
    await client.load();
    const story = new StorySession(pack, view, client);
    const square = await story.start();
    const here = story.getMapCell(square.id)!;

    for (const door of square.doors) {
      const there = story.getMapCell(door.targetAreaId!)!;
      expect(turn(doorBearing(square, door), bearingBetween(here, there))).toBeLessThanOrEqual(45);
    }
    const toBakery = square.doors.find((door) => door.targetAreaId === "l_bakery")!;
    const { area: bakery, spawn } = await story.enterDoor(square.id, toBakery.id);
    const back = bakery.doors.find((door) => door.targetAreaId === square.id)!;
    expect(toBakery).toMatchObject({ x: 37, y: 12 });
    expect(back).toMatchObject({ x: 2, y: 12 });
    expect(Math.abs(spawn.x - back.x) + Math.abs(spawn.y - back.y)).toBe(1);
  });

  it("tells the map and the door signs what the player already knows", async () => {
    const pack = loadPack("example");
    const view = getLengthView(pack, "short");
    const client = new LLMClient(new MockBackend({ respond: storyMockRespond }), { pauseWhenHidden: false });
    await client.load();
    const story = new StorySession(pack, view, client);
    const square = await story.start();
    const toBakery = square.doors.find((door) => door.targetAreaId === "l_bakery")!;
    const toLibrary = square.doors.find((door) => door.targetAreaId === "l_library")!;

    expect(story.isLeadLocation("l_square")).toBe(true);
    expect(story.isLeadLocation("l_library")).toBe(false);
    expect(story.describeDoorLockBriefly(square.id, toBakery.id)).toBeNull();
    expect(story.describeDoorLockBriefly(square.id, toLibrary.id)).toBe("Opens later in the story");
    expect(story.describeDoorDestination(square.id, toBakery.id)).toBe(toBakery.label);

    const { area: bakery } = await story.enterDoor(square.id, toBakery.id);
    const back = bakery.doors.find((door) => door.targetAreaId === square.id)!;
    expect(story.describeDoorDestination(bakery.id, back.id)).toBe(square.name);
    expect(story.describeDoorDestination(square.id, toBakery.id)).toBe(bakery.name);

    const baker = bakery.entities!.find((entity) => entity.kind === "character" && entity.packId !== undefined)!;
    expect(story.getPeopleMet(bakery.id)).toEqual([]);
    recordVisit(story.state, baker.packId!);
    expect(story.getPeopleMet(bakery.id)).toEqual([baker.name]);
    expect(story.getPeopleMet("l_library")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { allPointsReachable } from "./connectivity";
import { PLACEHOLDER_BRIEFS } from "./briefs";
import {
  generateArea,
  generateBuilding,
  generateCave,
  generateOutdoors,
  generateRuins,
  generateVillage,
} from "./generators";
import { WorldSession } from "./session";
import { Tile, type AreaBrief, type Biome } from "./types";

const generatorCases: readonly [string, Biome, (seed: number, brief: AreaBrief) => ReturnType<typeof generateArea>][] = [
  ["meadow", "meadow", generateOutdoors],
  ["forest", "forest", generateOutdoors],
  ["shore", "shore", generateOutdoors],
  ["cave", "cave", generateCave],
  ["building", "building", generateBuilding],
  ["ruins", "ruins", generateRuins],
  ["village", "village", generateVillage],
];

describe("procedural areas", () => {
  it.each(generatorCases)("%s is deterministic", (_label, biome, generator) => {
    const brief = PLACEHOLDER_BRIEFS[biome];
    expect(generator(813, brief)).toEqual(generator(813, brief));
  });

  it("adds walkable flower beds around village buildings", () => {
    const village = generateVillage(813, PLACEHOLDER_BRIEFS.village);
    const flowers = village.layers.feature.flat().filter((tile) => tile === Tile.Flowers);

    expect(flowers.length).toBeGreaterThan(0);
    expect(allPointsReachable(village)).toBe(true);
  });

  it.each(generatorCases)("%s keeps points reachable for 200 seeds", (_label, biome, generator) => {
    const brief = PLACEHOLDER_BRIEFS[biome];
    for (let seed = 0; seed < 200; seed += 1) {
      expect(allPointsReachable(generator(seed, brief)), `${biome} seed ${seed}`).toBe(true);
    }
  });

  it("creates a reciprocal door and reuses the same visited area on return", () => {
    const origin = generateArea(19, PLACEHOLDER_BRIEFS.meadow);
    const session = new WorldSession(origin);
    const outboundDoor = origin.doors[0]!;
    const outbound = session.enterDoor(origin.id, outboundDoor.id);
    const returnDoor = outbound.area.doors.find((door) => door.targetAreaId === origin.id);

    expect(outbound.generated).toBe(true);
    expect(returnDoor).toBeDefined();
    expect(allPointsReachable(outbound.area)).toBe(true);
    expect(outbound.area.doors.every((door) => door.x >= 0 && door.y >= 0)).toBe(true);

    const storedOrigin = session.getArea(origin.id);
    const back = session.enterDoor(outbound.area.id, returnDoor!.id);
    expect(back.area).toBe(storedOrigin);
    expect(back.area.id).toBe(origin.id);
    expect(session.visitedAreaCount).toBe(2);

    const visitedAgain = session.enterDoor(origin.id, outboundDoor.id);
    expect(visitedAgain.generated).toBe(false);
    expect(visitedAgain.area).toBe(outbound.area);
  });

  it("offers multiple neighboring biomes from the starting meadow", () => {
    const origin = generateArea(2026, PLACEHOLDER_BRIEFS.meadow);
    const session = new WorldSession(origin);
    const reached = origin.doors.map((door) => session.enterDoor(origin.id, door.id).area.biome);
    expect(new Set(reached).size).toBeGreaterThan(1);
  });

  it.each(generatorCases)("%s gives every door a reciprocal stored route", (_label, biome, generator) => {
    const origin = generator(301, PLACEHOLDER_BRIEFS[biome]);
    expect(JSON.parse(JSON.stringify(origin))).toEqual(origin);

    for (const door of origin.doors) {
      const session = new WorldSession(origin);
      const outbound = session.enterDoor(origin.id, door.id);
      const returnDoor = outbound.area.doors.find((candidate) => candidate.targetAreaId === origin.id);
      expect(returnDoor, `${biome} ${door.id} return door`).toBeDefined();
      expect(allPointsReachable(outbound.area), `${biome} ${door.id} return reachability`).toBe(true);

      const back = session.enterDoor(outbound.area.id, returnDoor!.id);
      expect(back.area).toBe(session.getArea(origin.id));
      expect(back.generated).toBe(false);
    }
  });
});

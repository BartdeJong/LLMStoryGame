import { describe, expect, it } from "vitest";
import { entitySolidityIsSafe, reachableTilesWithSolidEntities, selectSolidEntityIds } from "./solidity";
import { Tile } from "./types";
import type { Area } from "./types";

function corridorArea(): Area {
  const width = 9;
  const height = 5;
  const ground = Array.from({ length: height }, () => Array<Tile>(width).fill(Tile.Floor));
  const feature = Array.from({ length: height }, () => Array<Tile>(width).fill(Tile.Wall));
  for (let x = 1; x <= 7; x += 1) feature[2]![x] = Tile.Grass;
  feature[2]![1] = Tile.Door;
  feature[2]![7] = Tile.Door;
  return {
    id: "old-layout",
    seed: 1,
    name: "Old corridor",
    biome: "building",
    mood: "quiet",
    palette: "village",
    width,
    height,
    layers: { ground, feature },
    entry: { x: 1, y: 2 },
    spawnPoints: [{ id: "obj:desk", kind: "object", x: 4, y: 2 }],
    doors: [
      { id: "left", label: "Left", kind: "hatch", x: 1, y: 2 },
      { id: "right", label: "Right", kind: "hatch", x: 7, y: 2 },
    ],
    entities: [{
      id: "obj:desk",
      kind: "object",
      name: "Desk",
      description: "A desk saved in the corridor.",
      required: true,
      x: 4,
      y: 2,
    }],
  };
}

describe("entity solidity", () => {
  it("keeps an old corridor object walkable when making it solid would block a door", () => {
    const area = corridorArea();
    const forcedSolid = new Set(["obj:desk"]);
    expect(entitySolidityIsSafe(area, forcedSolid)).toBe(false);

    const solidIds = selectSolidEntityIds(area);
    expect(solidIds.has("obj:desk")).toBe(false);
    expect(entitySolidityIsSafe(area, solidIds)).toBe(true);
    expect(reachableTilesWithSolidEntities(area, solidIds).has("7,2")).toBe(true);
  });
});

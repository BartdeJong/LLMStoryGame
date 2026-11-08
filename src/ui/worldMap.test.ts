import { describe, expect, it } from "vitest";
import { buildWorldMapGraph } from "./worldMap";
import type { Area } from "../world/types";

function area(id: string, targets: readonly string[] = []): Area {
  return {
    id,
    seed: id,
    name: id,
    biome: "meadow",
    mood: "",
    palette: "meadow",
    width: 1,
    height: 1,
    layers: { ground: [[0]], feature: [[0]] },
    entry: { x: 0, y: 0 },
    spawnPoints: [],
    doors: targets.map((targetAreaId, index) => ({
      id: `${id}-${index}`,
      label: targetAreaId,
      kind: "edge",
      x: 0,
      y: 0,
      targetAreaId,
    })),
  };
}

describe("explored world map", () => {
  it("lays out all explored areas by their door connections", () => {
    const graph = buildWorldMapGraph([
      area("start", ["east"]),
      area("east", ["start", "north"]),
      area("north", ["east"]),
    ], "start");

    expect(graph.nodes.map(({ area: entry, column }) => [entry.id, column])).toEqual([
      ["start", 0],
      ["east", 1],
      ["north", 2],
    ]);
    expect(graph.edges).toEqual([
      { from: "start", to: "east" },
      { from: "east", to: "north" },
    ]);
  });

  it("keeps disconnected explored areas visible", () => {
    const graph = buildWorldMapGraph([area("start"), area("elsewhere")], "start");

    expect(graph.nodes.map(({ area: entry }) => entry.id)).toEqual(["start", "elsewhere"]);
    expect(graph.edges).toEqual([]);
  });

  it("requires the current area to be in the explored areas", () => {
    expect(() => buildWorldMapGraph([area("start")], "missing"))
      .toThrow('The current area "missing" is missing from the explored map.');
  });
});

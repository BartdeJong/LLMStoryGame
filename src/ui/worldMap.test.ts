import { describe, expect, it } from "vitest";
import { buildWorldMapGraph } from "./worldMap";
import type { Area } from "../world/types";

type Route = { targetAreaId: string; direction: "north" | "east" | "south" | "west" };

function area(id: string, routes: readonly Route[] = []): Area {
  return {
    id,
    seed: id,
    name: id,
    biome: "meadow",
    mood: "",
    palette: "meadow",
    width: 5,
    height: 5,
    layers: { ground: [[0]], feature: [[0]] },
    entry: { x: 0, y: 0 },
    spawnPoints: [],
    doors: routes.map(({ targetAreaId, direction }, index) => ({
      id: `${id}-${index}`,
      label: targetAreaId,
      kind: "edge",
      x: direction === "west" ? 0 : direction === "east" ? 4 : 2,
      y: direction === "north" ? 0 : direction === "south" ? 4 : 2,
      targetAreaId,
    })),
  };
}

describe("explored world map", () => {
  it("places discovered areas in the direction of their connecting exits", () => {
    const graph = buildWorldMapGraph([
      area("start", [{ targetAreaId: "east", direction: "east" }]),
      area("east", [
        { targetAreaId: "start", direction: "west" },
        { targetAreaId: "north", direction: "north" },
      ]),
      area("north", [{ targetAreaId: "east", direction: "south" }]),
    ], "start");

    const nodes = new Map(graph.nodes.map((node) => [node.area.id, node]));
    expect(nodes.get("east")!.column).toBeGreaterThan(nodes.get("start")!.column);
    expect(nodes.get("north")!.row).toBeLessThan(nodes.get("east")!.row);
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

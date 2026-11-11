import { describe, expect, it } from "vitest";
import { buildWorldMapGraph, exitBearing, exitSide, findWorldMapRoute, layoutWorldMap, routeWorldMapEdges } from "./worldMap";
import type { Area } from "../world/types";

type Route = { targetAreaId?: string; direction: "north" | "east" | "south" | "west" };

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
      label: targetAreaId ?? "somewhere",
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
      { from: "start", to: "east", fromDoorId: "start-0", toDoorId: "east-0" },
      { from: "east", to: "north", fromDoorId: "east-1", toDoorId: "north-0" },
    ]);
  });

  it("lists every exit of an area with its side and explored destination", () => {
    const graph = buildWorldMapGraph([
      area("start", [
        { targetAreaId: "east", direction: "east" },
        { targetAreaId: "hidden", direction: "north" },
        { direction: "south" },
      ]),
      area("east", [{ targetAreaId: "start", direction: "west" }]),
    ], "start");

    const start = graph.nodes.find((node) => node.area.id === "start")!;
    expect(start.exits.map(({ door, side, targetAreaId }) => ({ id: door.id, side, targetAreaId }))).toEqual([
      { id: "start-0", side: "east", targetAreaId: "east" },
      { id: "start-1", side: "north", targetAreaId: undefined },
      { id: "start-2", side: "south", targetAreaId: undefined },
    ]);
    expect(graph.edges).toEqual([{ from: "start", to: "east", fromDoorId: "start-0", toDoorId: "east-0" }]);
  });

  it("tells corner doors apart from doors in the middle of a wall", () => {
    const room = { ...area("room"), width: 40, height: 24 };
    const side = (x: number, y: number) => exitSide(room, { id: "d", label: "d", kind: "edge", x, y });
    const bearing = (x: number, y: number) => exitBearing(room, { id: "d", label: "d", kind: "edge", x, y });

    expect(side(2, 12)).toBe("west");
    expect(side(37, 12)).toBe("east");
    expect(side(20, 2)).toBe("north");
    expect(side(20, 21)).toBe("south");
    expect(side(2, 3)).toBe("north-west");
    expect(side(37, 20)).toBe("south-east");
    expect([bearing(20, 2), bearing(25, 2), bearing(37, 3), bearing(37, 7), bearing(37, 12)]).toEqual([0, 22.5, 45, 67.5, 90]);
    expect([bearing(37, 17), bearing(20, 21), bearing(2, 12), bearing(15, 2)]).toEqual([112.5, 180, 270, 337.5]);
  });

  it("keeps every place where it is when the player moves", () => {
    const areas = [
      area("start", [{ targetAreaId: "east", direction: "east" }]),
      area("east", [
        { targetAreaId: "start", direction: "east" },
        { targetAreaId: "north", direction: "north" },
      ]),
      area("north", [{ targetAreaId: "east", direction: "south" }]),
    ];
    const cells = (current: string) =>
      buildWorldMapGraph(areas, current).nodes.map(({ area: entry, column, row }) => ({ id: entry.id, column, row }));

    expect(cells("east")).toEqual(cells("start"));
    expect(cells("north")).toEqual(cells("start"));
  });

  it("shows places in their real compass cells when the world provides them", () => {
    const world: Record<string, { column: number; row: number }> = {
      start: { column: 0, row: 0 },
      east: { column: -4, row: 0 },
      north: { column: -4, row: 3 },
    };
    const graph = buildWorldMapGraph([
      area("start", [{ targetAreaId: "east", direction: "east" }]),
      area("east", [
        { targetAreaId: "start", direction: "west" },
        { targetAreaId: "north", direction: "north" },
      ]),
      area("north", [{ targetAreaId: "east", direction: "south" }]),
    ], "north", { getCell: (id) => world[id] });

    expect(graph.nodes.map(({ area: entry, column, row }) => ({ id: entry.id, column, row }))).toEqual([
      { id: "start", column: 1, row: 0 },
      { id: "east", column: 0, row: 0 },
      { id: "north", column: 0, row: 1 },
    ]);
  });

  it("marks locked exits, people met and the current lead", () => {
    const graph = buildWorldMapGraph([
      area("start", [
        { targetAreaId: "east", direction: "east" },
        { targetAreaId: "tower", direction: "north" },
        { targetAreaId: "cellar", direction: "south" },
      ]),
      area("east", [{ targetAreaId: "start", direction: "west" }]),
    ], "start", {
      getExitLock: (areaId, doorId) => (areaId === "start" && doorId === "start-1" ? "Needs Tower key" : null),
      getPeopleMet: (areaId) => (areaId === "east" ? ["Mira"] : []),
      isLead: (areaId) => areaId === "east" || areaId === "cellar",
    });
    const [start, east] = graph.nodes;

    expect(start!.exits.map(({ lock, lead }) => ({ lock, lead }))).toEqual([
      { lock: undefined, lead: false },
      { lock: "Needs Tower key", lead: false },
      { lock: undefined, lead: true },
    ]);
    expect({ lead: start!.lead, peopleMet: start!.peopleMet }).toEqual({ lead: false, peopleMet: [] });
    expect({ lead: east!.lead, peopleMet: east!.peopleMet }).toEqual({ lead: true, peopleMet: ["Mira"] });

    const plain = layoutWorldMap(buildWorldMapGraph(graph.nodes.map((node) => node.area), "start"));
    const marked = layoutWorldMap(graph);
    expect(marked.cards.get("start")!.height).toBeGreaterThan(plain.cards.get("start")!.height);
    expect(marked.cards.get("east")!.height).toBeGreaterThan(plain.cards.get("east")!.height);
  });

  it("finds the shortest chain of open exits to a chosen place", () => {
    const areas = [
      area("a", [
        { targetAreaId: "b", direction: "east" },
        { targetAreaId: "d", direction: "south" },
      ]),
      area("b", [
        { targetAreaId: "a", direction: "west" },
        { targetAreaId: "c", direction: "east" },
      ]),
      area("c", [
        { targetAreaId: "b", direction: "west" },
        { targetAreaId: "d", direction: "south" },
      ]),
      area("d", [
        { targetAreaId: "a", direction: "north" },
        { targetAreaId: "c", direction: "east" },
        { targetAreaId: "unexplored", direction: "south" },
      ]),
      area("island"),
    ];
    const open = buildWorldMapGraph(areas, "a");

    expect(findWorldMapRoute(open, "a", "a")).toEqual([]);
    expect(findWorldMapRoute(open, "a", "d")).toEqual([{ areaId: "a", doorId: "a-1", targetAreaId: "d" }]);
    expect(findWorldMapRoute(open, "a", "c")).toEqual([
      { areaId: "a", doorId: "a-0", targetAreaId: "b" },
      { areaId: "b", doorId: "b-1", targetAreaId: "c" },
    ]);
    expect(findWorldMapRoute(open, "a", "island")).toBeNull();
    expect(findWorldMapRoute(open, "a", "unexplored")).toBeNull();

    const locked = buildWorldMapGraph(areas, "a", {
      getExitLock: (areaId, doorId) => (areaId === "a" && doorId === "a-1" ? "Locked" : null),
    });
    expect(findWorldMapRoute(locked, "a", "d")).toEqual([
      { areaId: "a", doorId: "a-0", targetAreaId: "b" },
      { areaId: "b", doorId: "b-1", targetAreaId: "c" },
      { areaId: "c", doorId: "c-1", targetAreaId: "d" },
    ]);
  });

  it("gives every card room for its exits without overlapping the next row", () => {
    const graph = buildWorldMapGraph([
      area("hub", [
        { targetAreaId: "below", direction: "south" },
        { targetAreaId: "right", direction: "east" },
        { direction: "north" },
        { direction: "west" },
      ]),
      area("below", [{ targetAreaId: "hub", direction: "north" }]),
      area("right", [{ targetAreaId: "hub", direction: "west" }]),
    ], "hub");
    const layout = layoutWorldMap(graph);
    const hub = layout.cards.get("hub")!;
    const below = layout.cards.get("below")!;
    const right = layout.cards.get("right")!;

    expect(hub.height).toBeGreaterThan(below.height);
    expect(below.y).toBeGreaterThan(hub.y + hub.height);
    expect(right.x).toBeGreaterThan(hub.x + hub.width);
    expect(right.y).toBe(hub.y);
    expect(layout.width).toBeGreaterThan(right.x + right.width);
    expect(layout.height).toBeGreaterThan(below.y + below.height);
  });

  it("sends a path around a card that lies between its two ends", () => {
    const graph = buildWorldMapGraph([
      area("left", [{ targetAreaId: "middle", direction: "east" }]),
      area("middle", [
        { targetAreaId: "left", direction: "west" },
        { targetAreaId: "right", direction: "east" },
      ]),
      area("right", [
        { targetAreaId: "middle", direction: "west" },
        { targetAreaId: "left", direction: "north" },
      ]),
    ], "left");
    const layout = layoutWorldMap(graph);
    const routes = routeWorldMapEdges(graph, layout);
    const far = routes[graph.edges.findIndex((edge) => edge.from === "right" && edge.to === "left")]!;
    const near = routes[graph.edges.findIndex((edge) => edge.from === "left" && edge.to === "middle")]!;

    expect(near.curve).toBeDefined();
    expect(far.curve).toBeUndefined();
    const stops = [far.start, ...far.corners!, far.end];
    for (let index = 1; index < stops.length; index += 1) {
      const a = stops[index - 1]!;
      const b = stops[index]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
      for (const card of layout.cards.values()) {
        const overlapsX = Math.max(a.x, b.x) > card.x && Math.min(a.x, b.x) < card.x + card.width;
        const overlapsY = Math.max(a.y, b.y) > card.y && Math.min(a.y, b.y) < card.y + card.height;
        expect(overlapsX && overlapsY).toBe(false);
      }
    }
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

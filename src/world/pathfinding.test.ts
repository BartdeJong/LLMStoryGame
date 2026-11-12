import { describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import { isWalkable, reachableTiles } from "./connectivity";
import { areaFromRows } from "./testArea";
import { findPath, tilesWithinRange } from "./pathfinding";

function grid(rows: readonly string[]) {
  return {
    width: rows[0]!.length,
    height: rows.length,
    isPassable: (x: number, y: number) => rows[y]?.[x] === ".",
  };
}

describe("findPath", () => {
  it("returns just the start when it already is a goal", () => {
    const map = grid(["..."]);
    expect(findPath({ ...map, start: { x: 1, y: 0 }, goals: [{ x: 1, y: 0 }] })).toEqual([{ x: 1, y: 0 }]);
  });

  it("walks around walls with orthogonal steps only", () => {
    const map = grid([
      "....",
      ".##.",
      "....",
    ]);
    const path = findPath({ ...map, start: { x: 0, y: 1 }, goals: [{ x: 3, y: 1 }] })!;
    expect(path[0]).toEqual({ x: 0, y: 1 });
    expect(path.at(-1)).toEqual({ x: 3, y: 1 });
    for (let index = 1; index < path.length; index += 1) {
      const step = Math.abs(path[index]!.x - path[index - 1]!.x) + Math.abs(path[index]!.y - path[index - 1]!.y);
      expect(step).toBe(1);
      expect(map.isPassable(path[index]!.x, path[index]!.y)).toBe(true);
    }
  });

  it("prefers a straight run over a staircase of equal length", () => {
    const map = grid([
      ".....",
      ".....",
      ".....",
    ]);
    const path = findPath({ ...map, start: { x: 0, y: 0 }, goals: [{ x: 4, y: 2 }] })!;
    let turns = 0;
    for (let index = 2; index < path.length; index += 1) {
      const before = [path[index - 1]!.x - path[index - 2]!.x, path[index - 1]!.y - path[index - 2]!.y];
      const after = [path[index]!.x - path[index - 1]!.x, path[index]!.y - path[index - 1]!.y];
      if (before[0] !== after[0] || before[1] !== after[1]) turns += 1;
    }
    expect(turns).toBe(1);
  });

  it("picks the nearest of several goals", () => {
    const map = grid(["........"]);
    const path = findPath({ ...map, start: { x: 3, y: 0 }, goals: [{ x: 0, y: 0 }, { x: 5, y: 0 }] })!;
    expect(path.at(-1)).toEqual({ x: 5, y: 0 });
  });

  it("returns null when walls cut the goal off", () => {
    const map = grid([
      ".#.",
      ".#.",
    ]);
    expect(findPath({ ...map, start: { x: 0, y: 0 }, goals: [{ x: 2, y: 0 }] })).toBeNull();
  });

  it("returns null for goals outside the map or when there are none", () => {
    const map = grid(["..."]);
    expect(findPath({ ...map, start: { x: 0, y: 0 }, goals: [{ x: 9, y: 0 }] })).toBeNull();
    expect(findPath({ ...map, start: { x: 0, y: 0 }, goals: [] })).toBeNull();
  });

  it("may leave a start tile that is itself blocked", () => {
    const map = grid(["#.."]);
    expect(findPath({ ...map, start: { x: 0, y: 0 }, goals: [{ x: 2, y: 0 }] })).toHaveLength(3);
  });

  it("agrees with reachableTiles on baked areas", () => {
    for (const location of example.locations) {
      const area = areaFromRows(location.area.map);
      const reachable = reachableTiles(area);
      const goals = area.doors.map((door) => ({ x: door.x, y: door.y }));
      for (const goal of goals) {
        const path = findPath({
          width: area.width,
          height: area.height,
          start: area.entry,
          goals: [goal],
          isPassable: (x, y) => isWalkable(area, x, y),
        });
        expect(path !== null).toBe(reachable.has(`${goal.x},${goal.y}`));
      }
    }
  });
});

describe("tilesWithinRange", () => {
  it("lists the target and its neighbours inside the range, clipped to the map", () => {
    const tiles = tilesWithinRange({ x: 0, y: 0 }, 1, 3, 3).map(({ x, y }) => `${x},${y}`);
    expect(tiles.sort()).toEqual(["0,0", "0,1", "1,0"]);
    expect(tilesWithinRange({ x: 5, y: 5 }, 1.5, 10, 10)).toHaveLength(9);
  });
});

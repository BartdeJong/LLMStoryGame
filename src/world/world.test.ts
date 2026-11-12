import { describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import { reachableTiles } from "./connectivity";
import { areaFromRows } from "./testArea";

describe("baked areas", () => {
  it("lets the player reach every door from the start of each example area", () => {
    for (const location of example.locations) {
      const area = areaFromRows(location.area.map, location.id);
      const reachable = reachableTiles(area);
      expect(reachable.size, location.id).toBeGreaterThan(20);
      for (const door of area.doors) {
        const around = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reachable.has(`${door.x + dx!},${door.y + dy!}`));
        expect(around, `${location.id} ${door.label}`).toBe(true);
      }
    }
  });
});

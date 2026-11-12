import { describe, expect, it } from "vitest";
import { followCamera } from "./camera";
import { areaFromRows } from "./world/testArea";

const world = areaFromRows(Array.from({ length: 24 }, () => ".".repeat(40)));

describe("followCamera", () => {
  it("clamps to the world edges when the view fits inside", () => {
    expect(followCamera({ x: 0, y: 0 }, world, 320, 180)).toEqual({ x: 0, y: 0 });
    expect(followCamera({ x: 640, y: 384 }, world, 320, 180)).toEqual({ x: 320, y: 204 });
    expect(followCamera({ x: 320, y: 192 }, world, 320, 180)).toEqual({ x: 160, y: 102 });
  });

  it("centres an axis on which the view is larger than the world", () => {
    expect(followCamera({ x: 100, y: 10 }, world, 293, 633)).toEqual({ x: 0, y: -124 });
    expect(followCamera({ x: 600, y: 380 }, world, 800, 200)).toEqual({ x: -80, y: 184 });
  });
});

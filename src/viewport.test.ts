import { describe, expect, it } from "vitest";
import { computeViewLayout } from "./viewport";

describe("computeViewLayout", () => {
  it("keeps a 16:9 desktop window at the original 320x180 view", () => {
    for (const [width, height] of [[1280, 720], [1920, 1080], [640, 360]] as const) {
      const layout = computeViewLayout(width, height, 1);
      expect([layout.width, layout.height]).toEqual([320, 180]);
      expect(layout.cssLeft).toBe(0);
      expect(layout.cssTop).toBe(0);
    }
  });

  it("covers a portrait phone and stays at roughly the old tile size", () => {
    const layout = computeViewLayout(390, 844, 3);
    expect(layout.deviceScale).toBe(4);
    expect(layout.cssWidth).toBeGreaterThanOrEqual(390);
    expect(layout.cssHeight).toBeGreaterThanOrEqual(844);
    expect(layout.width).toBe(293);
    expect(layout.height).toBe(633);
  });

  it("covers a 4:3 iPad in both orientations", () => {
    for (const [width, height] of [[1024, 768], [768, 1024]] as const) {
      const layout = computeViewLayout(width, height, 2);
      expect(layout.cssWidth).toBeGreaterThanOrEqual(width);
      expect(layout.cssHeight).toBeGreaterThanOrEqual(height);
      expect(Number.isInteger(layout.deviceScale)).toBe(true);
    }
  });

  it("never drops below one device pixel per world pixel", () => {
    expect(computeViewLayout(100, 60, 1).deviceScale).toBe(1);
    expect(computeViewLayout(0, 0, 0).deviceScale).toBe(1);
  });

  it("centres the overhang", () => {
    const layout = computeViewLayout(390, 844, 3);
    expect(layout.cssLeft).toBeLessThanOrEqual(0);
    expect(layout.cssLeft).toBeGreaterThan(-1);
  });
});

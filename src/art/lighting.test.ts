import { describe, expect, it } from "vitest";
import { areaFromRows } from "../world/testArea";
import type { Area, AreaEntity } from "../world";
import { PALETTES } from "./palettes";
import {
  ambientFor, areaHasLights, capLightRadius, collectLights, effectiveAmbient, flickerFactor, lightPhase, luma,
  mapBoundaryShapes, poolLift, type Rect, type StoryLighting,
} from "./lighting";
import { GLYPH_LIGHTS } from "./glyphs";
import { STORY_THEMES, getStoryVisualTheme } from "./storyTheme";

const lighting: StoryLighting = { outdoor: "#111111", indoor: "#222222", underground: "#333333", edge: "#444444" };
const VIEW = { width: 320, height: 180 };

function areaWith(decor: Area["decor"]): Area {
  const area = areaFromRows(["..........", "..........", ".........."]);
  return { ...area, decor };
}

describe("ambientFor", () => {
  it("picks the ambient by biome", () => {
    expect(ambientFor(lighting, "building")).toBe("#222222");
    expect(ambientFor(lighting, "cave")).toBe("#333333");
    expect(ambientFor(lighting, "ruins")).toBe("#333333");
    expect(ambientFor(lighting, "meadow")).toBe("#111111");
    expect(ambientFor(lighting, "shore")).toBe("#111111");
  });
});

describe("flickerFactor", () => {
  it("is deterministic and bounded", () => {
    for (let time = 0; time < 5; time += 0.037) {
      const value = flickerFactor(time, 1.3, 0.14, false);
      expect(value).toBe(flickerFactor(time, 1.3, 0.14, false));
      expect(value).toBeGreaterThanOrEqual(0.86 - 1e-9);
      expect(value).toBeLessThanOrEqual(1.14 + 1e-9);
    }
  });

  it("is exactly 1 when reduced or amount is 0", () => {
    expect(flickerFactor(1.234, 2, 0.2, true)).toBe(1);
    expect(flickerFactor(1.234, 2, 0, false)).toBe(1);
  });
});

describe("lightPhase", () => {
  it("is stable and within one turn", () => {
    expect(lightPhase("3,4")).toBe(lightPhase("3,4"));
    expect(lightPhase("3,4")).not.toBe(lightPhase("4,3"));
    const phase = lightPhase("anything");
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(Math.PI * 2);
  });
});

describe("collectLights", () => {
  it("finds a candle in view", () => {
    const lights = collectLights(areaWith([{ x: 2, y: 1, icon: "candle" }]), { x: 0, y: 0 }, VIEW);
    expect(lights).toHaveLength(1);
    expect(lights[0]).toMatchObject({ x: 40, y: 24, color: "#ffcf7a", radius: 28 });
  });

  it("culls lights far outside the view", () => {
    const lights = collectLights(areaWith([{ x: 2, y: 1, icon: "candle" }]), { x: 1000, y: 1000 }, VIEW);
    expect(lights).toHaveLength(0);
  });

  it("resolves _open icons and ignores glyphs without light", () => {
    const area = areaWith([{ x: 1, y: 1, icon: "lantern_open" }, { x: 3, y: 1, icon: "bookshelf" }]);
    expect(collectLights(area, { x: 0, y: 0 }, VIEW)).toHaveLength(1);
  });

  it("lights entities with a lit icon or a glow state", () => {
    const base = { kind: "object" as const, name: "Thing", description: "", required: false, x: 4, y: 1 };
    const area: Area = {
      ...areaWith([]),
      entities: [
        { ...base, id: "a", visual: { icon: "lantern" } },
        { ...base, id: "b", visual: { icon: "key", states: ["glow"], accent: "#00ff00" } },
      ],
    };
    const lights = collectLights(area, { x: 0, y: 0 }, VIEW);
    expect(lights).toHaveLength(2);
    expect(lights[1]).toMatchObject({ color: "#00ff00", radius: 20 });
  });

  const base = { kind: "object" as const, name: "Thing", description: "", required: false, x: 4, y: 1 };
  const withEntities = (entities: Area["entities"], rows = ["..........", "..........", ".........."]): Area => ({
    ...areaFromRows(rows),
    entities,
  });

  it("resolves a palette slot name accent to a hex colour", () => {
    const area = withEntities([{ ...base, id: "g", visual: { icon: "key", states: ["glow"], accent: "accent" } }]);
    const [light] = collectLights(area, { x: 0, y: 0 }, VIEW);
    expect(light!.color).toBe(PALETTES[area.palette].accent);
    expect(light!.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("falls back to the default glow for non-hex accents", () => {
    for (const accent of ["red", "hsl(10, 50%, 50%)", "#fff"]) {
      const area = withEntities([{ ...base, id: "g", visual: { icon: "key", states: ["glow"], accent } }]);
      expect(collectLights(area, { x: 0, y: 0 }, VIEW)[0]!.color).toBe("#ffd9a0");
    }
  });

  it("lets a moving character position override the tile", () => {
    const area = withEntities([{ ...base, id: "m", visual: { icon: "candle" } }]);
    const [light] = collectLights(area, { x: 0, y: 0 }, VIEW, new Map([["m", { x: 4.5, y: 1.25 }]]));
    expect(light).toMatchObject({ x: 4.5 * 16 + 8, y: 1.25 * 16 + 8 });
  });

  it("shifts wall-mounted lit entities up by 14px, including _open variants", () => {
    const rows = ["##########", "..........", ".........."];
    const mounted = (id: string, icon: string): AreaEntity => ({ ...base, id, name: "Shelf", visual: { icon } });
    const area = withEntities([mounted("a", "candle"), mounted("b", "candle_open")], rows);
    const flat = withEntities([{ ...base, id: "c", name: "Shelf", visual: { icon: "candle" } }]);
    const [open] = collectLights(withEntities([mounted("b", "candle_open")], rows), { x: 0, y: 0 }, VIEW);
    const [hung] = collectLights(area, { x: 0, y: 0 }, VIEW);
    const [plain] = collectLights(flat, { x: 0, y: 0 }, VIEW);
    expect(hung!.y).toBe(plain!.y - 14);
    expect(open!.y).toBe(plain!.y - 14);
  });

  it("shifts the glow light of a wall-mounted entity too", () => {
    const rows = ["##########", "..........", ".........."];
    const area = withEntities([{ ...base, id: "w", name: "Shelf", visual: { icon: "key", states: ["glow"] } }], rows);
    const flat = withEntities([{ ...base, id: "w", name: "Shelf", visual: { icon: "key", states: ["glow"] } }]);
    expect(collectLights(area, { x: 0, y: 0 }, VIEW)[0]!.y).toBe(collectLights(flat, { x: 0, y: 0 }, VIEW)[0]!.y - 14);
  });
});

describe("effectiveAmbient", () => {
  const themeIds = [...Object.keys(STORY_THEMES), "alpha", "beta-story", "gamma", "zzz", "lighthouse-12", "q"];
  const biomes: Area["biome"][] = ["meadow", "forest", "shore", "cave", "building", "ruins", "village"];

  it("keeps luma low enough for pools to show and channels readable, for every theme and biome", () => {
    for (const id of themeIds) {
      const themed = getStoryVisualTheme(id).lighting;
      for (const biome of biomes) {
        const ambient = effectiveAmbient(ambientFor(themed, biome), true);
        expect(luma(ambient), `${id} ${biome} ${ambient}`).toBeLessThanOrEqual(0.78 + 0.005); // AMBIENT_MAX_LUMA plus hex rounding
        for (const index of [1, 3, 5]) {
          expect(parseInt(ambient.slice(index, index + 2), 16), `${id} ${biome} ${ambient}`).toBeGreaterThanOrEqual(0x80);
        }
      }
    }
  });

  it("is unchanged when the area has no lights", () => {
    expect(effectiveAmbient("#f0e4cc", false)).toBe("#f0e4cc");
  });

  it("leaves already dark ambients and unusable colours alone", () => {
    expect(effectiveAmbient("#a9a6b8", true)).toBe("#a9a6b8");
    expect(effectiveAmbient("red", true)).toBe("red");
  });

  it("keeps the hue direction (channel order) when darkening", () => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(effectiveAmbient("#f0e4cc", true).slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });
});

describe("poolLift", () => {
  it("gives every glyph light a visible pool in every theme, biome and small room", () => {
    for (const id of [...Object.keys(STORY_THEMES), "alpha", "beta-story", "gamma", "zzz"]) {
      const themed = getStoryVisualTheme(id).lighting;
      for (const ambientSource of [themed.outdoor, themed.indoor, themed.underground]) {
        const ambient = effectiveAmbient(ambientSource, true);
        for (const [glyph, light] of Object.entries(GLYPH_LIGHTS)) {
          expect(capLightRadius(light.radius, 16 * 16, 11 * 16), glyph).toBeGreaterThanOrEqual(16);
          expect(poolLift(ambient, light), `${id} ${glyph} ${ambient}`).toBeGreaterThanOrEqual(0.12);
        }
      }
    }
  });

  it("fades with distance", () => {
    const light = { color: "#ffd27a", intensity: 0.8 };
    expect(poolLift("#c0b090", light, 0)).toBeGreaterThan(poolLift("#c0b090", light, 0.5));
    expect(poolLift("#c0b090", light, 1)).toBe(0);
  });

  it("has a lamp_stand light", () => {
    expect(GLYPH_LIGHTS.lamp_stand).toBeDefined();
  });
});

describe("areaHasLights", () => {
  it("is true only when something in the area emits light", () => {
    expect(areaHasLights(areaWith([]))).toBe(false);
    expect(areaHasLights(areaWith([{ x: 2, y: 1, icon: "lamp_stand" }] as Area["decor"]))).toBe(true);
  });
});

describe("capLightRadius", () => {
  it("limits reach to a share of the smaller room side", () => {
    expect(capLightRadius(48, 256, 176)).toBe(48);
    expect(capLightRadius(64, 256, 176)).toBeCloseTo(52.8);
    expect(capLightRadius(64, 1000, 1000)).toBe(64);
  });

  it("never drops below the minimum", () => {
    expect(capLightRadius(40, 30, 30)).toBe(16);
  });
});

describe("mapBoundaryShapes", () => {
  const view = { width: 320, height: 180 };

  it("is empty when the map fills the view", () => {
    const shapes = mapBoundaryShapes({ x: -100, y: -100, w: 1000, h: 1000 }, view);
    expect(shapes.outside).toEqual([]);
    expect(shapes.bands).toEqual([]);
  });

  it("blackens the margins and feathers inside a centred small map", () => {
    const shapes = mapBoundaryShapes({ x: 40, y: 20, w: 240, h: 140 }, view);
    const area = shapes.outside.reduce((sum, r) => sum + r.w * r.h, 0);
    expect(area).toBe(320 * 180 - 240 * 140);
    expect(shapes.bands).toHaveLength(4);
    expect(shapes.corners).toHaveLength(4);
    const top = shapes.bands[0];
    expect(top.rect).toEqual({ x: 64, y: 20, w: 192, h: 24 });
    expect(top.from).toEqual({ x: 0, y: 20 });
    expect(top.to).toEqual({ x: 0, y: 44 });
  });

  it("only feathers the edge that is in view", () => {
    const shapes = mapBoundaryShapes({ x: -200, y: -10, w: 1000, h: 1000 }, view);
    expect(shapes.outside).toEqual([]);
    expect(shapes.bands).toHaveLength(1);
    expect(shapes.bands[0].rect).toEqual({ x: 0, y: 0, w: 320, h: 14 });
  });

  it("never overlaps bands and corners, and covers each corner once", () => {
    const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const map of [{ x: 40, y: 20, w: 240, h: 140 }, { x: 10, y: 10, w: 30, h: 20 }, { x: -5, y: 3, w: 200, h: 100 }]) {
      const shapes = mapBoundaryShapes(map, view);
      const rects = [...shapes.bands.map((b) => b.rect), ...shapes.corners.map((c) => c.rect)];
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) expect(hit(rects[i], rects[j]), `${i} ${j}`).toBe(false);
      }
    }
    const shapes = mapBoundaryShapes({ x: 40, y: 20, w: 240, h: 140 }, view);
    const rects = [...shapes.bands.map((b) => b.rect), ...shapes.corners.map((c) => c.rect)];
    const covers = (px: number, py: number) => rects.filter((r) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h).length;
    for (const [px, py] of [[41, 21], [278, 21], [41, 158], [278, 158]]) expect(covers(px, py)).toBe(1);
  });

  it("clamps the feather to half a small map", () => {
    const shapes = mapBoundaryShapes({ x: 10, y: 10, w: 30, h: 20 }, view);
    const union = [...shapes.bands.map((b) => b.rect), ...shapes.corners.map((c) => c.rect)].reduce((sum, r) => sum + r.w * r.h, 0);
    expect(union).toBe(30 * 20);
  });
});

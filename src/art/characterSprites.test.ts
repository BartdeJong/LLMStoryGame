import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import example from "../../public/stories/example.json";
import paddington from "../../public/stories/paddingtonhat.json";
import holmes from "../../public/stories/holmesashenvelope.json";
import lanterntide from "../../public/stories/lanterntide.json";
import { DIRECTIONS } from "./sprites";
import { IDLE_POSE, SPRITE_HEIGHT, SPRITE_WIDTH, WALK_POSES, getSpriteCanvas, renderSpriteCells } from "./characterSprites";
import { SPRITE_SPECIES, parseSpriteSpec, spriteDifferences, validateSpriteSpec, type SpriteSpec } from "./spriteSpec";

const packs = [example, paddington, holmes, lanterntide];

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, imageSmoothingEnabled: true }) }),
  });
});
afterEach(() => vi.unstubAllGlobals());

const base: SpriteSpec = { species: "human", height: "average", girth: "average", skin: "#e8c4a4" };

describe("sprite spec", () => {
  it("accepts a minimal spec and rejects bad ones", () => {
    expect(parseSpriteSpec(base)).not.toBeNull();
    expect(validateSpriteSpec({ ...base, skin: "red" })).not.toEqual([]);
    expect(validateSpriteSpec({ ...base, species: "dragon" })).not.toEqual([]);
    expect(validateSpriteSpec({ ...base, outfit: { style: "cape" } })).not.toEqual([]);
    expect(validateSpriteSpec({ ...base, extra: 1 })).not.toEqual([]);
    expect(validateSpriteSpec({ ...base, accessories: [{ kind: "cane" }, { kind: "broom" }] })).not.toEqual([]);
  });

  it("counts differences between specs", () => {
    expect(spriteDifferences(base, base)).toBe(0);
    expect(spriteDifferences(base, { ...base, species: "bear", girth: "stout" })).toBe(2);
  });
});

describe("sprite renderer", () => {
  it("draws every species in every direction and pose", () => {
    for (const species of SPRITE_SPECIES) {
      const spec: SpriteSpec = { ...base, species, outfit: { style: "coat", color: "#335577" }, headwear: { style: "bowler", color: "#222222" } };
      for (const direction of DIRECTIONS) {
        const frames = new Set<string>();
        for (const pose of [...Array(WALK_POSES).keys(), IDLE_POSE]) {
          const cells = renderSpriteCells(spec, direction, pose);
          expect(cells).toHaveLength(SPRITE_WIDTH * SPRITE_HEIGHT);
          expect(cells.filter(Boolean).length).toBeGreaterThan(40);
          frames.add(cells.join("|"));
        }
        expect(frames.size).toBeGreaterThan(1);
      }
    }
  });

  it("looks different from each side and mirrors left to right", () => {
    const left = renderSpriteCells(base, "left", 0);
    const right = renderSpriteCells(base, "right", 0);
    expect(left).not.toEqual(right);
    expect(new Set([renderSpriteCells(base, "down"), renderSpriteCells(base, "up"), left].map((c) => c.join("|"))).size).toBe(3);
    for (let y = 0; y < SPRITE_HEIGHT; y += 1) {
      for (let x = 0; x < SPRITE_WIDTH; x += 1) expect(right[y * SPRITE_WIDTH + x]).toBe(left[y * SPRITE_WIDTH + SPRITE_WIDTH - 1 - x]);
    }
  });

  it("caches canvases per spec, direction and pose", () => {
    expect(getSpriteCanvas(base, "down", 0)).toBe(getSpriteCanvas(base, "down", 4 * 3));
    expect(getSpriteCanvas(base, "down", 0)).not.toBe(getSpriteCanvas(base, "up", 0));
  });
});

describe("story packs", () => {
  it("give every character and the player a valid, distinct sprite", () => {
    for (const pack of packs) {
      const specs = [pack.identity.player.sprite, ...pack.cast.map((member) => member.sprite)];
      expect(pack.identity.player.name).toBeTruthy();
      for (const spec of specs) expect(validateSpriteSpec(spec)).toEqual([]);
      for (let a = 0; a < specs.length; a += 1) {
        for (let b = a + 1; b < specs.length; b += 1) {
          expect(spriteDifferences(specs[a] as SpriteSpec, specs[b] as SpriteSpec)).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BODY_SHAPES,
  CHARACTER_FEATURES,
  DEFAULT_CHARACTER_RECIPE,
  DIRECTIONS,
  ICON_SHAPES,
  PALETTE_COLOR_SLOTS,
  PALETTE_NAMES,
  PALETTES,
  WALK_FRAME_COUNTS,
  ASHEN_OBJECT_SPRITE_IDS,
  paintCharacterSprite,
  getAshenObjectSprite,
  paintIcon,
  paintTile,
  TILE_TYPES,
  type CharacterRecipe,
  type IconRecipe,
} from "./index";
import ashenStory from "../../public/stories/holmesashenvelope.json";

interface DrawCommand {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
}

interface RecordingCanvas extends HTMLCanvasElement {
  readonly commands: DrawCommand[];
}

function createRecordingCanvas(): RecordingCanvas {
  const commands: DrawCommand[] = [];
  const context = {
    fillStyle: "#000000",
    imageSmoothingEnabled: true,
    fillRect(x: number, y: number, width: number, height: number) {
      commands.push({ x, y, width, height, color: String(this.fillStyle) });
    },
  };
  return {
    width: 0,
    height: 0,
    commands,
    getContext: () => context,
  } as unknown as RecordingCanvas;
}

function commandsOf(canvas: HTMLCanvasElement): DrawCommand[] {
  return (canvas as RecordingCanvas).commands;
}

beforeEach(() => {
  vi.stubGlobal("document", { createElement: createRecordingCanvas });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("art painters", () => {
  it("uses a stable pixel command output for the same tile seed", () => {
    const first = paintTile("meadow", "grass", "orchard-17");
    const second = paintTile("meadow", "grass", "orchard-17");
    const different = paintTile("meadow", "grass", "orchard-18");

    expect(first.width).toBe(16);
    expect(first.height).toBe(16);
    expect(commandsOf(first)).toEqual(commandsOf(second));
    expect(commandsOf(first)).not.toEqual(commandsOf(different));
  });

  it("defines cozy palettes with eight to twelve colors", () => {
    expect(PALETTE_NAMES).toHaveLength(8);
    for (const paletteName of PALETTE_NAMES) {
      expect(Object.keys(PALETTES[paletteName])).toHaveLength(10);
    }
  });

  it("paints every tile type at 16 by 16 pixels", () => {
    for (const tile of TILE_TYPES) {
      const canvas = paintTile("forest", tile, 42, 1);
      expect(canvas.width).toBe(16);
      expect(canvas.height).toBe(16);
      expect(commandsOf(canvas).length).toBeGreaterThan(0);
    }
  });

  it("uses two distinct shimmer frames for water", () => {
    expect(commandsOf(paintTile("shore", "water", 3, 0))).not.toEqual(
      commandsOf(paintTile("shore", "water", 3, 1)),
    );
  });

  it("accepts every character recipe menu value", () => {
    const base = DEFAULT_CHARACTER_RECIPE;
    const recipes: CharacterRecipe[] = [
      ...BODY_SHAPES.map((body) => ({ ...base, body })),
      ...CHARACTER_FEATURES.map((feature) => ({ ...base, feature })),
      ...PALETTE_COLOR_SLOTS.flatMap((slot) => [
        { ...base, bodyColor: slot },
        { ...base, accentColor: slot },
        { ...base, skinColor: slot },
      ]),
    ];

    for (const recipe of recipes) {
      const canvas = paintCharacterSprite(recipe, "meadow");
      expect(canvas.width).toBe(16);
      expect(canvas.height).toBe(16);
      expect(commandsOf(canvas).length).toBeGreaterThan(0);
    }

    for (const direction of DIRECTIONS) {
      expect(commandsOf(paintCharacterSprite(base, "meadow", direction)).length).toBeGreaterThan(0);
    }
    for (const walkFrames of WALK_FRAME_COUNTS) {
      expect(commandsOf(paintCharacterSprite({ ...base, walkFrames }, "meadow", "down", walkFrames - 1)).length)
        .toBeGreaterThan(0);
    }
  });

  it("gives Victorian character accessories distinct pixel designs", () => {
    const features = ["deerstalker", "moustache", "bonnet", "bowler", "top-hat", "flat-cap", "headscarf", "monocle", "cravat", "veil"] as const;
    const sprites = features.map((feature) =>
      commandsOf(paintCharacterSprite({ ...DEFAULT_CHARACTER_RECIPE, feature }, "village")),
    );

    expect(new Set(sprites.map((commands) => JSON.stringify(commands))).size).toBe(features.length);
  });

  it("paints every icon recipe menu value", () => {
    for (const shape of ICON_SHAPES) {
      const recipe: IconRecipe = {
        shape,
        primaryColor: "accent",
        secondaryColor: "highlight",
      };
      const canvas = paintIcon(recipe, "meadow");
      expect(canvas.width).toBe(16);
      expect(canvas.height).toBe(16);
      expect(commandsOf(canvas).length).toBeGreaterThan(0);
    }
  });

  it("defines a distinct sprite for every Ashen story object", () => {
    const storyObjectIds = new Set([
      ...ashenStory.items.map((item) => item.id),
      ...ashenStory.locations.flatMap((location) => location.objects.map((object) => object.id)),
    ]);
    expect([...ASHEN_OBJECT_SPRITE_IDS].sort()).toEqual([...storyObjectIds].sort());

    const sprites = ASHEN_OBJECT_SPRITE_IDS.map((id) => getAshenObjectSprite(id, "village"));
    expect(sprites.every((sprite) => sprite !== null)).toBe(true);
    for (const sprite of sprites) {
      expect(sprite!.width).toBe(16);
      expect(sprite!.height).toBe(16);
      expect(commandsOf(sprite!).length).toBeGreaterThan(0);
    }
    expect(new Set(sprites.map((sprite) => JSON.stringify(commandsOf(sprite!)))).size)
      .toBe(ASHEN_OBJECT_SPRITE_IDS.length);
  });
});

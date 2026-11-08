import {
  BODY_SHAPES,
  CHARACTER_FEATURES,
  ICON_SHAPES,
  PALETTE_COLOR_SLOTS,
  PALETTE_NAMES,
  createSeededRandom,
} from "../art";
import type { CharacterRecipe, IconRecipe, PaletteColorSlot, PaletteName } from "../art";
import type { Biome } from "../world/types";

function pairs(text: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (text ?? "").split(/[;,]/)) {
    const [key, value] = part.split("=").map((piece) => piece.trim());
    if (key && value) result.set(key, value);
  }
  return result;
}

function pick<T extends string>(options: readonly T[], value: string | undefined): T | undefined {
  return options.find((option) => option === value);
}

// Pack recipes are "key=value; key=value" text. Anything else (prose) returns null.
export function parseCharacterRecipe(text: string | undefined): CharacterRecipe | null {
  const map = pairs(text);
  const body = pick(BODY_SHAPES, map.get("body"));
  if (!body) return null;
  const frames = Number(map.get("walkFrames"));
  return {
    body,
    bodyColor: pick(PALETTE_COLOR_SLOTS, map.get("bodyColor")) ?? "leaf",
    accentColor: pick(PALETTE_COLOR_SLOTS, map.get("accentColor")) ?? "accent",
    skinColor: pick(PALETTE_COLOR_SLOTS, map.get("skinColor")) ?? "skin",
    feature: pick(CHARACTER_FEATURES, map.get("feature")) ?? "none",
    walkFrames: frames === 3 || frames === 4 ? frames : 2,
  };
}

export function parseIconRecipe(text: string | undefined): IconRecipe | null {
  const map = pairs(text);
  const shape = pick(ICON_SHAPES, map.get("shape"));
  if (!shape) return null;
  return {
    shape,
    primaryColor: pick(PALETTE_COLOR_SLOTS, map.get("primaryColor")) ?? "accent",
    secondaryColor: pick(PALETTE_COLOR_SLOTS, map.get("secondaryColor")) ?? "cream",
  };
}

export function toCharacterRecipe(recipe: { body: string; bodyColor: string; accentColor: string; skinColor: string; feature: string }): CharacterRecipe {
  return parseCharacterRecipe(Object.entries(recipe).map(([key, value]) => `${key}=${value}`).join(";"))
    ?? seededCharacterRecipe("fallback");
}

export function toIconRecipe(recipe: { shape: string; primaryColor: string; secondaryColor: string }): IconRecipe {
  return parseIconRecipe(Object.entries(recipe).map(([key, value]) => `${key}=${value}`).join(";"))
    ?? seededIconRecipe("fallback");
}

// Deterministic recipes for entities whose recipe could not be taken from the pack or the model.
export function seededCharacterRecipe(seed: string): CharacterRecipe {
  const random = createSeededRandom(`character-recipe:${seed}`);
  const choose = <T>(options: readonly T[]): T => options[Math.floor(random() * options.length)]!;
  return {
    body: choose(BODY_SHAPES),
    bodyColor: choose<PaletteColorSlot>(["leaf", "earth", "water", "cream"]),
    accentColor: choose<PaletteColorSlot>(["accent", "highlight", "leafLight"]),
    skinColor: "skin",
    feature: choose(CHARACTER_FEATURES),
    walkFrames: 2,
  };
}

export function inferIconShape(name: string, description = ""): IconRecipe["shape"] | null {
  const text = `${name} ${description}`.toLowerCase().replace(/[_-]/g, " ");
  if (/\b(book|ledger|receipt|register|account|journal|notebook)\b/.test(text)) return "book";
  if (/\b(envelope|letter|mail|note)\b/.test(text)) return "envelope";
  if (/\b(spyglass|telescope|lens)\b/.test(text)) return "spyglass";
  if (/\b(shard|glass|crystal)\b/.test(text)) return "shard";
  if (/\b(bun|bread|loaf|pastry|cake)\b/.test(text)) return "bread";
  if (/\b(wick|thread|string|rope)\b/.test(text)) return "wick";
  if (/\b(lantern|lamp|light|torch)\b/.test(text)) return "lantern";
  if (/\b(key|keys)\b/.test(text)) return "key";
  if (/\b(scroll|map|chart|paper|document|proof)\b/.test(text)) return "scroll";
  if (/\b(shell|seashell)\b/.test(text)) return "shell";
  if (/\b(flower|blossom|petal)\b/.test(text)) return "flower";
  if (/\b(bottle|potion|flask|ink|medicine)\b/.test(text)) return "potion";
  if (/\b(token|coin|money|medallion)\b/.test(text)) return "coin";
  return null;
}

export function seededIconRecipe(seed: string, description = ""): IconRecipe {
  const random = createSeededRandom(`icon-recipe:${seed}`);
  const shape = inferIconShape(seed, description) ?? ICON_SHAPES[Math.floor(random() * ICON_SHAPES.length)]!;
  return {
    shape,
    primaryColor: "accent",
    secondaryColor: "cream",
  };
}

// Maps the pack's free-text biome ("village interior", "underwater hall") to a generator biome.
const BIOME_RULES: readonly [RegExp, Biome][] = [
  [/cave|cellar|wreck|underwater|cistern/, "cave"],
  [/interior|loft|attic|shed|workshop|room|lighthouse|tower|hall|library|house|bakery/, "building"],
  [/ruin|rooftop|stair/, "ruins"],
  [/square|street|village|market|lane/, "village"],
  [/garden|meadow|reed|field/, "meadow"],
  [/forest|wood|kelp|grove/, "forest"],
  [/harbou?r|shore|tidepool|islet|rock|fog|berth|quay|beach|coast|steps/, "shore"],
];

export function mapPackBiome(text: string): Biome | null {
  const lower = text.toLowerCase();
  return BIOME_RULES.find(([pattern]) => pattern.test(lower))?.[1] ?? null;
}

export function mapPackPalette(text: string): PaletteName | null {
  return PALETTE_NAMES.find((name) => name === text.trim().toLowerCase()) ?? null;
}

export function paletteForBiome(biome: Biome): PaletteName {
  return biome === "building" ? "village" : biome;
}

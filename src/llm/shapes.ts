import { BODY_SHAPES, CHARACTER_FEATURES, ICON_SHAPES, PALETTE_COLOR_SLOTS, PALETTE_NAMES } from "../art";
import type { CharacterRecipe, PaletteName } from "../art";
import type { Biome } from "../world/types";
import { defineSchema, s } from "./schema";

export const BIOMES = ["meadow", "forest", "shore", "cave", "building", "ruins", "village"] as const satisfies readonly Biome[];
export const OBJECT_KINDS = ["chest", "crate", "bookshelf", "sign", "statue", "well", "barrel", "plant", "table", "lantern"] as const;

// Sprite and icon recipes are menu picks the code can draw directly.
const spriteRecipe = s.object({
  body: s.string("round", { oneOf: BODY_SHAPES }),
  bodyColor: s.string("leaf", { oneOf: PALETTE_COLOR_SLOTS }),
  accentColor: s.string("accent", { oneOf: PALETTE_COLOR_SLOTS }),
  skinColor: s.string("skin", { oneOf: PALETTE_COLOR_SLOTS }),
  feature: s.string("none", { oneOf: CHARACTER_FEATURES }),
});

const iconRecipe = s.object({
  shape: s.string("gem", { oneOf: ICON_SHAPES }),
  primaryColor: s.string("accent", { oneOf: PALETTE_COLOR_SLOTS }),
  secondaryColor: s.string("cream", { oneOf: PALETTE_COLOR_SLOTS }),
});

export interface AreaBriefOutput {
  name: string;
  biome: Biome;
  mood: string;
  palette: PaletteName;
  description: string;
  characters: {
    name: string;
    species: string;
    sprite_recipe: Omit<CharacterRecipe, "walkFrames">;
    personality: string;
    goal: string;
    secret: string;
  }[];
  objects: {
    kind: string;
    name: string;
    description: string;
    icon_recipe: { shape: string; primaryColor: string; secondaryColor: string };
    contents: string[];
  }[];
  clue: { truth_id: string; where: string; text: string } | null;
  doors: { label: string; hint: string }[];
}

interface BriefLimits {
  characters: number;
  objects: number;
  doors: number;
}

function makeAreaBriefSchema(limits: BriefLimits) {
  return defineSchema<AreaBriefOutput>(
  s.object({
    name: s.string("Quiet Corner", { maxLength: 40 }),
    biome: s.string("meadow", { oneOf: BIOMES }),
    mood: s.string("calm", { maxLength: 40 }),
    palette: s.string("meadow", { oneOf: PALETTE_NAMES }),
    description: s.string("A quiet place where the air smells of rain.", { maxLength: 400 }),
    characters: s.array(
      s.object({
        name: s.string("Wanderer", { maxLength: 30 }),
        species: s.string("person", { maxLength: 30 }),
        sprite_recipe: spriteRecipe,
        personality: s.string("friendly", { maxLength: 80 }),
        goal: s.string("to enjoy a quiet day", { maxLength: 100 }),
        secret: s.string("none worth telling", { maxLength: 100 }),
      }),
      { maxItems: limits.characters },
    ),
    objects: s.array(
      s.object({
        kind: s.string("chest", { oneOf: OBJECT_KINDS }),
        name: s.string("Old Chest", { maxLength: 30 }),
        description: s.string("It looks like it has seen many seasons.", { maxLength: 160 }),
        icon_recipe: iconRecipe,
        contents: s.array(s.string("a small trinket", { maxLength: 40 }), { maxItems: 3 }),
      }),
      { maxItems: limits.objects },
    ),
    clue: s.nullable(
      s.object({
        truth_id: s.string("unknown", { maxLength: 40 }),
        where: s.string("nearby", { maxLength: 60 }),
        text: s.string("Something here seems out of place.", { maxLength: 200 }),
      }),
    ),
    doors: s.array(
      s.object({ label: s.string("Path onward", { maxLength: 30 }), hint: s.string("It leads somewhere new.", { maxLength: 80 }) }),
      { minItems: 1, maxItems: limits.doors, fallback: [{ label: "Path onward", hint: "It leads somewhere new." }] },
    ),
  }),
  );
}

export const areaBriefSchema = makeAreaBriefSchema({ characters: 3, objects: 4, doors: 4 });
// Story locations can have several required entities and up to 6 doors.
export const storyAreaBriefSchema = makeAreaBriefSchema({ characters: 6, objects: 8, doors: 6 });

export interface CharacterOutput {
  name: string;
  species: string;
  sprite_recipe: Omit<CharacterRecipe, "walkFrames">;
  personality: string;
  goal: string;
  secret: string;
}

export const characterSchema = defineSchema<CharacterOutput>(
  s.object({
    name: s.string("Wanderer", { maxLength: 30 }),
    species: s.string("person", { maxLength: 30 }),
    sprite_recipe: spriteRecipe,
    personality: s.string("friendly", { maxLength: 80 }),
    goal: s.string("to enjoy a quiet day", { maxLength: 100 }),
    secret: s.string("none worth telling", { maxLength: 100 }),
  }),
);

export interface DialogueTurnOutput {
  line: string;
  mode: "choices" | "free";
  choices: string[];
  effects: { give_item: string | null; reveal_clue: string | null; goal_progress: number | null };
}

// effects are proposals only; game code validates them against story state.
export const dialogueTurnSchema = defineSchema<DialogueTurnOutput>(
  s.object({
    line: s.string("Hmm. Let me think about that for a moment.", { maxLength: 300 }),
    mode: s.string("free", { oneOf: ["choices", "free"] }),
    choices: s.array(s.string("Tell me more.", { maxLength: 60 }), { maxItems: 4 }),
    effects: s.object({
      give_item: s.nullable(s.string("", { maxLength: 40 })),
      reveal_clue: s.nullable(s.string("", { maxLength: 40 })),
      goal_progress: s.nullable(s.number(0, { min: 0, max: 1 })),
    }),
  }),
);

export interface ItemOutput {
  name: string;
  description: string;
  icon_recipe: { shape: string; primaryColor: string; secondaryColor: string };
  story_use: string;
}

export const itemSchema = defineSchema<ItemOutput>(
  s.object({
    name: s.string("Curious Trinket", { maxLength: 30 }),
    description: s.string("A small thing with a story of its own.", { maxLength: 160 }),
    icon_recipe: iconRecipe,
    story_use: s.string("decoration", { maxLength: 80 }),
  }),
);

export interface EndingSceneOutput {
  scene: string;
  epilogue: string;
}

export const endingSceneSchema = defineSchema<EndingSceneOutput>(
  s.object({
    scene: s.string("The village gathers beneath the lanterns and welcomes the morning together.", { maxLength: 600 }),
    epilogue: s.string("The lanterns glow warmly as the village settles into a gentler season.", { maxLength: 240 }),
  }),
);

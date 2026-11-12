import { BODY_SHAPES, CHARACTER_FEATURES, PALETTE_COLOR_SLOTS } from "../art";
import type { CharacterRecipe } from "../art";
import { defineSchema, s } from "./schema";

// Sprite recipes are menu picks the code can draw directly.
const spriteRecipe = s.object({
  body: s.string("round", { oneOf: BODY_SHAPES }),
  bodyColor: s.string("leaf", { oneOf: PALETTE_COLOR_SLOTS }),
  accentColor: s.string("accent", { oneOf: PALETTE_COLOR_SLOTS }),
  skinColor: s.string("skin", { oneOf: PALETTE_COLOR_SLOTS }),
  feature: s.string("none", { oneOf: CHARACTER_FEATURES }),
});

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
    line: s.string("", { maxLength: 300 }),
    mode: s.string("free", { oneOf: ["choices", "free"] }),
    choices: s.array(s.string("Tell me more.", { maxLength: 60 }), { maxItems: 4 }),
    effects: s.object({
      give_item: s.nullable(s.string("", { maxLength: 40 })),
      reveal_clue: s.nullable(s.string("", { maxLength: 40 })),
      goal_progress: s.nullable(s.number(0, { min: 0, max: 1 })),
    }),
  }),
);

// The dialogue controller only needs the spoken line; code decides everything else.
export interface CharacterLineOutput {
  line: string;
}

export const characterLineSchema = defineSchema<CharacterLineOutput>(
  s.object({ line: s.string("", { maxLength: 300 }) }),
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

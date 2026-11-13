import type { LengthId } from "./types";

export interface Range {
  min: number;
  max?: number; // going over max is only a warning
}

export interface Complexity {
  locations: Range;
  cast: Range;
  coreTruths: Range;
  redHerrings: Range;
  twists: Range;
  subplots: Range;
  endings: Range;
  routesPerCoreTruth: number;
}

// Minimum complexity per length (plan section 6.1). Tune the numbers here only.
export const COMPLEXITY: Record<LengthId, Complexity> = {
  short: {
    locations: { min: 5, max: 6 },
    cast: { min: 4, max: 5 },
    coreTruths: { min: 4 },
    redHerrings: { min: 1 },
    twists: { min: 1 },
    subplots: { min: 0 },
    endings: { min: 1 },
    routesPerCoreTruth: 2,
  },
  medium: {
    locations: { min: 12, max: 15 },
    cast: { min: 8, max: 10 },
    coreTruths: { min: 7 },
    redHerrings: { min: 2, max: 3 },
    twists: { min: 1, max: 2 },
    subplots: { min: 1, max: 2 },
    endings: { min: 2 },
    routesPerCoreTruth: 2,
  },
  long: {
    locations: { min: 25 },
    cast: { min: 12, max: 15 },
    coreTruths: { min: 10, max: 12 },
    redHerrings: { min: 4 },
    twists: { min: 2, max: 3 },
    subplots: { min: 3 },
    endings: { min: 3 },
    routesPerCoreTruth: 2, // the plan allows 2 or 3; 2 is the enforced minimum
  },
};

// Maximum characters per text field, by field name. Keeps LLM prompts small.
export const TEXT_LIMITS: Record<string, number> = {
  title: 80,
  name: 60,
  logline: 240,
  species: 40,
  biome: 40,
  mood: 80,
  palette: 80,
  tone: 120,
  icon_recipe: 200,
  relation: 120,
  label: 30, // area door signs
  hint: 100,
  // Lock, gate and unlock texts shown to the player (src/story/locks.ts).
  reason: 160,
  lead: 200,
  unlock_text: 200,
  locked_glimpse: 200,
  reveal_text: 200,
  gate_reason: 200,
};
export const DEFAULT_TEXT_LIMIT = 400;

// Authored dialogue content per core cast member. The count limits also live in the JSON Schema
// (so Story Forge sees them); the character limits and word counts are enforced by the validator.
export const DIALOGUE_LIMITS = {
  topicWords: 3,
  lineChars: 200, // greetings, hints and deflections
};

// How the case record turns into a result at the ending (src/story/caseRecord.ts). The share of mistakes is
// (wrong or misread answers + weighted unproven answers + weighted failed challenges) /
// (final answers + weighted challenges).
export const CASE_RESULT = {
  // Any mistake below this share is a solve with mistakes; at or above it the case is flawed.
  flawedShare: 0.4,
  // A failed challenge weighs less than a wrong deduction: it costs a conversation, not the answer.
  challengeWeight: 0.5,
  // A right answer that was not proven weighs less than a wrong one: the player knew, but did not show why.
  unprovenWeight: 0.5,
};

// How many pieces of evidence the player can show with one answer.
export const PROOF_SLOTS = 3;

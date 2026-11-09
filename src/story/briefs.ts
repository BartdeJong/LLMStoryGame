import type { CharacterRecipe, IconRecipe, PaletteName } from "../art";
import type { LLMClient } from "../llm/client";
import type { AreaBriefOutput } from "../llm/shapes";
import { Priority } from "../llm/types";
import type { Biome } from "../world/types";
import { resolveVisualSpec } from "../art/glyphs";
import type { VisualSpec } from "../art/glyphs";
import { buildBriefRequest } from "./briefPrompt";
import { inferIconShape, mapPackBiome, mapPackPalette, paletteForBiome, parseCharacterRecipe, parseIconRecipe, seededCharacterRecipe, seededIconRecipe, toCharacterRecipe, toIconRecipe } from "./recipes";
import type { LocationSlice } from "./slice";
import type { StoryPack } from "./types";

export const MAX_BRIEF_ATTEMPTS = 2;
const MAX_EXTRA_CHARACTERS = 1;
const MAX_EXTRA_OBJECTS = 2;

export interface BriefCharacter {
  castId: string | null; // null for minor extras
  name: string;
  species: string;
  personality: string;
  goal: string;
  secret: string;
  recipe: CharacterRecipe;
  required: boolean;
}

export interface BriefObject {
  packId: string | null;
  kind: string;
  name: string;
  description: string;
  icon: IconRecipe;
  visual: VisualSpec;
  visualInferred: boolean;
  contents: string[];
  required: boolean;
  keyItem: boolean;
}

export interface BriefClue {
  id: string;
  truthId: string | null;
  where: string;
  text: string;
}

export interface BriefDoor {
  to: string;
  label: string;
  hint: string;
}

// Pack facts are copied by code; the model only supplies wording, recipes and minor extras.
export interface StoryAreaBrief {
  locationId: string;
  name: string;
  biome: Biome;
  mood: string;
  palette: PaletteName;
  description: string;
  characters: BriefCharacter[];
  objects: BriefObject[];
  clues: BriefClue[];
  doors: BriefDoor[];
  source: "llm" | "fallback";
}

// Pack-wide lookups used by code (name checks, art recipes). Never put into a prompt.
export interface BriefGuard {
  spriteRecipes: Record<string, string>;
  iconRecipes: Record<string, string>;
  castNames: string[];
  itemNames: string[];
  locationNames: string[];
}

export function buildGuard(pack: StoryPack): BriefGuard {
  return {
    spriteRecipes: Object.fromEntries(pack.cast.map((member) => [member.id, member.sprite_recipe])),
    iconRecipes: Object.fromEntries(pack.items.map((item) => [item.id, item.icon_recipe])),
    castNames: pack.cast.map((member) => member.name),
    itemNames: pack.items.map((item) => item.name),
    locationNames: pack.locations.map((location) => location.name),
  };
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const mentions = (text: string, name: string): boolean => name.length > 2 && text.toLowerCase().includes(name.toLowerCase());

// Returns the ways the output contradicts the pack. An empty list means it is safe to merge.
export function findViolations(output: AreaBriefOutput, slice: LocationSlice, guard: BriefGuard): string[] {
  const violations: string[] = [];
  const requiredNames = slice.characters.map((character) => character.name);

  for (const required of slice.characters) {
    const match = output.characters.find((character) => same(character.name, required.name));
    if (match && !same(match.species, required.species)) {
      violations.push(`${required.name} is a ${required.species}, not a ${match.species}`);
    }
  }
  for (const character of output.characters) {
    const isRequired = requiredNames.some((name) => same(name, character.name));
    if (!isRequired && guard.castNames.some((name) => same(name, character.name))) {
      violations.push(`extra character "${character.name}" uses a story character's name`);
    }
  }

  const requiredObjectNames = slice.objects.map((object) => object.name);
  for (const object of output.objects) {
    const isRequired = requiredObjectNames.some((name) => same(name, object.name));
    if (isRequired) continue;
    if (guard.itemNames.some((name) => same(name, object.name))) {
      violations.push(`extra object "${object.name}" duplicates a story item`);
    }
    for (const content of object.contents) {
      if (guard.itemNames.some((name) => mentions(content, name))) violations.push(`extra object "${object.name}" holds a story item`);
    }
  }

  if (output.clue) {
    const allowed = slice.clues.map((clue) => clue.truth_id ?? "none");
    if (!allowed.includes(output.clue.truth_id)) {
      violations.push(`clue points at "${output.clue.truth_id}", which this location does not hint at`);
    }
  }
  return violations;
}

function fallbackLabel(toName: string): string {
  return `To ${toName}`;
}

// A label that names a different place than the door's destination would mislead the player.
function doorLabel(candidate: string | undefined, toName: string, guard: BriefGuard): string {
  if (!candidate) return fallbackLabel(toName);
  const misleading = guard.locationNames.some((name) => !same(name, toName) && mentions(candidate, name));
  return misleading ? fallbackLabel(toName) : candidate;
}

function resolveBiome(slice: LocationSlice, output: AreaBriefOutput | null): Biome {
  return mapPackBiome(slice.biome) ?? output?.biome ?? "meadow";
}

// Builds the final brief. `output` is null for the plain fallback.
export function mergeBrief(slice: LocationSlice, output: AreaBriefOutput | null, guard: BriefGuard): StoryAreaBrief {
  const biome = resolveBiome(slice, output);
  const palette = mapPackPalette(slice.palette) ?? output?.palette ?? paletteForBiome(biome);

  const characters: BriefCharacter[] = slice.characters.map((required) => {
    const match = output?.characters.find((character) => same(character.name, required.name));
    return {
      castId: required.id,
      name: required.name,
      species: required.species,
      personality: required.personality,
      goal: required.goal,
      secret: required.secret,
      recipe: parseCharacterRecipe(guard.spriteRecipes[required.id])
        ?? (match ? toCharacterRecipe(match.sprite_recipe) : seededCharacterRecipe(required.id)),
      required: true,
    };
  });
  const requiredNames = slice.characters.map((character) => character.name);
  const extraCharacters = (output?.characters ?? [])
    .filter((character) => !requiredNames.some((name) => same(name, character.name)))
    .slice(0, MAX_EXTRA_CHARACTERS)
    .map((character): BriefCharacter => ({
      castId: null,
      name: character.name,
      species: character.species,
      personality: character.personality,
      goal: character.goal,
      secret: character.secret,
      recipe: toCharacterRecipe(character.sprite_recipe),
      required: false,
    }));

  const objects: BriefObject[] = slice.objects.map((required) => {
    const match = output?.objects.find((object) => same(object.name, required.name));
    const packIcon = parseIconRecipe(guard.iconRecipes[required.id]);
    const icon = packIcon ?? (match ? toIconRecipe(match.icon_recipe) : seededIconRecipe(required.id, `${required.name} ${required.description}`));
    const semanticShape = inferIconShape(required.name, required.description);
    return {
      packId: required.id,
      kind: match?.kind ?? "crate",
      name: required.name,
      description: required.kind === "key_item" ? required.description : match?.description ?? required.description,
      icon: semanticShape ? { ...icon, shape: semanticShape } : icon,
      visual: required.visual ?? resolveVisualSpec(required.name, required.description),
      visualInferred: required.visualInferred ?? !required.visual,
      contents: [],
      required: true,
      keyItem: required.kind === "key_item",
    };
  });
  const requiredObjectNames = slice.objects.map((object) => object.name);
  const extraObjects = (output?.objects ?? [])
    .filter((object) => !requiredObjectNames.some((name) => same(name, object.name)))
    .slice(0, MAX_EXTRA_OBJECTS)
    .map((object): BriefObject => ({
      packId: null,
      kind: object.kind,
      name: object.name,
      description: object.description,
      icon: toIconRecipe(object.icon_recipe),
      visual: resolveVisualSpec(object.name, object.description),
      visualInferred: true,
      contents: [],
      required: false,
      keyItem: false,
    }));

  const clues: BriefClue[] = slice.clues.map((clue, index) => ({
    id: clue.id,
    truthId: clue.truth_id,
    where: index === 0 && output?.clue?.where ? output.clue.where : "nearby",
    text: clue.text,
  }));

  const doors: BriefDoor[] = slice.doors.map((door, index) => ({
    to: door.to,
    label: doorLabel(output?.doors[index]?.label, door.to_name, guard),
    hint: output?.doors[index]?.hint ?? "",
  }));

  return {
    locationId: slice.location_id,
    name: slice.name,
    biome,
    mood: slice.mood || output?.mood || "quiet",
    palette,
    description: output?.description ?? `${slice.name}. The air feels ${slice.mood || "quiet"}.`,
    characters: [...characters, ...extraCharacters],
    objects: [...objects, ...extraObjects],
    clues,
    doors,
    source: output ? "llm" : "fallback",
  };
}

export function fallbackBrief(slice: LocationSlice, guard: BriefGuard): StoryAreaBrief {
  return mergeBrief(slice, null, guard);
}

export type BriefOutcome = { status: "ready"; brief: StoryAreaBrief } | { status: "cancelled" };

// Never throws. A failed or contradicting generation degrades to the plain fallback; pack facts always survive.
export async function generateAreaBrief(
  client: LLMClient,
  slice: LocationSlice,
  guard: BriefGuard,
  options: { priority?: Priority; signal?: AbortSignal; requestId?: string } = {},
): Promise<BriefOutcome> {
  let softAccept: AreaBriefOutput | null = null;
  try {
    for (let attempt = 0; attempt < MAX_BRIEF_ATTEMPTS; attempt += 1) {
      const result = await client.generateJSON({
        ...buildBriefRequest(slice, options.priority ?? Priority.Area, options.signal),
        id: options.requestId ? (attempt === 0 ? options.requestId : `${options.requestId}:r${attempt}`) : undefined,
      });
      if (result.status === "cancelled") return { status: "cancelled" };
      if (result.status === "failed") break;
      if (findViolations(result.value, slice, guard).length > 0) continue;
      if (result.status === "ok") return { status: "ready", brief: mergeBrief(slice, result.value, guard) };
      // Some fields were defaulted; usable if nothing better arrives, unless the whole reply was unusable.
      if (!result.issues.some((issue) => issue.startsWith("$:"))) softAccept ??= result.value;
    }
  } catch {
    // fall through to the fallback
  }
  return { status: "ready", brief: mergeBrief(slice, softAccept, guard) };
}

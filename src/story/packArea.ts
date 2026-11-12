import { resolveVisualSpec } from "../art/glyphs";
import type { CharacterRecipe, IconRecipe, PaletteName, SpriteSpec } from "../art";
import type { VisualSpec } from "../art/glyphs";
import { isWalkable } from "../world/connectivity";
import { parseAreaMap } from "../world/mapLegend";
import type { Area, AreaDoor, AreaEntity, Biome, DoorKind, EntitySpawnPoint, GridPoint } from "../world/types";
import { Tile } from "../world/types";
import type { LengthView } from "./loader";
import { inferIconShape, parseIconRecipe, recipeFromSprite, seededIconRecipe } from "./recipes";
import { buildLocationSlice } from "./slice";
import type { StoryPack } from "./types";

export interface BriefCharacter {
  castId: string;
  name: string;
  species: string;
  personality: string;
  goal: string;
  secret: string;
  recipe: CharacterRecipe; // coarse body shape, used for the voice
  sprite: SpriteSpec;
  required: boolean;
}

export interface BriefObject {
  packId: string;
  name: string;
  description: string;
  icon: IconRecipe;
  visual: VisualSpec;
  visualInferred: boolean;
  required: boolean;
  keyItem: boolean;
}

export interface BriefClue {
  id: string;
  truthId: string | null;
  text: string;
}

export interface BriefDoor {
  to: string;
  label: string;
  hint: string;
}

// What the game knows about a place while it is played: text for dialogue context and the story things placed there.
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
}

export interface PackArea {
  area: Area;
  brief: StoryAreaBrief;
}

export function doorKindForBiome(biome: Biome): DoorKind {
  return biome === "cave"
    ? "cave-mouth"
    : biome === "village"
      ? "gate"
      : biome === "building" || biome === "ruins"
        ? "hatch"
        : "edge";
}

// The walkable tile beside a door where a player arriving through it stands.
export function doorSpawn(area: Area, door: AreaDoor): GridPoint {
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
    const point = { x: door.x + dx, y: door.y + dy };
    if (isWalkable(area, point.x, point.y)) return point;
  }
  throw new Error(`Door "${door.id}" in area "${area.id}" has no walkable entry tile.`);
}

// Builds a walkable area from the map baked into the pack. Nothing is generated: the same inputs always give the same area.
// Only the things that belong to this location in this story length are placed, and doors to places outside the length
// are drawn as wall.
export function buildPackArea(pack: StoryPack, view: LengthView, locationId: string): PackArea {
  const location = pack.locations.find((candidate) => candidate.id === locationId);
  if (!location) throw new Error(`Story "${pack.identity.id}" has no location "${locationId}".`);
  const authored = location.area;
  if (!authored) throw new Error(`Location "${locationId}" has no baked area.`);
  const slice = buildLocationSlice(pack, view, locationId);
  const inLength = new Set(view.locations.map((candidate) => candidate.id));
  const parsed = parseAreaMap(authored.map);
  const doorKind = doorKindForBiome(authored.biome);

  const doors: AreaDoor[] = [];
  const briefDoors: BriefDoor[] = [];
  for (const [number, point] of [...parsed.doorSlots].sort((a, b) => a[0] - b[0])) {
    const text = authored.doors[number - 1];
    if (!text || !inLength.has(text.to)) {
      parsed.layers.feature[point.y]![point.x] = Tile.Wall;
      continue;
    }
    doors.push({ id: `door-${number}`, label: text.label, kind: doorKind, ...point, targetAreaId: text.to });
    briefDoors.push({ to: text.to, label: text.label, hint: text.hint });
  }

  const characters: BriefCharacter[] = slice.characters.map((member) => {
    const sprite = pack.cast.find((candidate) => candidate.id === member.id)?.sprite;
    if (!sprite) throw new Error(`Cast member "${member.id}" has no sprite.`);
    return {
      castId: member.id,
      name: member.name,
      species: member.species,
      personality: member.personality,
      goal: member.goal,
      secret: member.secret,
      recipe: recipeFromSprite(sprite, member.id),
      sprite,
      required: true,
    };
  });
  const objects: BriefObject[] = slice.objects.map((object) => {
    const packIcon = parseIconRecipe(pack.items.find((item) => item.id === object.id)?.icon_recipe);
    const icon = packIcon ?? seededIconRecipe(object.id, `${object.name} ${object.description}`);
    const semanticShape = inferIconShape(object.name, object.description);
    return {
      packId: object.id,
      name: object.name,
      description: object.description,
      icon: semanticShape ? { ...icon, shape: semanticShape } : icon,
      visual: object.visual ?? resolveVisualSpec(object.name, object.description),
      visualInferred: object.visualInferred ?? !object.visual,
      required: true,
      keyItem: object.kind === "key_item",
    };
  });
  const clues: BriefClue[] = slice.clues.map((clue) => ({ id: clue.id, truthId: clue.truth_id, text: clue.text }));

  // A placement is keyed by entity id ("obj:o_bin") or, when that is unambiguous, by the plain pack id.
  const at = (entityId: string, packId: string): GridPoint => {
    const point = authored.placements[entityId] ?? authored.placements[packId];
    if (!point) throw new Error(`Location "${locationId}" has no placement for "${packId}".`);
    return { x: point[0], y: point[1] };
  };
  const entities: AreaEntity[] = [];
  for (const character of characters) {
    const id = `char:${character.castId}`;
    entities.push({
      ...at(id, character.castId), id, kind: "character", required: character.required, packId: character.castId,
      name: character.name, description: character.personality, character: character.recipe, sprite: character.sprite,
    });
  }
  for (const object of objects) {
    const id = `${object.keyItem ? "item" : "obj"}:${object.packId}`;
    entities.push({
      ...at(id, object.packId), id, kind: object.keyItem ? "key" : "object", required: object.required, packId: object.packId,
      name: object.name, description: object.description, icon: object.icon,
      visual: object.visual, visualInferred: object.visualInferred,
    });
  }
  for (const clue of clues) {
    const id = `clue:${clue.id}`;
    entities.push({
      ...at(id, clue.id), id, kind: "clue", required: true, packId: clue.id, truthId: clue.truthId ?? undefined,
      name: "Something to examine", description: clue.text,
      icon: { shape: "gem", primaryColor: "highlight", secondaryColor: "cream" },
    });
  }
  const spawnPoints: EntitySpawnPoint[] = entities.map(({ id, kind, x, y }) => ({ id, kind, x, y }));

  const base: Area = {
    id: locationId,
    seed: locationId,
    name: location.name,
    biome: authored.biome,
    mood: location.mood || "quiet",
    palette: authored.palette,
    width: parsed.width,
    height: parsed.height,
    layers: parsed.layers,
    entry: parsed.start ?? { x: 0, y: 0 },
    spawnPoints,
    doors,
    entities,
    style: { floor: authored.floor, wall: authored.wall },
    decor: authored.decor.map(({ icon, x, y }) => ({ icon, x, y })),
  };
  const first = doors[0];
  const entry = parsed.start ?? (first ? doorSpawn(base, first) : undefined);
  if (!entry) throw new Error(`Location "${locationId}" has no "@" start tile and no usable door.`);
  const area: Area = { ...base, entry };
  const brief: StoryAreaBrief = {
    locationId,
    name: location.name,
    biome: authored.biome,
    mood: area.mood,
    palette: authored.palette,
    description: authored.description,
    characters,
    objects,
    clues,
    doors: briefDoors,
  };
  return { area, brief };
}

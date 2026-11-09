import type { CharacterRecipe, IconRecipe, PaletteName } from "../art";
import type { VisualSpec } from "../art/glyphs";

export type Biome = "meadow" | "forest" | "shore" | "cave" | "building" | "ruins" | "village";

export interface AreaBrief {
  readonly name: string;
  readonly biome: Biome;
  readonly mood: string;
  readonly palette: PaletteName;
  readonly doorLabels: readonly string[];
}

export enum Tile {
  Grass,
  Path,
  Water,
  Tree,
  Wall,
  Rock,
  Floor,
  Door,
  Flowers,
  Bridge,
}

export interface TileLayers {
  readonly ground: Tile[][];
  readonly feature: Tile[][];
}

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export type SpawnKind = "character" | "object" | "clue" | "key";

export interface EntitySpawnPoint extends GridPoint {
  readonly id: string;
  readonly kind: SpawnKind;
}

// A story-driven thing placed in an area. Pack facts are copied by code; `required` marks them as non-optional.
export interface AreaEntity extends EntitySpawnPoint {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
  readonly packId?: string; // cast, item, object or clue id from the story pack
  readonly truthId?: string;
  readonly character?: CharacterRecipe;
  readonly icon?: IconRecipe;
  readonly visual?: VisualSpec;
  readonly visualInferred?: boolean;
  readonly opened?: boolean;
}

export type DoorKind = "edge" | "cave-mouth" | "gate" | "hatch";

export interface AreaDoor extends GridPoint {
  readonly id: string;
  readonly label: string;
  readonly kind: DoorKind;
  readonly targetAreaId?: string;
}

export interface Area {
  readonly id: string;
  readonly seed: number | string;
  readonly name: string;
  readonly biome: Biome;
  readonly mood: string;
  readonly palette: PaletteName;
  readonly width: number;
  readonly height: number;
  readonly layers: TileLayers;
  readonly entry: GridPoint;
  readonly spawnPoints: readonly EntitySpawnPoint[];
  readonly doors: readonly AreaDoor[];
  readonly entities?: readonly AreaEntity[];
}

export type World = Area;

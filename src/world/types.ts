import type { PaletteName } from "../art/palettes";

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
}

export type World = Area;

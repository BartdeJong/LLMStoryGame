import type { CharacterRecipe, IconRecipe, PaletteName } from "../art";
import type { VisualSpec } from "../art/glyphs";
import type { SpriteSpec } from "../art/spriteSpec";

export type Biome = "meadow" | "forest" | "shore" | "cave" | "building" | "ruins" | "village";

export interface AreaBrief {
  readonly name: string;
  readonly biome: Biome;
  readonly mood: string;
  readonly palette: PaletteName;
  readonly doorLabels: readonly string[];
  // Where each door goes, in the order of `doorLabels`. Without it the doors take the default spots in turn.
  readonly doorPoints?: readonly GridPoint[];
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
  // Appended, so older numeric values stay valid.
  Void, // outside the area: not walkable, drawn as background
  Rug, // walkable floor covering
  Counter, // solid furniture block: counter, table, shelf run
}

// How an area's plain floor ('.') and walls ('#') are drawn. Pre-baked per location in the story pack.
export const FLOOR_STYLES = ["boards", "tiles", "carpet", "flagstone", "cobble", "dirt", "grass", "sand", "deck"] as const;
export type FloorStyle = (typeof FLOOR_STYLES)[number];
export const WALL_STYLES = ["plaster", "brick", "wood", "stone", "hedge", "rock", "fence"] as const;
export type WallStyle = (typeof WALL_STYLES)[number];

export interface AreaStyle {
  readonly floor: FloorStyle;
  readonly wall: WallStyle;
}

// A small solid decoration drawn with a catalog glyph (src/art/glyphs), e.g. a plant or lamp. Not interactive.
export interface AreaDecor extends GridPoint {
  readonly icon: string;
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
  readonly sprite?: SpriteSpec; // layered look of a character; drawn instead of `character` when present
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
  readonly style?: AreaStyle;
  readonly decor?: readonly AreaDecor[];
}

export type World = Area;

export { PLACEHOLDER_BRIEFS, getPlaceholderBrief } from "./briefs";
export {
  AREA_HEIGHT,
  AREA_WIDTH,
  allPointsReachable,
  isWalkable,
  reachableTiles,
} from "./connectivity";
export {
  generateArea,
  generateBuilding,
  generateCave,
  generateOutdoors,
  generateRuins,
  generateVillage,
} from "./generators";
export {
  entitySolidityIsSafe,
  isEntityInNarrowCorridor,
  reachableTilesWithSolidEntities,
  selectSolidEntityIds,
} from "./solidity";
export { WorldSession } from "./session";
export type { AreaTransition } from "./session";
export { Tile } from "./types";
export type {
  Area,
  AreaBrief,
  AreaDoor,
  AreaEntity,
  Biome,
  DoorKind,
  EntitySpawnPoint,
  GridPoint,
  SpawnKind,
  TileLayers,
  World,
} from "./types";

import { Tile } from "./types";
import type { Area } from "./types";

export const TILE_SIZE = 16;

export function isSolidAt(area: Area, pixelX: number, pixelY: number): boolean {
  const column = Math.floor(pixelX / TILE_SIZE);
  const row = Math.floor(pixelY / TILE_SIZE);
  if (column < 0 || column >= area.width || row < 0 || row >= area.height) return true;
  const ground = area.layers.ground[row]?.[column];
  const feature = area.layers.feature[row]?.[column];
  return ground === Tile.Water
    || feature === Tile.Tree
    || feature === Tile.Wall
    || feature === Tile.Rock;
}

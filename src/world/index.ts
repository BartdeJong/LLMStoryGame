export {
  AREA_HEIGHT,
  AREA_WIDTH,
  allPointsReachable,
  isWalkable,
  reachableTiles,
} from "./connectivity";
export { findPath, tilesWithinRange } from "./pathfinding";
export type { PathQuery } from "./pathfinding";
export {
  entitySolidityIsSafe,
  isEntityInNarrowCorridor,
  reachableTilesWithSolidEntities,
  selectSolidEntityIds,
} from "./solidity";
export { FLOOR_STYLES, Tile, WALL_STYLES } from "./types";
export type {
  Area,
  AreaBrief,
  AreaDecor,
  AreaDoor,
  AreaEntity,
  Biome,
  DoorKind,
  AreaStyle,
  EntitySpawnPoint,
  FloorStyle,
  GridPoint,
  SpawnKind,
  TileLayers,
  WallStyle,
  World,
} from "./types";

import { isWalkable } from "./connectivity";
import type { Area } from "./types";

export const TILE_SIZE = 16;

export function isSolidAt(area: Area, pixelX: number, pixelY: number): boolean {
  const column = Math.floor(pixelX / TILE_SIZE);
  const row = Math.floor(pixelY / TILE_SIZE);
  if (column < 0 || column >= area.width || row < 0 || row >= area.height) return true;
  return !isWalkable(area, column, row);
}

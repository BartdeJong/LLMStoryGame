import { isWalkable } from "./connectivity";
import { Tile } from "./types";
import type { Area, AreaEntity, GridPoint } from "./types";

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

const pointKey = (x: number, y: number): string => `${x},${y}`;

function entityPoint(entity: AreaEntity, overrides?: ReadonlyMap<string, GridPoint>): GridPoint {
  const override = overrides?.get(entity.id);
  return override ?? { x: Math.floor(entity.x), y: Math.floor(entity.y) };
}

function reachableWithoutEntities(area: Area, blocked: ReadonlySet<string>): Set<string> {
  if (!isWalkable(area, area.entry.x, area.entry.y) || blocked.has(pointKey(area.entry.x, area.entry.y))) {
    return new Set();
  }
  const visited = new Set([pointKey(area.entry.x, area.entry.y)]);
  const pending = [area.entry];
  for (let index = 0; index < pending.length; index += 1) {
    const point = pending[index]!;
    for (const [dx, dy] of DIRECTIONS) {
      const x = point.x + dx;
      const y = point.y + dy;
      const key = pointKey(x, y);
      if (!visited.has(key) && !blocked.has(key) && isWalkable(area, x, y)) {
        visited.add(key);
        pending.push({ x, y });
      }
    }
  }
  return visited;
}

function entityIsSolidCandidate(entity: AreaEntity): boolean {
  return entity.kind !== "clue";
}

export function entitySolidityIsSafe(
  area: Area,
  solidEntityIds: ReadonlySet<string>,
  positions?: ReadonlyMap<string, GridPoint>,
): boolean {
  const blocked = new Set<string>();
  for (const entity of area.entities ?? []) {
    if (solidEntityIds.has(entity.id)) {
      const point = entityPoint(entity, positions);
      blocked.add(pointKey(point.x, point.y));
    }
  }
  const reachable = reachableWithoutEntities(area, blocked);
  if (!area.doors.every((door) => reachable.has(pointKey(door.x, door.y)))) return false;

  return (area.entities ?? []).every((entity) => {
    const point = entityPoint(entity, positions);
    if (point.x === area.entry.x && point.y === area.entry.y) return false;
    return DIRECTIONS.some(([dx, dy]) => reachable.has(pointKey(point.x + dx, point.y + dy)));
  });
}

export function selectSolidEntityIds(
  area: Area,
  protectedPoints: readonly GridPoint[] = [],
): Set<string> {
  const entities = area.entities ?? [];
  const protectedTiles = new Set(protectedPoints.map(({ x, y }) => pointKey(x, y)));
  protectedTiles.add(pointKey(area.entry.x, area.entry.y));
  for (const door of area.doors) {
    for (const [dx, dy] of [[0, 0], ...DIRECTIONS] as const) {
      protectedTiles.add(pointKey(door.x + dx, door.y + dy));
    }
  }

  const solidIds = new Set<string>();
  const solidTiles = new Set<string>();
  const orderedCandidates = entities.filter(entityIsSolidCandidate);

  for (const entity of orderedCandidates) {
    const x = Math.floor(entity.x);
    const y = Math.floor(entity.y);
    const key = pointKey(x, y);
    if (protectedTiles.has(key) || !isWalkable(area, x, y)) continue;
    const walkableNeighbors = DIRECTIONS.filter(([dx, dy]) => isWalkable(area, x + dx, y + dy)).length;
    if (walkableNeighbors <= 2) continue;

    solidIds.add(entity.id);
    solidTiles.add(key);
    if (!entitySolidityIsSafe(area, solidIds)) {
      solidIds.delete(entity.id);
      solidTiles.delete(key);
      if (entities.some((other) => other.id !== entity.id && pointKey(Math.floor(other.x), Math.floor(other.y)) === key
        && solidIds.has(other.id))) {
        solidTiles.add(key);
      }
    }
  }

  return solidIds;
}

export function reachableTilesWithSolidEntities(
  area: Area,
  solidEntityIds: ReadonlySet<string>,
  positions?: ReadonlyMap<string, GridPoint>,
): Set<string> {
  const blocked = new Set<string>();
  for (const entity of area.entities ?? []) {
    if (solidEntityIds.has(entity.id)) {
      const point = entityPoint(entity, positions);
      blocked.add(pointKey(point.x, point.y));
    }
  }
  return reachableWithoutEntities(area, blocked);
}

export function isEntityInNarrowCorridor(area: Area, x: number, y: number): boolean {
  return DIRECTIONS.filter(([dx, dy]) => isWalkable(area, x + dx, y + dy)).length <= 2
    || area.layers.feature[y]?.[x] === Tile.Door;
}

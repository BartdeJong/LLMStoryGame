import { Tile } from "./types";
import type { Area, GridPoint } from "./types";


export function isWalkable(area: Area, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= area.width || y >= area.height) return false;
  const ground = area.layers.ground[y]?.[x];
  const feature = area.layers.feature[y]?.[x];
  return ground !== Tile.Water
    && ground !== Tile.Void
    && feature !== Tile.Tree
    && feature !== Tile.Wall
    && feature !== Tile.Rock
    && feature !== Tile.Counter
    && !(area.decor?.some((item) => item.x === x && item.y === y) ?? false);
}

export function reachableTiles(area: Area, origin: GridPoint = area.entry): Set<string> {
  if (!isWalkable(area, origin.x, origin.y)) return new Set();
  const visited = new Set<string>([`${origin.x},${origin.y}`]);
  const pending: GridPoint[] = [origin];
  for (let index = 0; index < pending.length; index += 1) {
    const point = pending[index]!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = point.x + dx;
      const y = point.y + dy;
      const key = `${x},${y}`;
      if (!visited.has(key) && isWalkable(area, x, y)) {
        visited.add(key);
        pending.push({ x, y });
      }
    }
  }
  return visited;
}

export function allPointsReachable(area: Area): boolean {
  const reachable = reachableTiles(area);
  return [...area.doors, ...area.spawnPoints].every((point) => reachable.has(`${point.x},${point.y}`));
}


import { Tile } from "./types";
import type { Area, GridPoint } from "./types";

export const AREA_WIDTH = 40;
export const AREA_HEIGHT = 24;

export function createLayers(groundTile: Tile): { ground: Tile[][]; feature: Tile[][] } {
  return {
    ground: Array.from({ length: AREA_HEIGHT }, () => Array<Tile>(AREA_WIDTH).fill(groundTile)),
    feature: Array.from({ length: AREA_HEIGHT }, () => Array<Tile>(AREA_WIDTH).fill(Tile.Grass)),
  };
}

export function isWalkable(area: Area, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= area.width || y >= area.height) return false;
  const ground = area.layers.ground[y]?.[x];
  const feature = area.layers.feature[y]?.[x];
  return ground !== Tile.Water
    && feature !== Tile.Tree
    && feature !== Tile.Wall
    && feature !== Tile.Rock;
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

export function repairReachability(area: Area): void {
  const destinations: GridPoint[] = [...area.doors, ...area.spawnPoints];
  for (const destination of destinations) {
    let x = area.entry.x;
    let y = area.entry.y;
    while (x !== destination.x) {
      x += Math.sign(destination.x - x);
      carve(area, x, y);
    }
    while (y !== destination.y) {
      y += Math.sign(destination.y - y);
      carve(area, x, y);
    }
  }
  carve(area, area.entry.x, area.entry.y);
}

export function carve(area: Area, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= area.width || y >= area.height) return;
  area.layers.ground[y]![x] = area.biome === "cave" || area.biome === "building" || area.biome === "ruins"
    ? Tile.Floor
    : Tile.Path;
  area.layers.feature[y]![x] = Tile.Grass;
}

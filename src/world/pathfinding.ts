import type { GridPoint } from "./types";

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
// A small cost for turning makes routes run in long straight lines instead of staircases.
const TURN_COST = 0.3;

export interface PathQuery {
  readonly width: number;
  readonly height: number;
  readonly start: GridPoint;
  // Any one of these ends the route; the cheapest is chosen.
  readonly goals: readonly GridPoint[];
  readonly isPassable: (x: number, y: number) => boolean;
}

interface Node {
  readonly x: number;
  readonly y: number;
  readonly direction: number;
  readonly cost: number;
}

// Four-connected route over tile centres, so the player's box never has to cut a corner.
// Returns the tiles from start to the reached goal, or null when no goal can be reached.
// The start tile is always allowed, even if something now stands on it.
export function findPath(query: PathQuery): GridPoint[] | null {
  const { width, height, start, goals, isPassable } = query;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  if (!inside(start.x, start.y)) return null;
  const goalKeys = new Set(goals.filter((goal) => inside(goal.x, goal.y)).map((goal) => goal.y * width + goal.x));
  if (goalKeys.size === 0) return null;
  if (goalKeys.has(start.y * width + start.x)) return [{ x: start.x, y: start.y }];

  // State is a tile plus the direction used to enter it; direction 4 means "none yet".
  const stateKey = (x: number, y: number, direction: number): number => (y * width + x) * 5 + direction;
  const best = new Map<number, number>([[stateKey(start.x, start.y, 4), 0]]);
  const previous = new Map<number, number>();
  const heap: Node[] = [{ x: start.x, y: start.y, direction: 4, cost: 0 }];

  const push = (node: Node): void => {
    heap.push(node);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent]!.cost <= heap[index]!.cost) break;
      [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
      index = parent;
    }
  };
  const pop = (): Node => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < heap.length && heap[left]!.cost < heap[smallest]!.cost) smallest = left;
        if (right < heap.length && heap[right]!.cost < heap[smallest]!.cost) smallest = right;
        if (smallest === index) break;
        [heap[smallest], heap[index]] = [heap[index]!, heap[smallest]!];
        index = smallest;
      }
    }
    return top;
  };

  while (heap.length > 0) {
    const node = pop();
    const key = stateKey(node.x, node.y, node.direction);
    if (node.cost > (best.get(key) ?? Infinity)) continue;
    if (goalKeys.has(node.y * width + node.x)) {
      const path: GridPoint[] = [];
      for (let current: number | undefined = key; current !== undefined; current = previous.get(current)) {
        const tile = Math.floor(current / 5);
        path.push({ x: tile % width, y: Math.floor(tile / width) });
      }
      return path.reverse();
    }
    for (let direction = 0; direction < DIRECTIONS.length; direction += 1) {
      const [dx, dy] = DIRECTIONS[direction]!;
      const x = node.x + dx;
      const y = node.y + dy;
      if (!inside(x, y) || !isPassable(x, y)) continue;
      const cost = node.cost + 1 + (node.direction !== 4 && node.direction !== direction ? TURN_COST : 0);
      const nextKey = stateKey(x, y, direction);
      if (cost >= (best.get(nextKey) ?? Infinity)) continue;
      best.set(nextKey, cost);
      previous.set(nextKey, key);
      push({ x, y, direction, cost });
    }
  }
  return null;
}

// Tiles whose centre lies within rangeTiles of the centre of the target tile.
export function tilesWithinRange(target: GridPoint, rangeTiles: number, width: number, height: number): GridPoint[] {
  const reach = Math.floor(rangeTiles);
  const tiles: GridPoint[] = [];
  for (let y = target.y - reach; y <= target.y + reach; y += 1) {
    for (let x = target.x - reach; x <= target.x + reach; x += 1) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (Math.hypot(x - target.x, y - target.y) <= rangeTiles) tiles.push({ x, y });
    }
  }
  return tiles;
}

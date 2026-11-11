import { TILE_SIZE, type World } from "./world";

export interface Position {
  readonly x: number;
  readonly y: number;
}

// Follows the target, clamped to the world. An axis on which the view is larger than the world is centred instead,
// which puts the area in the middle of the screen with the background colour around it.
export function followCamera(target: Position, world: World, viewWidth: number, viewHeight: number): Position {
  return {
    x: followAxis(target.x, world.width * TILE_SIZE, viewWidth),
    y: followAxis(target.y, world.height * TILE_SIZE, viewHeight),
  };
}

function followAxis(target: number, worldSize: number, viewSize: number): number {
  if (viewSize >= worldSize) return Math.round((worldSize - viewSize) / 2);
  return Math.round(Math.max(0, Math.min(target - viewSize / 2, worldSize - viewSize)));
}

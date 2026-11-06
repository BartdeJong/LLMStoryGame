import { TILE_SIZE, type World } from "./world";

export interface Position {
  readonly x: number;
  readonly y: number;
}

export function followCamera(target: Position, world: World, viewWidth: number, viewHeight: number): Position {
  const worldWidth = world.width * TILE_SIZE;
  const worldHeight = world.height * TILE_SIZE;
  return {
    x: Math.round(Math.max(0, Math.min(target.x - viewWidth / 2, worldWidth - viewWidth))),
    y: Math.round(Math.max(0, Math.min(target.y - viewHeight / 2, worldHeight - viewHeight))),
  };
}

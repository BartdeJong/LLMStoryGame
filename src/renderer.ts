import { TILE_SIZE, Tile, type Area } from "./world";
import type { Position } from "./camera";
import { DEFAULT_CHARACTER_RECIPE, getCharacterSprite, getTileCanvas, type TileType } from "./art";

export const VIEW_WIDTH = 320;
export const VIEW_HEIGHT = 180;

const artTiles: Record<Tile, TileType> = {
  [Tile.Grass]: "grass",
  [Tile.Path]: "path",
  [Tile.Water]: "water",
  [Tile.Tree]: "tree",
  [Tile.Wall]: "wall",
  [Tile.Rock]: "rock",
  [Tile.Floor]: "floor",
  [Tile.Door]: "door",
  [Tile.Flowers]: "flowers",
  [Tile.Bridge]: "bridge",
};

export class Renderer {
  private readonly context: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("This browser could not create a 2D canvas context.");
    }
    this.context = context;
    this.context.imageSmoothingEnabled = false;
  }

  draw(world: Area, player: Position, camera: Position, transitionOpacity = 0): void {
    const context = this.context;
    context.fillStyle = "#17251d";
    context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    const firstColumn = Math.floor(camera.x / TILE_SIZE);
    const firstRow = Math.floor(camera.y / TILE_SIZE);
    const offsetX = -(camera.x % TILE_SIZE);
    const offsetY = -(camera.y % TILE_SIZE);
    const columns = Math.ceil(VIEW_WIDTH / TILE_SIZE) + 1;
    const rows = Math.ceil(VIEW_HEIGHT / TILE_SIZE) + 1;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const tileX = firstColumn + column;
        const tileY = firstRow + row;
        const ground = world.layers.ground[tileY]?.[tileX];
        if (ground === undefined) continue;

        const screenX = offsetX + column * TILE_SIZE;
        const screenY = offsetY + row * TILE_SIZE;
        this.drawTile(ground, tileX, tileY, screenX, screenY);
        const feature = world.layers.feature[tileY]?.[tileX];
        if (feature !== undefined && feature !== Tile.Grass) {
          this.drawTile(feature, tileX, tileY, screenX, screenY);
        }
      }
    }

    this.drawPlayer(Math.round(player.x - camera.x), Math.round(player.y - camera.y));
    if (transitionOpacity > 0) {
      context.fillStyle = `rgba(18, 30, 25, ${Math.min(1, transitionOpacity)})`;
      context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    }
  }

  private drawTile(tile: Tile, tileX: number, tileY: number, x: number, y: number): void {
    const shimmer = Math.floor(performance.now() / 450) % 2;
    const seed = `${tileX},${tileY}`;
    this.context.drawImage(getTileCanvas("meadow", artTiles[tile], seed, shimmer), x, y);
  }

  private drawPlayer(x: number, y: number): void {
    this.context.drawImage(getCharacterSprite(DEFAULT_CHARACTER_RECIPE, "meadow", "down"), x - 8, y - 8);
  }
}

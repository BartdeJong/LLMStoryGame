import { TILE_SIZE, Tile, type Area, type AreaEntity } from "./world";
import type { DoorKind } from "./world";
import type { Position } from "./camera";
import {
  DEFAULT_CHARACTER_RECIPE,
  getCharacterSprite,
  getIconCanvas,
  getTileCanvas,
  getStoryVisualTheme,
  type PaletteName,
  type StoryVisualTheme,
  type TileType,
} from "./art";

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

const doorTiles: Record<DoorKind, TileType> = {
  edge: "trail-exit",
  "cave-mouth": "cave-mouth",
  gate: "gate",
  hatch: "hatch",
};

export class Renderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly storyTheme: StoryVisualTheme;

  constructor(canvas: HTMLCanvasElement, storyId: string) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("This browser could not create a 2D canvas context.");
    }
    this.context = context;
    this.context.imageSmoothingEnabled = false;
    this.storyTheme = getStoryVisualTheme(storyId);
    canvas.style.filter = this.storyTheme.canvasFilter;
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
    const doors = new Map(world.doors.map((door) => [`${door.x},${door.y}`, door]));

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const tileX = firstColumn + column;
        const tileY = firstRow + row;
        const ground = world.layers.ground[tileY]?.[tileX];
        if (ground === undefined) continue;

        const screenX = offsetX + column * TILE_SIZE;
        const screenY = offsetY + row * TILE_SIZE;
        this.drawTile(world.palette, ground, tileX, tileY, screenX, screenY);
        const feature = world.layers.feature[tileY]?.[tileX];
        if (feature !== undefined && feature !== Tile.Grass) {
          const door = feature === Tile.Door ? doors.get(`${tileX},${tileY}`) : undefined;
          if (door) {
            this.context.drawImage(
              getTileCanvas(world.palette, doorTiles[door.kind], `${tileX},${tileY}`),
              screenX,
              screenY,
            );
          } else {
            this.drawTile(world.palette, feature, tileX, tileY, screenX, screenY);
          }
        }
      }
    }

    for (const entity of world.entities ?? []) this.drawEntity(world.palette, entity, camera);
    this.drawPlayer(world.palette, Math.round(player.x - camera.x), Math.round(player.y - camera.y));
    this.drawStoryAtmosphere(context);
    if (transitionOpacity > 0) this.drawFog(transitionOpacity);
  }

  private drawTile(palette: PaletteName, tile: Tile, tileX: number, tileY: number, x: number, y: number): void {
    const shimmer = Math.floor(performance.now() / 450) % 2;
    const seed = `${tileX},${tileY}`;
    this.context.drawImage(getTileCanvas(palette, artTiles[tile], seed, shimmer), x, y);
  }

  private drawEntity(palette: PaletteName, entity: AreaEntity, camera: Position): void {
    const x = Math.round(entity.x * TILE_SIZE - camera.x);
    const y = Math.round(entity.y * TILE_SIZE - camera.y);
    if (x < -TILE_SIZE || y < -TILE_SIZE || x > VIEW_WIDTH || y > VIEW_HEIGHT) return;
    if (entity.character) {
      this.context.drawImage(getCharacterSprite(entity.character, palette, "down"), x, y);
    } else if (entity.icon) {
      this.context.drawImage(getIconCanvas(entity.icon, palette), x, y);
    }
  }

  // Dark veil with slow drifting fog banks; used while an area is loading.
  private drawFog(opacity: number): void {
    const context = this.context;
    const alpha = Math.min(1, opacity);
    context.fillStyle = `rgba(18, 30, 25, ${alpha})`;
    context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    const time = performance.now() / 1000;
    context.fillStyle = `rgba(205, 220, 212, ${0.12 * alpha})`;
    for (let index = 0; index < 7; index += 1) {
      const x = ((index * 83 + time * (8 + (index % 3) * 5)) % (VIEW_WIDTH + 160)) - 80;
      const y = 14 + index * 24 + Math.sin(time * 0.7 + index) * 6;
      context.beginPath();
      context.ellipse(x, y, 70, 14, 0, 0, Math.PI * 2);
      context.fill();
    }
  }

  private drawPlayer(palette: PaletteName, x: number, y: number): void {
    this.context.drawImage(getCharacterSprite(DEFAULT_CHARACTER_RECIPE, palette, "down"), x - 8, y - 8);
  }

  private drawStoryAtmosphere(context: CanvasRenderingContext2D): void {
    if (document.documentElement.dataset.reducedMotion === "true") return;
    const time = performance.now() / 1000;
    context.save();
    context.fillStyle = this.storyTheme.particle;
    for (let index = 0; index < 8; index += 1) {
      const x = (index * 47 + Math.sin(time * 0.18 + index * 1.7) * 18 + VIEW_WIDTH) % VIEW_WIDTH;
      const drift = this.storyTheme.atmosphere === "falling-ash" ? time * (4 + index % 4) : time * 2;
      const y = (index * 29 + drift + Math.sin(time * 0.5 + index) * 4) % VIEW_HEIGHT;
      const size = this.storyTheme.atmosphere === "tide-glow" && index % 3 === 0 ? 2 : 1;
      context.globalAlpha = this.storyTheme.atmosphere === "falling-ash"
        ? 0.24
        : 0.35 + (Math.sin(time * 1.2 + index) + 1) * 0.2;
      context.fillRect(Math.round(x), Math.round(y), size, size);
    }
    context.restore();
  }
}

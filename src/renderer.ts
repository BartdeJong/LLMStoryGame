import { TILE_SIZE, Tile, type Area, type AreaEntity } from "./world";
import type { DoorKind } from "./world";
import type { Position } from "./camera";
import {
  DEFAULT_CHARACTER_RECIPE,
  getCharacterSprite,
  getAshenObjectSprite,
  getIconCanvas,
  getTileCanvas,
  getStoryVisualTheme,
  PALETTES,
  type Direction,
  type PaletteName,
  type StoryVisualTheme,
  type TileType,
} from "./art";
import { getGlyph, getVisualCanvas } from "./art/glyphs";

export const VIEW_WIDTH = 320;
export const VIEW_HEIGHT = 180;

export interface CharacterRenderState {
  x: number;
  y: number;
  direction: Direction;
  moving: boolean;
}

export interface DoorSign {
  // Tile of the door the sign belongs to.
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly locked: boolean;
}

export interface EntityPresentation {
  characters: ReadonlyMap<string, CharacterRenderState>;
  talkMarkerIds: ReadonlySet<string>;
  animateCharacters: boolean;
  // Signs for the doors of the area; only those whose door is in view are shown.
  doorSigns?: readonly DoorSign[];
}

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
  private label: HTMLElement | null = null;
  private readonly doorSignLabels: { element: HTMLElement; width: number; height: number; scale: number }[] = [];

  constructor(private readonly canvas: HTMLCanvasElement, storyId: string) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("This browser could not create a 2D canvas context.");
    }
    this.context = context;
    this.context.imageSmoothingEnabled = false;
    this.storyTheme = getStoryVisualTheme(storyId);
    canvas.style.filter = this.storyTheme.canvasFilter;
  }

  draw(
    world: Area,
    player: Position,
    camera: Position,
    transitionOpacity = 0,
    interactionTarget?: AreaEntity,
    playerDirection: Direction = "down",
    playerMoving = false,
    presentation?: EntityPresentation,
  ): void {
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

    for (const entity of world.entities ?? []) this.drawEntity(world.palette, entity, camera, presentation);
    this.drawPlayer(
      world.palette,
      Math.round(player.x - camera.x),
      Math.round(player.y - camera.y),
      playerDirection,
      playerMoving,
    );
    this.drawAtmosphere(world);
    this.drawStoryAtmosphere(context);
    if (interactionTarget) this.drawInteractionMarker(interactionTarget, camera, world.palette);
    else if (this.label) this.label.style.visibility = "hidden";
    this.showDoorSigns(transitionOpacity > 0 ? [] : presentation?.doorSigns ?? [], camera);
    if (transitionOpacity > 0) this.drawFog(transitionOpacity);
  }

  private drawTile(palette: PaletteName, tile: Tile, tileX: number, tileY: number, x: number, y: number): void {
    const shimmer = Math.floor(performance.now() / 450) % 2;
    const seed = `${tileX},${tileY}`;
    this.context.drawImage(getTileCanvas(palette, artTiles[tile], seed, shimmer), x, y);
  }

  private drawEntity(palette: PaletteName, entity: AreaEntity, camera: Position, presentation?: EntityPresentation): void {
    const character = presentation?.characters.get(entity.id);
    const x = Math.round((character?.x ?? entity.x) * TILE_SIZE - camera.x);
    const y = Math.round((character?.y ?? entity.y) * TILE_SIZE - camera.y);
    if (x < -TILE_SIZE || y < -TILE_SIZE || x > VIEW_WIDTH || y > VIEW_HEIGHT) return;
    const objectSprite = entity.packId ? getAshenObjectSprite(entity.packId, palette) : null;
    if (!entity.character) this.drawObjectShadow(x, y);
    if (entity.character) {
      const animate = presentation?.animateCharacters !== false
        && document.documentElement.dataset.reducedMotion !== "true";
      const frame = !animate
        ? 0
        : character?.moving
          ? Math.floor(performance.now() / 150)
          : Math.floor(performance.now() / 650) % 2;
      this.context.drawImage(getCharacterSprite(entity.character, palette, character?.direction ?? "down", frame), x, y);
      if (presentation?.talkMarkerIds.has(entity.id)) this.drawTalkMarker(x, y, palette);
    } else if (entity.visual && (!entity.visualInferred || !objectSprite)) {
      const openId = `${entity.visual.icon}_open`;
      const visual = entity.opened && getGlyph(openId) ? { ...entity.visual, icon: openId } : entity.visual;
      this.context.drawImage(getVisualCanvas(visual, palette, entity.icon, entity.visualInferred, entity.id), x, y);
    } else if (objectSprite) {
      this.context.drawImage(objectSprite, x, y);
    } else if (entity.icon) {
      this.context.drawImage(getIconCanvas(entity.icon, palette), x, y);
    }
  }

  private drawTalkMarker(x: number, y: number, palette: PaletteName): void {
    const context = this.context;
    context.fillStyle = PALETTES[palette].ink;
    context.fillRect(x + 11, y - 4, 7, 6);
    context.fillStyle = PALETTES[palette].highlight;
    context.fillRect(x + 12, y - 3, 5, 4);
    context.fillRect(x + 12, y + 2, 2, 2);
  }

  private drawObjectShadow(x: number, y: number): void {
    const context = this.context;
    context.save();
    const shadow = context.createRadialGradient(x + 8, y + 15, 0, x + 8, y + 15, 8);
    shadow.addColorStop(0, "rgba(0, 0, 0, 0.42)");
    shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = shadow;
    context.beginPath();
    context.ellipse(x + 8, y + 15, 8, 2.5, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  // Dark veil with slow drifting fog banks; used while an area is loading.
  private drawFog(opacity: number): void {
    const context = this.context;
    const alpha = Math.min(1, opacity);
    context.fillStyle = `rgba(18, 30, 25, ${alpha})`;
    context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    if (document.documentElement.dataset.reducedMotion === "true") return;
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

  private drawPlayer(palette: PaletteName, x: number, y: number, direction: Direction, moving: boolean): void {
    const frame = moving && document.documentElement.dataset.reducedMotion !== "true"
      ? Math.floor(performance.now() / 180)
      : 0;
    this.context.drawImage(
      getCharacterSprite(DEFAULT_CHARACTER_RECIPE, palette, direction, frame),
      x - 10,
      y - 10,
      20,
      20,
    );
  }

  private drawInteractionMarker(entity: AreaEntity, camera: Position, paletteName: PaletteName): void {
    const entityX = Math.round(entity.x * TILE_SIZE - camera.x);
    const entityY = Math.round(entity.y * TILE_SIZE - camera.y);
    const x = entityX + TILE_SIZE / 2;
    const y = entityY + TILE_SIZE / 2 - 5 + Math.sin(performance.now() / 180) * 1.5;
    const context = this.context;
    context.save();
    context.fillStyle = PALETTES[paletteName].highlight;
    context.globalAlpha = 0.9;
    context.beginPath();
    context.moveTo(x, y - 4);
    context.lineTo(x + 3, y);
    context.lineTo(x, y + 4);
    context.lineTo(x - 3, y);
    context.closePath();
    context.fill();
    context.fillStyle = PALETTES[paletteName].ink;
    context.fillRect(x, y - 1, 1, 2);
    context.restore();
    this.showLabel(entity.name, x, entityY);
  }

  // The label is DOM text so it stays sharp at any display scale; the canvas is only 320x180.
  private showLabel(name: string, anchorX: number, topY: number): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const label = this.label ?? this.createLabel(parent);
    if (label.textContent !== name) label.textContent = name;
    const view = this.viewOnPage(parent);
    if (!view) return;
    const { scale, originX, originY } = view;
    const width = label.offsetWidth;
    const height = label.offsetHeight;
    const minX = originX + 4;
    const maxX = originX + VIEW_WIDTH * scale - width - 4;
    const left = Math.max(minX, Math.min(Math.max(minX, maxX), originX + anchorX * scale - width / 2));
    const top = Math.max(originY + 2, originY + topY * scale - height - 4 * scale);
    label.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    label.style.visibility = "visible";
  }

  // Where the 320x180 view sits inside the element that holds the DOM labels, and how much it is enlarged.
  private viewOnPage(parent: HTMLElement): { scale: number; originX: number; originY: number } | null {
    const canvasRect = this.canvas.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const scale = Math.min(canvasRect.width / VIEW_WIDTH, canvasRect.height / VIEW_HEIGHT);
    if (!(scale > 0)) return null;
    return {
      scale,
      originX: canvasRect.left - parentRect.left + (canvasRect.width - VIEW_WIDTH * scale) / 2,
      originY: canvasRect.top - parentRect.top + (canvasRect.height - VIEW_HEIGHT * scale) / 2,
    };
  }

  // A small sign above every door in view, so the player can see where it leads without walking up to it.
  private showDoorSigns(signs: readonly DoorSign[], camera: Position): void {
    const parent = this.canvas.parentElement;
    const view = parent && signs.length > 0 ? this.viewOnPage(parent) : null;
    let used = 0;
    if (parent && view) {
      const { scale, originX, originY } = view;
      for (const sign of signs) {
        const doorX = sign.x * TILE_SIZE - camera.x;
        const doorY = sign.y * TILE_SIZE - camera.y;
        if (doorX <= -TILE_SIZE || doorY <= -TILE_SIZE || doorX >= VIEW_WIDTH || doorY >= VIEW_HEIGHT) continue;
        const label = this.doorSignLabels[used] ?? this.createDoorSign(parent);
        used += 1;
        const text = sign.locked ? `${sign.text} (locked)` : sign.text;
        // Measuring forces a layout, so it only happens when the text or the display size changes.
        if (label.element.textContent !== text || label.scale !== scale) {
          label.element.textContent = text;
          label.element.classList.toggle("door-sign-locked", sign.locked);
          label.width = label.element.offsetWidth;
          label.height = label.element.offsetHeight;
          label.scale = scale;
        }
        const minX = originX + 2;
        const maxX = originX + VIEW_WIDTH * scale - label.width - 2;
        const left = Math.max(minX, Math.min(Math.max(minX, maxX), originX + (doorX + TILE_SIZE / 2) * scale - label.width / 2));
        const top = Math.max(originY + 2, originY + doorY * scale - label.height - 2 * scale);
        label.element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        label.element.style.visibility = "visible";
      }
    }
    for (let index = used; index < this.doorSignLabels.length; index += 1) {
      this.doorSignLabels[index]!.element.style.visibility = "hidden";
    }
  }

  private createDoorSign(parent: HTMLElement): { element: HTMLElement; width: number; height: number; scale: number } {
    const element = document.createElement("div");
    element.className = "door-sign";
    element.setAttribute("aria-hidden", "true");
    element.style.background = this.storyTheme.panel;
    element.style.color = this.storyTheme.text;
    element.style.borderColor = this.storyTheme.frame;
    parent.append(element);
    const label = { element, width: 0, height: 0, scale: 0 };
    this.doorSignLabels.push(label);
    return label;
  }

  // Takes the DOM labels off the page when the game ends.
  removeLabels(): void {
    this.label?.remove();
    this.label = null;
    for (const { element } of this.doorSignLabels.splice(0)) element.remove();
  }

  private createLabel(parent: HTMLElement): HTMLElement {
    const label = document.createElement("div");
    label.className = "entity-label";
    label.setAttribute("aria-hidden", "true");
    label.style.background = this.storyTheme.panel;
    label.style.color = this.storyTheme.text;
    label.style.borderColor = this.storyTheme.frame;
    parent.append(label);
    this.label = label;
    return label;
  }

  private drawAtmosphere(world: Area): void {
    const context = this.context;
    const light = world.biome === "cave" || world.biome === "ruins"
      ? "rgba(133, 148, 196, 0.10)"
      : world.biome === "shore"
        ? "rgba(142, 214, 224, 0.09)"
        : "rgba(255, 224, 157, 0.09)";
    const vignette = context.createRadialGradient(
      VIEW_WIDTH / 2,
      VIEW_HEIGHT / 2,
      VIEW_HEIGHT * 0.15,
      VIEW_WIDTH / 2,
      VIEW_HEIGHT / 2,
      VIEW_WIDTH * 0.72,
    );
    vignette.addColorStop(0, light);
    vignette.addColorStop(1, "rgba(18, 27, 24, 0.13)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    if (document.documentElement.dataset.reducedMotion === "true") return;
    if (world.biome === "meadow" || world.biome === "village" || world.biome === "forest") {
      const time = performance.now() / 1000;
      context.fillStyle = PALETTES[world.palette].highlight;
      for (let index = 0; index < 5; index += 1) {
        const x = ((index * 67 + time * (4 + index % 3 * 2)) % (VIEW_WIDTH + 12)) - 6;
        const y = 24 + (index * 37) % (VIEW_HEIGHT - 32) + Math.sin(time + index) * 2;
        context.globalAlpha = 0.35 + (Math.sin(time * 1.4 + index) + 1) * 0.12;
        context.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
      context.globalAlpha = 1;
    }
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

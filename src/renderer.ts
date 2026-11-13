import { TILE_SIZE, Tile, type Area, type AreaEntity } from "./world";
import type { DoorKind } from "./world";
import type { Position } from "./camera";
import {
  DEFAULT_CHARACTER_RECIPE,
  getCharacterSprite,
  getSpriteCanvas,
  IDLE_POSE,
  type SpriteSpec,
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
import {
  BIG_FURNITURE_SCALE,
  canEnlarge,
  getGlyph,
  getVisualCanvas,
  glyphBottomRow,
  isBigFurniture,
  isWallMounted,
  wallCropRows,
} from "./art/glyphs";
import { RUG_EDGE, mix } from "./art/surfaceTiles";
import {
  LIGHT_FALLOFF_STOPS,
  ambientFor,
  areaHasLights,
  capLightRadius,
  collectLights,
  effectiveAmbient,
  flickerFactor,
  lightCoreColor,
  mapBoundaryShapes,
  type LightSource,
  type Rect,
} from "./art/lighting";
import { REFERENCE_VIEW_HEIGHT, REFERENCE_VIEW_WIDTH, computeViewLayout } from "./viewport";

// Extra ambient specks keep the density of the original 320x180 view on bigger screens.
const REFERENCE_VIEW_AREA = REFERENCE_VIEW_WIDTH * REFERENCE_VIEW_HEIGHT;

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
  // Objects whose clues the player has all found; they get a quiet check instead of the pulsing outline.
  checkedEntityIds?: ReadonlySet<string>;
  // How the player looks (identity.player.sprite of the story pack).
  playerSprite?: SpriteSpec;
}

const GOLD = "#f2a81d";
const CHECK = ["......o", ".....oo", "o...oo.", "oo.oo..", ".ooo...", "..o...."];

const silhouettes = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();

function silhouette(source: HTMLCanvasElement, color: string): HTMLCanvasElement {
  let byColor = silhouettes.get(source);
  if (!byColor) silhouettes.set(source, (byColor = new Map()));
  let canvas = byColor.get(color);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(source, 0, 0);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    byColor.set(color, canvas);
  }
  return canvas;
}

// "#rgb" or "#rrggbb" as an rgba() string; anything else is returned unchanged.
function withAlpha(color: string, alpha: number): string {
  let hex = /^#([0-9a-f]{3})$/i.test(color) ? color.slice(1).replace(/./g, "$&$&") : "";
  if (!hex && /^#[0-9a-f]{6}$/i.test(color)) hex = color.slice(1);
  if (!hex) return color;
  return `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}, ${alpha})`;
}

// Colour multiplied over everything outside the map, and the fill drawn there; both near black.
const VOID_SHADE_DARKEN = 0.8;
function voidColor(edge: string): string {
  return mix(edge, "#000000", VOID_SHADE_DARKEN);
}

function hashId(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return hash;
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
  [Tile.Void]: "void",
  [Tile.Rug]: "rug",
  [Tile.Counter]: "counter",
};

type FloorStyleName = NonNullable<Area["style"]>["floor"];
type WallStyleName = NonNullable<Area["style"]>["wall"];

const BIOME_FLOOR: Record<Area["biome"], FloorStyleName> = {
  building: "boards",
  cave: "dirt",
  ruins: "flagstone",
  village: "cobble",
  meadow: "grass",
  forest: "grass",
  shore: "sand",
};

const BIOME_WALL: Record<Area["biome"], WallStyleName> = {
  building: "plaster",
  cave: "rock",
  ruins: "stone",
  village: "brick",
  meadow: "hedge",
  forest: "hedge",
  shore: "fence",
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
  private frameWorld: Area | null = null;
  private readonly busyCache = new WeakMap<Area, Set<string>>();
  private readonly doorSignLabels: { element: HTMLElement; width: number; height: number; scale: number }[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private viewWidthPx = REFERENCE_VIEW_WIDTH;
  private viewHeightPx = REFERENCE_VIEW_HEIGHT;
  private lightCanvas: HTMLCanvasElement | null = null;
  private lightContext: CanvasRenderingContext2D | null = null;
  private readonly lightSprites = new Map<string, HTMLCanvasElement>();
  private lightBase: HTMLCanvasElement | null = null;
  private lightBaseKey = "";
  private readonly lightPositions = new Map<string, { x: number; y: number }>();

  // World pixels across and down the canvas; they follow the shape of the screen.
  get viewWidth(): number {
    return this.viewWidthPx;
  }

  get viewHeight(): number {
    return this.viewHeightPx;
  }

  constructor(private readonly canvas: HTMLCanvasElement, storyId: string) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("This browser could not create a 2D canvas context.");
    }
    this.context = context;
    this.storyTheme = getStoryVisualTheme(storyId);
    canvas.style.filter = this.storyTheme.canvasFilter;
    this.fitToContainer();
    const container = canvas.parentElement;
    if (container && typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.fitToContainer);
      this.resizeObserver.observe(container);
    }
    window.addEventListener("resize", this.fitToContainer);
  }

  // Sizes the canvas to cover its container; see computeViewLayout for the zoom rule.
  private readonly fitToContainer = (): void => {
    const container = this.canvas.parentElement;
    const layout = computeViewLayout(
      container?.clientWidth ?? window.innerWidth,
      container?.clientHeight ?? window.innerHeight,
      window.devicePixelRatio || 1,
    );
    if (layout.width !== this.canvas.width || layout.height !== this.canvas.height) {
      this.canvas.width = layout.width;
      this.canvas.height = layout.height;
    }
    this.viewWidthPx = layout.width;
    this.viewHeightPx = layout.height;
    const style = this.canvas.style;
    style.width = `${layout.cssWidth}px`;
    style.height = `${layout.cssHeight}px`;
    style.left = `${layout.cssLeft}px`;
    style.top = `${layout.cssTop}px`;
    // Resizing the canvas resets its drawing state.
    this.context.imageSmoothingEnabled = false;
  };

  private ambientCount(base: number): number {
    return Math.max(base, Math.round((base * this.viewWidthPx * this.viewHeightPx) / REFERENCE_VIEW_AREA));
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
    const viewWidth = this.viewWidthPx;
    const viewHeight = this.viewHeightPx;
    context.fillStyle = voidColor(this.storyTheme.lighting.edge);
    context.fillRect(0, 0, viewWidth, viewHeight);

    const firstColumn = Math.floor(camera.x / TILE_SIZE);
    const firstRow = Math.floor(camera.y / TILE_SIZE);
    const offsetX = firstColumn * TILE_SIZE - camera.x;
    const offsetY = firstRow * TILE_SIZE - camera.y;
    const columns = Math.ceil(viewWidth / TILE_SIZE) + 1;
    const rows = Math.ceil(viewHeight / TILE_SIZE) + 1;
    const doors = new Map(world.doors.map((door) => [`${door.x},${door.y}`, door]));

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const tileX = firstColumn + column;
        const tileY = firstRow + row;
        const ground = world.layers.ground[tileY]?.[tileX];
        if (ground === undefined) continue;

        const screenX = offsetX + column * TILE_SIZE;
        const screenY = offsetY + row * TILE_SIZE;
        const feature = world.layers.feature[tileY]?.[tileX];
        if (ground !== Tile.Void) this.drawGround(world, ground, tileX, tileY, screenX, screenY);
        if (feature !== undefined && feature !== Tile.Grass) {
          const door = feature === Tile.Door ? doors.get(`${tileX},${tileY}`) : undefined;
          if (door) {
            this.context.drawImage(
              getTileCanvas(world.palette, doorTiles[door.kind], `${tileX},${tileY}`),
              screenX,
              screenY,
            );
          } else if (feature === Tile.Wall) {
            this.drawWall(world, tileX, tileY, screenX, screenY);
          } else {
            this.drawTile(world.palette, feature, tileX, tileY, screenX, screenY);
          }
        }
        if (feature !== Tile.Wall && feature !== Tile.Door && ground !== Tile.Void && ground !== Tile.Water) {
          this.drawWallShadow(world, tileX, tileY, screenX, screenY);
        }
      }
    }

    this.drawDecor(world, camera);

    this.frameWorld = world;
    this.drawCharacterShadows(world, player, camera, presentation);
    for (const entity of world.entities ?? []) this.drawEntity(world.palette, entity, camera, presentation);
    this.drawPlayer(
      world.palette,
      Math.round(player.x - camera.x),
      Math.round(player.y - camera.y),
      playerDirection,
      playerMoving,
      presentation?.playerSprite,
    );
    this.drawLighting(world, player, camera, presentation);
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

  // Plain floor follows the area's floor style; rugs get borders on the sides that face bare floor.
  private drawGround(world: Area, ground: Tile, tileX: number, tileY: number, x: number, y: number): void {
    const seed = `${tileX},${tileY}`;
    if (ground === Tile.Floor) {
      const style = world.style?.floor ?? BIOME_FLOOR[world.biome];
      this.context.drawImage(getTileCanvas(world.palette, `floor-${style}`, seed), x, y);
    } else if (ground === Tile.Rug) {
      const rows = world.layers.ground;
      const isRug = (dx: number, dy: number) => rows[tileY + dy]?.[tileX + dx] === Tile.Rug;
      const edges = (isRug(0, -1) ? 0 : RUG_EDGE.north)
        | (isRug(1, 0) ? 0 : RUG_EDGE.east)
        | (isRug(0, 1) ? 0 : RUG_EDGE.south)
        | (isRug(-1, 0) ? 0 : RUG_EDGE.west);
      const floor = world.style?.floor ?? BIOME_FLOOR[world.biome];
      this.context.drawImage(getTileCanvas(world.palette, `floor-${floor}`, seed), x, y);
      this.context.drawImage(getTileCanvas(world.palette, "rug", 0, 0, edges), x, y);
    } else {
      this.drawTile(world.palette, ground, tileX, tileY, x, y);
    }
  }

  // The front of a wall (lighter, with skirting) shows when you could stand below it; otherwise its dark top.
  private drawWall(world: Area, tileX: number, tileY: number, x: number, y: number): void {
    const style = world.style?.wall ?? BIOME_WALL[world.biome];
    const belowGround = world.layers.ground[tileY + 1]?.[tileX];
    const belowFeature = world.layers.feature[tileY + 1]?.[tileX];
    const top = belowGround === undefined || belowGround === Tile.Void || belowFeature === Tile.Wall;
    const kind: TileType = top ? `wall-top-${style}` : `wall-face-${style}`;
    this.context.drawImage(getTileCanvas(world.palette, kind, `${tileX},${tileY}`), x, y);
  }

  // Soft shadow on the floor below and to the right of a wall.
  private drawWallShadow(world: Area, tileX: number, tileY: number, x: number, y: number): void {
    const features = world.layers.feature;
    const context = this.context;
    if (features[tileY - 1]?.[tileX] === Tile.Wall) {
      context.fillStyle = "rgba(24, 14, 18, 0.30)";
      context.fillRect(x, y, TILE_SIZE, 3);
      context.fillStyle = "rgba(24, 14, 18, 0.14)";
      context.fillRect(x, y + 3, TILE_SIZE, 2);
    }
    if (features[tileY]?.[tileX - 1] === Tile.Wall) {
      context.fillStyle = "rgba(24, 14, 18, 0.18)";
      context.fillRect(x, y, 2, TILE_SIZE);
    }
  }

  private drawDecor(world: Area, camera: Position): void {
    for (const item of world.decor ?? []) {
      const x = Math.round(item.x * TILE_SIZE - camera.x);
      const y = Math.round(item.y * TILE_SIZE - camera.y);
      if (x < -TILE_SIZE || y < -TILE_SIZE || x > this.viewWidthPx || y > this.viewHeightPx) continue;
      try {
        const sprite = getVisualCanvas({ icon: item.icon }, world.palette, undefined, false, `${item.x},${item.y}`);
        this.drawProp(world, item.icon, "", item, sprite, x, y);
      } catch {
        // An unknown glyph id leaves the spot empty rather than breaking the frame.
      }
    }
  }

  // Tiles that hold something (entities, decor, doors); big furniture steps back to 16px next to them.
  private busyTiles(world: Area): Set<string> {
    let busy = this.busyCache.get(world);
    if (!busy) {
      busy = new Set<string>();
      for (const entity of world.entities ?? []) busy.add(`${entity.x},${entity.y}`);
      for (const item of world.decor ?? []) busy.add(`${item.x},${item.y}`);
      for (const door of world.doors) busy.add(`${door.x},${door.y}`);
      this.busyCache.set(world, busy);
    }
    return busy;
  }

  // Draws a prop the way it reads best: hung on the wall face above it, larger as furniture, or as a plain glyph.
  // Returns the box it covered so callers can add highlights.
  private drawProp(
    world: Area,
    icon: string,
    name: string,
    tile: { x: number; y: number },
    sprite: HTMLCanvasElement,
    x: number,
    y: number,
    outline?: { color: string; alpha: number },
    lift = 0,
  ): void {
    const context = this.context;
    const paint = (dx: number, dy: number, dw: number, dh: number, sx = 0, sy = 0, sw = 16, sh = 16): void => {
      if (outline && outline.alpha > 0) {
        const tint = silhouette(sprite, outline.color);
        context.save();
        context.globalAlpha = outline.alpha;
        for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          context.drawImage(tint, sx, sy, sw, sh, dx + ox, dy + oy, dw, dh);
        }
        context.restore();
      }
      context.drawImage(sprite, sx, sy, sw, sh, dx, dy, dw, dh);
    };
    if (world.layers.feature[tile.y - 1]?.[tile.x] === Tile.Wall && isWallMounted(icon, name)) {
      const rows = wallCropRows(icon);
      paint(x, y - TILE_SIZE + 2 - lift, TILE_SIZE, rows, 0, 0, 16, rows);
      return;
    }
    this.drawObjectShadow(x, y);
    const busy = this.busyTiles(world);
    if (isBigFurniture(icon) && canEnlarge(tile.x, tile.y, (tx, ty) => busy.has(`${tx},${ty}`))) {
      const size = Math.round(TILE_SIZE * BIG_FURNITURE_SCALE);
      const bottom = Math.round((glyphBottomRow(icon) + 1) * BIG_FURNITURE_SCALE);
      paint(x - (size - TILE_SIZE) / 2, y + TILE_SIZE - bottom - 1 - lift, size, size);
      return;
    }
    paint(x, y - lift, TILE_SIZE, TILE_SIZE);
  }

  private drawEntity(palette: PaletteName, entity: AreaEntity, camera: Position, presentation?: EntityPresentation): void {
    const character = presentation?.characters.get(entity.id);
    const x = Math.round((character?.x ?? entity.x) * TILE_SIZE - camera.x);
    const y = Math.round((character?.y ?? entity.y) * TILE_SIZE - camera.y);
    if (x < -TILE_SIZE || y < -TILE_SIZE || x > this.viewWidthPx || y > this.viewHeightPx) return;
    const objectSprite = entity.packId ? getAshenObjectSprite(entity.packId, palette) : null;
    const checked = presentation?.checkedEntityIds?.has(entity.id) === true;
    const useVisual = !!entity.visual && (!entity.visualInferred || !objectSprite);
    if (!entity.character && !useVisual) this.drawObjectShadow(x, y);
    if (entity.sprite) {
      // Character sprites are 16x24 and stand with their feet on the bottom of the tile.
      const animate = presentation?.animateCharacters !== false
        && document.documentElement.dataset.reducedMotion !== "true";
      const pose = !animate
        ? 0
        : character?.moving
          ? Math.floor(performance.now() / 150) % 4
          : Math.floor(performance.now() / 650) % 2 === 0 ? 0 : IDLE_POSE;
      this.context.drawImage(getSpriteCanvas(entity.sprite, character?.direction ?? "down", pose), x, y - 8);
      if (presentation?.talkMarkerIds.has(entity.id)) this.drawTalkMarker(x, y - 6, palette);
    } else if (entity.character) {
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
      const sprite = getVisualCanvas(visual, palette, entity.icon, entity.visualInferred, entity.id);
      const reduced = document.documentElement.dataset.reducedMotion === "true";
      const time = reduced ? 0 : performance.now() / 1000 + (hashId(entity.id) % 50);
      let outline: { color: string; alpha: number } | undefined;
      let lift = 0;
      if (entity.kind === "object" && !checked) {
        // A soft rim that swells for a moment every few seconds; it stops once the object's clues are found.
        const swell = reduced ? 0 : Math.max(0, Math.sin((time % 4.5) / 4.5 * Math.PI * 2 - Math.PI / 2) - 0.4);
        outline = { color: GOLD, alpha: 0.55 + swell * 0.45 };
      } else if (entity.kind === "key") {
        // Things you can take hop now and then and twinkle.
        const phase = reduced ? 1 : (time % 1.8) / 1.8;
        lift = phase < 0.22 ? Math.round(Math.sin((phase / 0.22) * Math.PI) * 2) : 0;
      }
      if (this.frameWorld) this.drawProp(this.frameWorld, visual.icon, entity.name, entity, sprite, x, y, outline, lift);
      else this.context.drawImage(sprite, x, y);
      if (entity.kind === "key") this.drawSparkle(x + 12, y + 1, time * 2.2, GOLD, reduced);
    } else if (objectSprite) {
      this.context.drawImage(objectSprite, x, y);
    } else if (entity.icon) {
      this.context.drawImage(getIconCanvas(entity.icon, palette), x, y);
    }
    if (checked) this.drawFoundCheck(x + TILE_SIZE - 3, y + 3);
  }

  private drawSparkle(cx: number, cy: number, phase: number, color: string, still: boolean, reach = 2): void {
    const context = this.context;
    const size = still ? reach : Math.max(0, Math.round(reach * (0.5 + 0.5 * Math.sin(phase * 2))));
    context.fillStyle = "#fffbe6";
    context.fillRect(cx, cy, 1, 1);
    context.fillStyle = color;
    for (let step = 1; step <= size; step += 1) {
      context.fillRect(cx - step, cy, 1, 1);
      context.fillRect(cx + step, cy, 1, 1);
      context.fillRect(cx, cy - step, 1, 1);
      context.fillRect(cx, cy + step, 1, 1);
    }
  }

  // A small dark badge with a check, drawn on an object whose clues have all been found.
  private drawFoundCheck(cx: number, cy: number): void {
    const context = this.context;
    context.save();
    context.globalAlpha = 0.65;
    context.fillStyle = "rgba(20, 28, 22, 0.55)";
    context.beginPath();
    context.arc(cx, cy, 5, 0, Math.PI * 2);
    context.fill();
    CHECK.forEach((row, dy) => [...row].forEach((pixel, dx) => {
      if (pixel === ".") return;
      context.fillStyle = "#cfe8c0";
      context.fillRect(cx - 3 + dx, cy - 3 + dy, 1, 1);
    }));
    context.restore();
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
    this.drawContactShadow(x + 8, y + 15, 8, 2.5, 0.42);
  }

  // A soft dark ellipse on the ground where something stands.
  private drawContactShadow(cx: number, footY: number, rx: number, ry: number, alpha: number): void {
    const context = this.context;
    context.save();
    const shadow = context.createRadialGradient(cx, footY, 0, cx, footY, rx);
    shadow.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
    shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = shadow;
    context.beginPath();
    context.ellipse(cx, footY, rx, ry, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  // Characters and the player get a small shadow under their feet; drawn before them so they stand on it.
  private drawCharacterShadows(world: Area, player: Position, camera: Position, presentation?: EntityPresentation): void {
    for (const entity of world.entities ?? []) {
      if (!entity.sprite && !entity.character) continue;
      const character = presentation?.characters.get(entity.id);
      const x = Math.round((character?.x ?? entity.x) * TILE_SIZE - camera.x);
      const y = Math.round((character?.y ?? entity.y) * TILE_SIZE - camera.y);
      if (x < -TILE_SIZE || y < -TILE_SIZE || x > this.viewWidthPx || y > this.viewHeightPx) continue;
      this.drawContactShadow(x + 8, y + 15, 6, 2, 0.4);
    }
    this.drawContactShadow(Math.round(player.x - camera.x), Math.round(player.y - camera.y) + 7, 6, 2, 0.4);
  }

  private ensureLightCanvas(): CanvasRenderingContext2D | null {
    if (!this.lightCanvas) {
      this.lightCanvas = document.createElement("canvas");
      this.lightContext = this.lightCanvas.getContext("2d");
    }
    if (this.lightCanvas.width !== this.viewWidthPx || this.lightCanvas.height !== this.viewHeightPx) {
      this.lightCanvas.width = this.viewWidthPx;
      this.lightCanvas.height = this.viewHeightPx;
    }
    return this.lightContext;
  }

  // A soft round glow: the colour at the centre fading to nothing at the edge.
  private lightSprite(color: string, radius: number): HTMLCanvasElement {
    const safeColor = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : "#ffd9a0";
    const key = `${safeColor}|${radius}`;
    let sprite = this.lightSprites.get(key);
    if (!sprite) {
      sprite = document.createElement("canvas");
      sprite.width = sprite.height = Math.max(1, Math.ceil(radius * 2));
      try {
        const context = sprite.getContext("2d");
        if (context) {
          const gradient = context.createRadialGradient(radius, radius, 0, radius, radius, radius);
          gradient.addColorStop(0, lightCoreColor(safeColor));
          for (const [distance, alpha] of LIGHT_FALLOFF_STOPS.slice(1)) {
            gradient.addColorStop(distance, withAlpha(safeColor, alpha));
          }
          context.fillStyle = gradient;
          context.fillRect(0, 0, sprite.width, sprite.height);
        }
      } catch {
        // Leave the sprite empty rather than break the frame.
      }
      this.lightSprites.set(key, sprite);
    }
    return sprite;
  }

  // Ambient colour plus darkened edges; only rebuilt when the view, theme, ambient or visible map edge changes.
  private lightBaseLayer(ambient: string, edgeColor: string, map: Rect): HTMLCanvasElement | null {
    const width = this.viewWidthPx;
    const height = this.viewHeightPx;
    const shapes = mapBoundaryShapes(map, { width, height });
    const mapKey = shapes.outside.length || shapes.bands.length || shapes.corners.length ? `${map.x},${map.y},${map.w},${map.h}` : "-";
    const key = `${width}x${height}|${ambient}|${edgeColor}|${mapKey}`;
    if (this.lightBase && this.lightBaseKey === key) return this.lightBase;
    this.lightBase ??= document.createElement("canvas");
    const base = this.lightBase;
    if (base.width !== width) base.width = width;
    if (base.height !== height) base.height = height;
    const context = base.getContext("2d");
    if (!context) return null;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, width, height);
    context.fillStyle = ambient;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "multiply";
    try {
      const edge = context.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.15,
        width / 2,
        height / 2,
        Math.hypot(width, height) * 0.5,
      );
      edge.addColorStop(0, withAlpha(edgeColor, 0));
      edge.addColorStop(1, edgeColor);
      context.fillStyle = edge;
      context.fillRect(0, 0, width, height);
      // Outside the map is near black; just inside, the shade eases into the ambient.
      const shade = voidColor(edgeColor);
      context.fillStyle = shade;
      for (const rect of shapes.outside) context.fillRect(rect.x, rect.y, rect.w, rect.h);
      for (const band of shapes.bands) {
        const fade = context.createLinearGradient(band.from.x, band.from.y, band.to.x, band.to.y);
        fade.addColorStop(0, shade);
        fade.addColorStop(1, withAlpha(shade, 0));
        context.fillStyle = fade;
        context.fillRect(band.rect.x, band.rect.y, band.rect.w, band.rect.h);
      }
      for (const corner of shapes.corners) {
        const fade = context.createRadialGradient(corner.center.x, corner.center.y, 0, corner.center.x, corner.center.y, corner.radius);
        fade.addColorStop(0, withAlpha(shade, 0));
        fade.addColorStop(1, shade);
        context.fillStyle = fade;
        context.fillRect(corner.rect.x, corner.rect.y, corner.rect.w, corner.rect.h);
      }
    } catch {
      // Keep just the ambient colour if the edge colour is unusable.
    }
    this.lightBaseKey = key;
    return base;
  }

  // Dims the view with the area's ambient colour and darkened edges, then lets lights cut through it.
  private drawLighting(world: Area, player: Position, camera: Position, presentation?: EntityPresentation): void {
    if (document.documentElement.dataset.highContrast === "true") return;
    const light = this.ensureLightCanvas();
    if (!light) return;
    const viewWidth = this.viewWidthPx;
    const viewHeight = this.viewHeightPx;
    const lighting = this.storyTheme.lighting;
    const map: Rect = {
      x: Math.round(-camera.x),
      y: Math.round(-camera.y),
      w: world.width * TILE_SIZE,
      h: world.height * TILE_SIZE,
    };
    const base = this.lightBaseLayer(effectiveAmbient(ambientFor(lighting, world.biome), areaHasLights(world)), lighting.edge, map);
    if (!base) return;
    const reduced = document.documentElement.dataset.reducedMotion === "true";
    const time = performance.now() / 1000;

    light.save();
    light.globalCompositeOperation = "copy";
    light.drawImage(base, 0, 0);

    // Keep lights out of the void beyond the map edge.
    light.beginPath();
    light.rect(map.x, map.y, map.w, map.h);
    light.clip();
    light.globalCompositeOperation = "lighter";
    this.lightPositions.clear();
    for (const [id, character] of presentation?.characters ?? []) this.lightPositions.set(id, { x: character.x, y: character.y });
    const sources: LightSource[] = collectLights(world, camera, { width: viewWidth, height: viewHeight }, this.lightPositions);
    sources.push({
      x: player.x - camera.x,
      y: player.y - camera.y - 4,
      color: "#fff1d6",
      radius: 36,
      intensity: 0.35,
      flicker: 0,
      phase: 0,
    });
    for (const source of sources) {
      const radius = Math.round(capLightRadius(source.radius, map.w, map.h));
      light.globalAlpha = Math.min(1, source.intensity * flickerFactor(time, source.phase, source.flicker, reduced));
      light.drawImage(this.lightSprite(source.color, radius), source.x - radius, source.y - radius);
    }
    light.restore();

    const context = this.context;
    context.save();
    context.globalCompositeOperation = "multiply";
    context.drawImage(this.lightCanvas!, 0, 0);
    context.restore();
  }

  // Dark veil with slow drifting fog banks; used while an area is loading.
  private drawFog(opacity: number): void {
    const context = this.context;
    const alpha = Math.min(1, opacity);
    context.fillStyle = `rgba(18, 30, 25, ${alpha})`;
    context.fillRect(0, 0, this.viewWidthPx, this.viewHeightPx);
    if (document.documentElement.dataset.reducedMotion === "true") return;
    const time = performance.now() / 1000;
    context.fillStyle = `rgba(205, 220, 212, ${0.12 * alpha})`;
    const banks = Math.max(7, Math.floor(this.viewHeightPx / 24));
    for (let index = 0; index < banks; index += 1) {
      const x = ((index * 83 + time * (8 + (index % 3) * 5)) % (this.viewWidthPx + 160)) - 80;
      const y = 14 + index * 24 + Math.sin(time * 0.7 + index) * 6;
      context.beginPath();
      context.ellipse(x, y, 70, 14, 0, 0, Math.PI * 2);
      context.fill();
    }
  }

  private drawPlayer(palette: PaletteName, x: number, y: number, direction: Direction, moving: boolean, sprite?: SpriteSpec): void {
    const frame = moving && document.documentElement.dataset.reducedMotion !== "true"
      ? Math.floor(performance.now() / 180)
      : 0;
    if (sprite) {
      this.context.drawImage(getSpriteCanvas(sprite, direction, frame % 4), x - 8, y - 16);
      return;
    }
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

  // The label is DOM text so it stays sharp at any display scale.
  private showLabel(name: string, anchorX: number, topY: number): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const label = this.label ?? this.createLabel(parent);
    if (label.textContent !== name) label.textContent = name;
    const view = this.viewOnPage(parent);
    if (!view) return;
    const { scale, originX, originY, left: visibleLeft, right: visibleRight, top: visibleTop } = view;
    const width = label.offsetWidth;
    const height = label.offsetHeight;
    const minX = visibleLeft + 4;
    const maxX = visibleRight - width - 4;
    const left = Math.max(minX, Math.min(Math.max(minX, maxX), originX + anchorX * scale - width / 2));
    const top = Math.max(visibleTop + 2, originY + topY * scale - height - 4 * scale);
    label.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    label.style.visibility = "visible";
  }

  // Where the view sits inside the element that holds the DOM labels, how much it is enlarged,
  // and the part of it that is actually visible (the canvas can overhang its container by a fraction of a world pixel).
  private viewOnPage(parent: HTMLElement): {
    scale: number;
    originX: number;
    originY: number;
    left: number;
    right: number;
    top: number;
  } | null {
    const canvasRect = this.canvas.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const scale = canvasRect.width / this.viewWidthPx;
    if (!(scale > 0)) return null;
    const originX = canvasRect.left - parentRect.left;
    const originY = canvasRect.top - parentRect.top;
    return {
      scale,
      originX,
      originY,
      left: Math.max(originX, 0),
      right: Math.min(originX + canvasRect.width, parentRect.width),
      top: Math.max(originY, 0),
    };
  }

  // A small sign above every door in view, so the player can see where it leads without walking up to it.
  private showDoorSigns(signs: readonly DoorSign[], camera: Position): void {
    const parent = this.canvas.parentElement;
    const view = parent && signs.length > 0 ? this.viewOnPage(parent) : null;
    let used = 0;
    if (parent && view) {
      const { scale, originX, originY, left: visibleLeft, right: visibleRight, top: visibleTop } = view;
      for (const sign of signs) {
        const doorX = sign.x * TILE_SIZE - camera.x;
        const doorY = sign.y * TILE_SIZE - camera.y;
        if (doorX <= -TILE_SIZE || doorY <= -TILE_SIZE || doorX >= this.viewWidthPx || doorY >= this.viewHeightPx) continue;
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
        const minX = visibleLeft + 2;
        const maxX = visibleRight - label.width - 2;
        const left = Math.max(minX, Math.min(Math.max(minX, maxX), originX + (doorX + TILE_SIZE / 2) * scale - label.width / 2));
        const top = Math.max(visibleTop + 2, originY + doorY * scale - label.height - 2 * scale);
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

  // Takes the DOM labels off the page and stops following the container when the game ends.
  removeLabels(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("resize", this.fitToContainer);
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
    const viewWidth = this.viewWidthPx;
    const viewHeight = this.viewHeightPx;
    if (world.palette === "underwater") {
      context.fillStyle = "rgba(40, 150, 165, 0.14)";
      context.fillRect(0, 0, viewWidth, viewHeight);
    }

    if (document.documentElement.dataset.reducedMotion === "true") return;
    if (world.biome === "meadow" || world.biome === "village" || world.biome === "forest") {
      const time = performance.now() / 1000;
      context.fillStyle = PALETTES[world.palette].highlight;
      const specks = this.ambientCount(5);
      for (let index = 0; index < specks; index += 1) {
        const x = ((index * 67 + time * (4 + index % 3 * 2)) % (viewWidth + 12)) - 6;
        const y = 24 + (index * 37) % (viewHeight - 32) + Math.sin(time + index) * 2;
        context.globalAlpha = 0.35 + (Math.sin(time * 1.4 + index) + 1) * 0.12;
        context.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
      context.globalAlpha = 1;
    }
  }

  private drawStoryAtmosphere(context: CanvasRenderingContext2D): void {
    if (document.documentElement.dataset.reducedMotion === "true") return;
    const time = performance.now() / 1000;
    const viewWidth = this.viewWidthPx;
    const viewHeight = this.viewHeightPx;
    context.save();
    context.fillStyle = this.storyTheme.particle;
    const particles = this.ambientCount(8);
    for (let index = 0; index < particles; index += 1) {
      const x = (index * 47 + Math.sin(time * 0.18 + index * 1.7) * 18 + viewWidth) % viewWidth;
      const drift = this.storyTheme.atmosphere === "falling-ash" ? time * (4 + index % 4) : time * 2;
      const y = (index * 29 + drift + Math.sin(time * 0.5 + index) * 4) % viewHeight;
      const size = this.storyTheme.atmosphere === "tide-glow" && index % 3 === 0 ? 2 : 1;
      context.globalAlpha = this.storyTheme.atmosphere === "falling-ash"
        ? 0.24
        : 0.35 + (Math.sin(time * 1.2 + index) + 1) * 0.2;
      context.fillRect(Math.round(x), Math.round(y), size, size);
    }
    context.restore();
  }
}

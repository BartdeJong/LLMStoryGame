import {
  BODY_SHAPES,
  CHARACTER_FEATURES,
  DIRECTIONS,
  ICON_SHAPES,
  PALETTE_COLOR_SLOTS,
  PALETTE_NAMES,
  FLOOR_ART_STYLES,
  RUG_EDGE,
  TILE_TYPES,
  WALL_ART_STYLES,
  WALK_FRAME_COUNTS,
  getCharacterSprite,
  getIconCanvas,
  getTileCanvas,
  type CharacterRecipe,
  type Direction,
  type IconRecipe,
} from "./index";
import { createSeededRandom } from "./random";
import { SPRITE_HEIGHT, SPRITE_WIDTH, getSpriteCanvas } from "./characterSprites";
import type { SpriteSpec } from "./spriteSpec";
import { loadStoryIndex, loadStoryPack } from "../story/loader";
import { Renderer } from "../renderer";
import type { Area, FloorStyle, WallStyle } from "../world/types";
import { parseAreaMap } from "../world/mapLegend";

interface SpritePreview {
  readonly canvas: HTMLCanvasElement;
  readonly recipe: CharacterRecipe;
  readonly palette: (typeof PALETTE_NAMES)[number];
}

function choose<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)]!;
}

function makePreviewCanvas(label: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  return canvas;
}

function drawPreview(canvas: HTMLCanvasElement, source: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create an art preview context.");
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, 16, 16);
  context.drawImage(source, 0, 0);
}

const SAMPLE_ROOM = [
  "##############",
  "##############",
  "#............#",
  "#.CCCC.......#",
  "#........RRR.#",
  "#........RRR.#",
  "#........RRR.#",
  "#............#",
  "#............#",
  "######1#######",
];

function sampleRoom(palette: (typeof PALETTE_NAMES)[number], floor: FloorStyle, wall: WallStyle): Area {
  const map = parseAreaMap(SAMPLE_ROOM);
  const door = map.doorSlots.get(1)!;
  return {
    id: `debug-${palette}`,
    seed: 1,
    name: palette,
    biome: "building",
    mood: "",
    palette,
    width: map.width,
    height: map.height,
    layers: map.layers,
    entry: { x: 3, y: 7 },
    spawnPoints: [],
    doors: [{ id: "door", label: "Out", kind: "hatch", x: door.x, y: door.y }],
    style: { floor, wall },
    decor: [
      { icon: "bookshelf", x: 2, y: 2 },
      { icon: "grandfather_clock", x: 11, y: 2 },
      { icon: "lamp_stand", x: 10, y: 8 },
      { icon: "table", x: 5, y: 6 },
    ],
  };
}

function mountRoomPreviews(container: HTMLElement): void {
  const addGrid = (title: string, tiles: readonly (readonly [string, HTMLCanvasElement])[]): void => {
    const heading = document.createElement("h3");
    heading.textContent = title;
    const grid = document.createElement("div");
    grid.className = "art-tile-grid";
    for (const [name, source] of tiles) {
      const card = document.createElement("figure");
      card.className = "art-preview";
      const canvas = makePreviewCanvas(name);
      drawPreview(canvas, source);
      const label = document.createElement("figcaption");
      label.textContent = name;
      card.append(canvas, label);
      grid.append(card);
    }
    container.append(heading, grid);
  };
  for (const palette of ["cottage", "kitchen", "parlour", "london", "park", "underwater"] as const) {
    addGrid(`${palette}: floors, wall tops, wall faces, rug, counter`, [
      ...FLOOR_ART_STYLES.map((style) => [style, getTileCanvas(palette, `floor-${style}`, 3)] as const),
      ...WALL_ART_STYLES.map((style) => [`top ${style}`, getTileCanvas(palette, `wall-top-${style}`, 3)] as const),
      ...WALL_ART_STYLES.map((style) => [`face ${style}`, getTileCanvas(palette, `wall-face-${style}`, 3)] as const),
      ["rug", getTileCanvas(palette, "rug", 0, 0, RUG_EDGE.north | RUG_EDGE.east | RUG_EDGE.south | RUG_EDGE.west)],
      ["counter", getTileCanvas(palette, "counter", 3)],
      ["hatch", getTileCanvas(palette, "hatch", 3)],
    ]);
  }

  const rooms = document.createElement("div");
  rooms.className = "art-sample-rooms";
  rooms.style.cssText = "display:flex;flex-wrap:wrap;gap:12px";
  container.append(rooms);
  const combos = [
    ["cottage", "boards", "plaster"],
    ["kitchen", "tiles", "plaster"],
    ["parlour", "carpet", "wood"],
    ["shop", "boards", "wood"],
    ["workshop", "flagstone", "brick"],
    ["office", "carpet", "plaster"],
    ["london", "cobble", "brick"],
    ["lighthouse", "deck", "stone"],
    ["underwater", "sand", "rock"],
    ["park", "grass", "hedge"],
    ["market", "cobble", "fence"],
    ["cave", "dirt", "rock"],
  ] as const;
  const live: { renderer: Renderer; area: Area }[] = [];
  for (const [palette, floor, wall] of combos) {
    const frame = document.createElement("div");
    frame.style.cssText = "position:relative;width:640px;height:440px;overflow:hidden";
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    frame.append(canvas);
    const caption = document.createElement("div");
    caption.textContent = `${palette} / ${floor} / ${wall}`;
    caption.style.cssText = "position:absolute;left:4px;top:2px;font:11px monospace;color:#fff;z-index:2;text-shadow:0 0 2px #000";
    frame.append(caption);
    rooms.append(frame);
    const renderer = new Renderer(canvas, "debug");
    canvas.style.filter = "none";
    live.push({ renderer, area: sampleRoom(palette, floor, wall) });
  }
  const tick = (): void => {
    for (const { renderer, area } of live) {
      const camera = {
        x: (area.width * 16 - renderer.viewWidth) / 2,
        y: (area.height * 16 - renderer.viewHeight) / 2,
      };
      renderer.draw(area, { x: 3 * 16 + 8, y: 7 * 16 + 8 }, camera);
    }
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
}

interface CastPreview {
  readonly spec: SpriteSpec;
  readonly walker: HTMLCanvasElement;
}

function paintSprite(canvas: HTMLCanvasElement, spec: SpriteSpec, direction: Direction, pose: number): void {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create an art preview context.");
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, SPRITE_WIDTH, SPRITE_HEIGHT);
  context.drawImage(getSpriteCanvas(spec, direction, pose), 0, 0);
}

function spriteCanvas(label: string, scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_WIDTH;
  canvas.height = SPRITE_HEIGHT;
  canvas.style.width = `${SPRITE_WIDTH * scale}px`;
  canvas.style.height = `${SPRITE_HEIGHT * scale}px`;
  canvas.style.imageRendering = "pixelated";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  return canvas;
}

// Every story's player and cast side by side, so the sprites can be reviewed together.
const castPreviews: CastPreview[] = [];
const castScale = Math.max(1, Math.min(8, Number(new URLSearchParams(window.location.search).get("scale")) || 3));

async function mountCastPreviews(container: HTMLElement): Promise<void> {
  const index = await loadStoryIndex();
  for (const entry of index.stories) {
    const pack = await loadStoryPack(entry.id);
    const group = document.createElement("div");
    group.className = "art-palette-group";
    const heading = document.createElement("h3");
    heading.textContent = `${pack.identity.title} (${pack.cast.length} characters + player)`;
    const grid = document.createElement("div");
    grid.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;";
    const people: { name: string; note: string; spec: SpriteSpec | undefined }[] = [
      { name: `${pack.identity.player?.name ?? "Player"} (player)`, note: pack.identity.player?.species ?? "", spec: pack.identity.player?.sprite },
      ...pack.cast.map((member) => ({ name: member.name, note: member.species, spec: member.sprite })),
    ];
    for (const person of people) {
      const card = document.createElement("figure");
      card.className = "art-preview";
      card.style.cssText = "margin:0;padding:6px;";
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:4px;align-items:flex-end;";
      const label = document.createElement("figcaption");
      label.textContent = `${person.name} · ${person.note}`;
      if (person.spec) {
        for (const direction of DIRECTIONS) {
          const canvas = spriteCanvas(`${person.name} facing ${direction}`, castScale);
          paintSprite(canvas, person.spec, direction, 0);
          row.append(canvas);
        }
        const walker = spriteCanvas(`${person.name} walking`, castScale);
        row.append(walker);
        castPreviews.push({ spec: person.spec, walker });
      } else label.textContent += " · NO SPRITE";
      card.append(row, label);
      grid.append(card);
    }
    group.append(heading, grid);
    container.append(group);
  }
}

export function mountArtDebugScreen(): void {
  document.documentElement.classList.add("art-debug-mode");
  document.body.classList.add("art-debug-mode");
  document.querySelector("#game-shell")?.remove();

  const shell = document.createElement("main");
  shell.className = "art-debug-shell";
  shell.innerHTML = `
    <header class="art-debug-header">
      <a href="./" class="art-debug-back">Back to game</a>
      <h1>Art painter</h1>
      <p>Procedural 16 × 16 art · deterministic palette recipes</p>
    </header>
    <section aria-labelledby="rooms-heading">
      <h2 id="rooms-heading">Rooms: floor styles, wall tops and faces, sample room</h2>
      <div class="art-room-list"></div>
    </section>
    <section aria-labelledby="tiles-heading">
      <h2 id="tiles-heading">Tiles by palette</h2>
      <div class="art-palette-list"></div>
    </section>
    <section aria-labelledby="characters-heading">
      <h2 id="characters-heading">40 walking character recipes</h2>
      <div class="art-character-grid"></div>
    </section>
    <section aria-labelledby="cast-heading">
      <h2 id="cast-heading">Cast: every story's player and characters (down, up, left, right, walking)</h2>
      <div class="art-cast-list"></div>
    </section>
    <section aria-labelledby="icons-heading">
      <h2 id="icons-heading">Item icons</h2>
      <div class="art-icon-grid"></div>
    </section>`;
  document.body.append(shell);
  // ?debug=art&section=cast shows one section only (rooms, tiles, characters, cast, icons).
  const only = new URLSearchParams(window.location.search).get("section");
  if (only) {
    for (const section of shell.querySelectorAll("section[aria-labelledby]")) {
      if (section.getAttribute("aria-labelledby") !== `${only}-heading`) (section as HTMLElement).style.display = "none";
    }
  }

  const palettesContainer = shell.querySelector<HTMLElement>(".art-palette-list");
  const charactersContainer = shell.querySelector<HTMLElement>(".art-character-grid");
  const iconsContainer = shell.querySelector<HTMLElement>(".art-icon-grid");
  if (!palettesContainer || !charactersContainer || !iconsContainer) {
    throw new Error("The art debug screen is missing a preview grid.");
  }

  for (const [paletteIndex, paletteName] of PALETTE_NAMES.entries()) {
    const group = document.createElement("div");
    group.className = "art-palette-group";
    const heading = document.createElement("h3");
    heading.textContent = paletteName;
    group.append(heading);
    const grid = document.createElement("div");
    grid.className = "art-tile-grid";
    for (const [tileIndex, tile] of TILE_TYPES.entries()) {
      const card = document.createElement("figure");
      card.className = "art-preview";
      const canvas = makePreviewCanvas(`${paletteName} ${tile} tile`);
      drawPreview(canvas, getTileCanvas(paletteName, tile, paletteIndex * 100 + tileIndex));
      const label = document.createElement("figcaption");
      label.textContent = tile;
      card.append(canvas, label);
      grid.append(card);
    }
    group.append(grid);
    palettesContainer.append(group);
  }

  const roomsContainer = shell.querySelector<HTMLElement>(".art-room-list");
  if (roomsContainer) mountRoomPreviews(roomsContainer);

  const random = createSeededRandom("art-debug-recipes");
  const sprites: SpritePreview[] = [];
  for (let index = 0; index < 40; index += 1) {
    const recipe: CharacterRecipe = {
      body: choose(BODY_SHAPES, random),
      bodyColor: choose(PALETTE_COLOR_SLOTS, random),
      accentColor: choose(PALETTE_COLOR_SLOTS, random),
      skinColor: choose(PALETTE_COLOR_SLOTS, random),
      feature: choose(CHARACTER_FEATURES, random),
      walkFrames: choose(WALK_FRAME_COUNTS, random),
    };
    const palette = choose(PALETTE_NAMES, random);
    const card = document.createElement("figure");
    card.className = "art-preview art-character-preview";
    const canvas = makePreviewCanvas(`${recipe.body} character with ${recipe.feature}`);
    const label = document.createElement("figcaption");
    label.textContent = `${recipe.body} · ${recipe.feature}`;
    card.append(canvas, label);
    charactersContainer.append(card);
    sprites.push({ canvas, recipe, palette });
  }

  const castContainer = shell.querySelector<HTMLElement>(".art-cast-list");
  if (castContainer) void mountCastPreviews(castContainer);

  const icons: IconRecipe[] = ICON_SHAPES.map((shape, index) => ({
    shape,
    primaryColor: PALETTE_COLOR_SLOTS[index % PALETTE_COLOR_SLOTS.length]!,
    secondaryColor: PALETTE_COLOR_SLOTS[(index + 5) % PALETTE_COLOR_SLOTS.length]!,
  }));
  for (const recipe of icons) {
    const card = document.createElement("figure");
    card.className = "art-preview";
    const canvas = makePreviewCanvas(`${recipe.shape} item icon`);
    drawPreview(canvas, getIconCanvas(recipe, "meadow"));
    const label = document.createElement("figcaption");
    label.textContent = recipe.shape;
    card.append(canvas, label);
    iconsContainer.append(card);
  }

  let lastFrame = 0;
  const animate = (timestamp: number): void => {
    if (timestamp - lastFrame >= 190) {
      lastFrame = timestamp;
      const directionIndex = Math.floor(timestamp / 760) % DIRECTIONS.length;
      const direction: Direction = DIRECTIONS[directionIndex] ?? "down";
      const frame = Math.floor(timestamp / 190);
      for (const sprite of sprites) {
        drawPreview(sprite.canvas, getCharacterSprite(sprite.recipe, sprite.palette, direction, frame));
      }
      for (const preview of castPreviews) paintSprite(preview.walker, preview.spec, direction, frame);
    }
    window.requestAnimationFrame(animate);
  };
  window.requestAnimationFrame(animate);
}

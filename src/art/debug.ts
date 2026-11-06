import {
  BODY_SHAPES,
  CHARACTER_FEATURES,
  DIRECTIONS,
  ICON_SHAPES,
  PALETTE_COLOR_SLOTS,
  PALETTE_NAMES,
  TILE_TYPES,
  WALK_FRAME_COUNTS,
  getCharacterSprite,
  getIconCanvas,
  getTileCanvas,
  type CharacterRecipe,
  type Direction,
  type IconRecipe,
} from "./index";
import { createSeededRandom } from "./random";

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
    <section aria-labelledby="tiles-heading">
      <h2 id="tiles-heading">Tiles by palette</h2>
      <div class="art-palette-list"></div>
    </section>
    <section aria-labelledby="characters-heading">
      <h2 id="characters-heading">40 walking character recipes</h2>
      <div class="art-character-grid"></div>
    </section>
    <section aria-labelledby="icons-heading">
      <h2 id="icons-heading">Item icons</h2>
      <div class="art-icon-grid"></div>
    </section>`;
  document.body.append(shell);

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
    }
    window.requestAnimationFrame(animate);
  };
  window.requestAnimationFrame(animate);
}

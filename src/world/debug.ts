import { getTileCanvas, type TileType } from "../art";
import { PLACEHOLDER_BRIEFS } from "./briefs";
import { generateArea } from "./generators";
import type { Area, Biome } from "./types";
import { Tile } from "./types";

const BIOMES: readonly Biome[] = ["meadow", "forest", "shore", "cave", "building", "ruins", "village"];
const ART_TILE: Record<Tile, TileType> = {
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

function drawArea(canvas: HTMLCanvasElement, area: Area): void {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create a world preview context.");
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / area.width, canvas.height / area.height);
  for (let y = 0; y < area.height; y += 1) {
    for (let x = 0; x < area.width; x += 1) {
      const ground = area.layers.ground[y]![x]!;
      context.drawImage(getTileCanvas(area.palette, ART_TILE[ground], `${area.seed}:${x}:${y}`), x * scale, y * scale, scale, scale);
      const feature = area.layers.feature[y]![x]!;
      if (feature !== Tile.Grass) {
        context.drawImage(getTileCanvas(area.palette, ART_TILE[feature], `${area.seed}:${x}:${y}`), x * scale, y * scale, scale, scale);
      }
    }
  }
}

export function mountWorldDebugScreen(): void {
  document.documentElement.classList.add("world-debug-mode");
  document.body.classList.add("world-debug-mode");
  document.querySelector("#game-shell")?.remove();

  const shell = document.createElement("main");
  shell.className = "world-debug-shell";
  shell.innerHTML = `
    <header class="world-debug-header">
      <a href="./" class="world-debug-back">Back to game</a>
      <h1>World generator</h1>
      <p>Regenerate deterministic placeholder areas by biome and seed.</p>
    </header>
    <form class="world-debug-controls">
      <label>Biome <select name="biome"></select></label>
      <label>Seed <input name="seed" value="2026" autocomplete="off"></label>
      <button type="submit">Generate area</button>
    </form>
    <p class="world-debug-summary" aria-live="polite"></p>
    <canvas class="world-debug-canvas" width="640" height="384" aria-label="Generated world preview"></canvas>`;
  document.body.append(shell);

  const form = shell.querySelector<HTMLFormElement>("form");
  const select = shell.querySelector<HTMLSelectElement>('select[name="biome"]');
  const seedInput = shell.querySelector<HTMLInputElement>('input[name="seed"]');
  const summary = shell.querySelector<HTMLElement>(".world-debug-summary");
  const canvas = shell.querySelector<HTMLCanvasElement>("canvas");
  if (!form || !select || !seedInput || !summary || !canvas) {
    throw new Error("The world debug screen is missing required controls.");
  }

  for (const biome of BIOMES) {
    const option = document.createElement("option");
    option.value = biome;
    option.textContent = biome;
    select.append(option);
  }

  const generate = (): void => {
    const biome = select.value as Biome;
    const area = generateArea(seedInput.value, PLACEHOLDER_BRIEFS[biome]);
    drawArea(canvas, area);
    summary.textContent = `${area.name} · ${area.biome} · seed ${String(area.seed)} · ${area.doors.length} doors · ${area.spawnPoints.length} spawn points`;
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    generate();
  });
  generate();
}

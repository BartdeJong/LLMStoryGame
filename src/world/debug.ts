import { PALETTE_NAMES } from "../art/palettes";
import { parseAreaMap } from "./mapLegend";
import { Tile } from "./types";
import { Renderer } from "../renderer";
import { buildPackArea } from "../story/packArea";
import { getLengthView, loadStoryPack } from "../story/loader";
import type { AuthoredArea, StoryPack } from "../story/types";

// `?debug=world`: a viewer for the areas baked into the story packs (public/stories/*.json).
const GROUND: Partial<Record<Tile, string>> = {
  [Tile.Grass]: "#6aa84f", [Tile.Path]: "#c9a66b", [Tile.Water]: "#3d85c6", [Tile.Floor]: "#b8a27a",
  [Tile.Bridge]: "#8b5a2b", [Tile.Rug]: "#a33a3a", [Tile.Void]: "#111111", [Tile.Door]: "#e6b800",
};
const FEATURE: Partial<Record<Tile, string>> = {
  [Tile.Tree]: "#274e13", [Tile.Wall]: "#4a4a58", [Tile.Rock]: "#777777", [Tile.Flowers]: "#e06666",
  [Tile.Counter]: "#7f5539", [Tile.Door]: "#e6b800",
};

interface PackLocation { id: string; name: string; area?: AuthoredArea }

function drawMap(canvas: HTMLCanvasElement, area: AuthoredArea): void {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create a world preview context.");
  const parsed = parseAreaMap(area.map);
  const scale = Math.min(canvas.width / parsed.width, canvas.height / parsed.height);
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < parsed.height; y += 1) {
    for (let x = 0; x < parsed.width; x += 1) {
      context.fillStyle = GROUND[parsed.layers.ground[y]![x]!] ?? "#000000";
      context.fillRect(x * scale, y * scale, scale, scale);
      const feature = FEATURE[parsed.layers.feature[y]![x]!];
      if (feature) {
        context.fillStyle = feature;
        context.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
  context.fillStyle = "#ffffff";
  for (const item of area.decor) context.fillRect(item.x * scale + scale / 4, item.y * scale + scale / 4, scale / 2, scale / 2);
  context.fillStyle = "#ff00ff";
  for (const [x, y] of Object.values(area.placements)) context.fillRect(x * scale + scale / 4, y * scale + scale / 4, scale / 2, scale / 2);
}

// `?debug=world&art=1`: draws baked areas with the real Renderer (tiles, decor, story things), whole area in one view.
// `&story=<id>&loc=<id>[,<id>...]` picks areas, `&all=1` draws every area of the story (add `&outdoor=1` to skip rooms).
function drawArtArea(pack: StoryPack, locationId: string, zoom: number): HTMLElement | undefined {
  const lengths = Object.keys(pack.lengths) as ("short" | "medium" | "long")[];
  const view = getLengthView(pack, lengths[lengths.length - 1]!);
  let built;
  try { built = buildPackArea(pack, view, locationId); } catch { return undefined; }
  const { area } = built;
  const frame = document.createElement("figure");
  frame.style.cssText = "margin:0 0 12px;display:inline-block;vertical-align:top;margin-right:12px";
  const caption = document.createElement("figcaption");
  caption.style.cssText = "font:12px monospace;color:#f5f0d7";
  caption.textContent = `${pack.identity.id}/${locationId} · ${area.name} · ${area.palette} ${area.style?.floor}/${area.style?.wall}`;
  const holder = document.createElement("div");
  holder.style.cssText = `position:relative;width:${area.width * 16 * zoom}px;height:${area.height * 16 * zoom}px;overflow:hidden`;
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  holder.append(canvas);
  frame.append(caption, holder);
  document.body.append(frame);
  const renderer = new Renderer(canvas, pack.identity.id);
  // Debug only: the renderer normally sizes itself to the window; here it covers the whole area at a fixed zoom.
  const hack = renderer as unknown as { resizeObserver?: ResizeObserver; viewWidthPx: number; viewHeightPx: number; context: CanvasRenderingContext2D };
  hack.resizeObserver?.disconnect();
  const paint = (): void => {
    // A window resize event makes the renderer refit itself, so the size is set again before every draw.
    canvas.width = area.width * 16;
    canvas.height = area.height * 16;
    hack.viewWidthPx = canvas.width;
    hack.viewHeightPx = canvas.height;
    canvas.style.width = `${canvas.width * zoom}px`;
    canvas.style.height = `${canvas.height * zoom}px`;
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.filter = "none";
    hack.context.imageSmoothingEnabled = false;
    try { renderer.draw(area, { x: -100, y: -100 }, { x: 0, y: 0 }); } catch (error) { caption.textContent += ` ERROR ${String(error)}`; }
  };
  paint();
  let frames = 0;
  const loop = (): void => { paint(); frames += 1; if (frames < 600) window.requestAnimationFrame(loop); };
  window.requestAnimationFrame(loop);
  return frame;
}

function mountArtWorld(): void {
  const params = new URLSearchParams(window.location.search);
  const storyIds = params.get("story") ? [params.get("story")!] : ["example", "paddingtonhat", "holmesashenvelope", "lanterntide"];
  const zoom = Number(params.get("zoom") ?? "1");
  const only = params.get("loc");
  const outdoorOnly = params.get("outdoor") === "1";
  document.documentElement.classList.add("world-debug-mode");
  document.body.classList.add("world-debug-mode");
  document.body.style.background = "#17251d";
  document.querySelector("#game-shell")?.remove();
  void (async () => {
    for (const id of storyIds) {
      const pack = await loadStoryPack(id);
      for (const location of pack.locations) {
        if (only && !only.split(",").includes(location.id)) continue;
        if (outdoorOnly && location.area?.biome === "building") continue;
        drawArtArea(pack, location.id, zoom);
      }
    }
    document.body.dataset.ready = "1";
  })();
}

export function mountWorldDebugScreen(): void {
  if (new URLSearchParams(window.location.search).get("art") === "1") {
    mountArtWorld();
    return;
  }
  document.documentElement.classList.add("world-debug-mode");
  document.body.classList.add("world-debug-mode");
  document.querySelector("#game-shell")?.remove();

  const shell = document.createElement("main");
  shell.className = "world-debug-shell";
  shell.innerHTML = `
    <header class="world-debug-header">
      <a href="./" class="world-debug-back">Back to game</a>
      <h1>Baked areas</h1>
      <p>Maps baked into the story packs (npm run bake-areas). White squares are decor, pink squares are story things.</p>
    </header>
    <form class="world-debug-controls">
      <label>Story <select name="story"></select></label>
      <label>Location <select name="location"></select></label>
    </form>
    <p class="world-debug-summary" aria-live="polite"></p>
    <canvas class="world-debug-canvas" width="640" height="384" aria-label="Baked area preview"></canvas>`;
  document.body.append(shell);

  const story = shell.querySelector<HTMLSelectElement>('select[name="story"]');
  const location = shell.querySelector<HTMLSelectElement>('select[name="location"]');
  const summary = shell.querySelector<HTMLElement>(".world-debug-summary");
  const canvas = shell.querySelector<HTMLCanvasElement>("canvas");
  if (!story || !location || !summary || !canvas) throw new Error("The world debug screen is missing required controls.");

  let locations: PackLocation[] = [];
  const show = (): void => {
    const chosen = locations.find((item) => item.id === location.value);
    if (!chosen?.area) {
      summary.textContent = "This location has no baked area yet.";
      return;
    }
    drawMap(canvas, chosen.area);
    const palette = (PALETTE_NAMES as readonly string[]).includes(chosen.area.palette) ? chosen.area.palette : "?";
    summary.textContent = `${chosen.name} · ${chosen.area.biome} · ${palette} · ${chosen.area.floor}/${chosen.area.wall} · ${chosen.area.doors.length} doors`;
  };
  const load = async (): Promise<void> => {
    const response = await fetch(`${import.meta.env.BASE_URL}stories/${story.value}.json`);
    const pack = await response.json() as { locations: PackLocation[] };
    locations = pack.locations;
    location.replaceChildren(...locations.map((item) => new Option(item.name, item.id)));
    show();
  };
  void fetch(`${import.meta.env.BASE_URL}stories/index.json`).then((response) => response.json()).then((index: { stories: { id: string }[] }) => {
    story.replaceChildren(...index.stories.map((item) => new Option(item.id, item.id)));
    return load();
  });
  story.addEventListener("change", () => { void load(); });
  location.addEventListener("change", show);
}

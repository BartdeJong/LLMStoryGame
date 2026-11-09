import { PALETTE_NAMES } from "../palettes";
import { loadStoryPack } from "../../story/loader";
import type { StoryPack } from "../../story/types";
import {
  GLYPH_CATALOG,
  GLYPH_CATEGORIES,
  GLYPH_MATERIALS,
  GLYPH_STATES,
  type GlyphMaterial,
  type GlyphState,
} from "./catalog";
import { resolveVisual } from "./matcher";
import { renderGlyph } from "./render";
import { getVisualCanvas } from "./legacy";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

function preview(source: HTMLCanvasElement, label: string, background: "light" | "dark", scale: 1 | 6): HTMLElement {
  const cell = node("div", `glyph-preview-${background}`);
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  canvas.setAttribute("aria-label", label);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create a glyph preview context.");
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0);
  canvas.style.width = `${16 * scale}px`;
  canvas.style.height = `${16 * scale}px`;
  const caption = node("small", "glyph-preview-caption");
  caption.textContent = `${scale}x · ${background}`;
  cell.append(canvas, caption);
  return cell;
}

export function mountGlyphDebugScreen(): void {
  document.documentElement.classList.add("glyph-debug-mode");
  document.body.classList.add("glyph-debug-mode");
  const root = node("main", "glyph-debug-shell");
  const title = node("h1", "glyph-debug-title");
  title.textContent = "Object glyph catalog";
  const controls = node("section", "glyph-debug-controls");
  const category = node("select", "glyph-filter-category");
  const allCategories = document.createElement("option");
  allCategories.value = "";
  allCategories.textContent = "All categories";
  category.append(allCategories);
  for (const value of GLYPH_CATEGORIES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    category.append(option);
  }
  const tag = node("input", "glyph-filter-tag");
  tag.placeholder = "Filter by tag";
  tag.setAttribute("aria-label", "Filter by tag");
  const palette = node("select", "glyph-filter-palette");
  for (const value of PALETTE_NAMES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    palette.append(option);
  }
  const variants = document.createElement("label");
  const variantToggle = document.createElement("input");
  variantToggle.type = "checkbox";
  variants.append(variantToggle, document.createTextNode(" Show material variants"));
  const accent = node("select", "glyph-filter-accent");
  const accents = [
    ["", "Palette accent"], ["#d64b45", "Red"], ["#528bc2", "Blue"], ["#6d9b57", "Green"],
    ["#d6aa42", "Gold"], ["#9b6fbc", "Purple"],
  ];
  for (const [value, label] of accents) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    accent.append(option);
  }
  const states = node("fieldset", "glyph-state-toggles");
  const legend = document.createElement("legend");
  legend.textContent = "States";
  states.append(legend);
  const stateInputs = new Map<GlyphState, HTMLInputElement>();
  for (const state of GLYPH_STATES) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    stateInputs.set(state, input);
    label.append(input, document.createTextNode(` ${state}`));
    states.append(label);
  }
  controls.append(category, tag, palette, variants, accent, states);
  const list = node("section", "glyph-debug-grid");
  root.append(title, controls, list);
  document.body.replaceChildren(root);

  const draw = (): void => {
    list.replaceChildren();
    const needle = tag.value.trim().toLocaleLowerCase();
    const selectedPalette = PALETTE_NAMES.find((name) => name === palette.value);
    if (!selectedPalette) throw new Error(`Unknown glyph preview palette "${palette.value}".`);
    for (const groupName of GLYPH_CATEGORIES) {
      if (category.value && groupName !== category.value) continue;
      const glyphs = GLYPH_CATALOG.filter((glyph) => glyph.category === groupName
        && (!needle || glyph.tags.some((entry) => entry.includes(needle))));
      if (glyphs.length === 0) continue;
      const group = node("section", "glyph-category-group");
      const groupHeading = node("h2", "glyph-category-heading");
      groupHeading.textContent = groupName;
      const grid = node("div", "glyph-debug-grid");
      for (const glyph of glyphs) {
        const card = node("article", "glyph-debug-card");
        const heading = node("h3", "glyph-debug-name");
        heading.textContent = `${glyph.name} · ${glyph.id}`;
        const keywords = node("p", "glyph-debug-tags");
        keywords.textContent = `${glyph.name} · ${glyph.tags.join(", ")}`;
        const previews = node("div", "glyph-debug-previews");
        const materials: readonly GlyphMaterial[] = variantToggle.checked ? GLYPH_MATERIALS : [glyph.material];
        const selectedStates = GLYPH_STATES.filter((state) => stateInputs.get(state)?.checked);
        for (const material of materials) {
          const source = renderGlyph(glyph, {
            palette: selectedPalette,
            material,
            accent: accent.value || undefined,
            states: selectedStates,
          });
          for (const background of ["light", "dark"] as const) {
            previews.append(preview(source, `${glyph.name} ${material}`, background, 1));
            previews.append(preview(source, `${glyph.name} ${material}`, background, 6));
          }
        }
        card.append(heading, keywords, previews);
        grid.append(card);
      }
      group.append(groupHeading, grid);
      list.append(group);
    }
  };
  for (const input of [category, tag, palette, variantToggle, accent, ...stateInputs.values()]) {
    input.addEventListener("input", draw);
    input.addEventListener("change", draw);
  }
  draw();
}

export async function mountStoryVisualDebugScreen(storyId: string): Promise<void> {
  document.documentElement.classList.add("glyph-debug-mode");
  document.body.classList.add("glyph-debug-mode");
  const root = node("main", "glyph-debug-shell");
  const title = node("h1", "glyph-debug-title");
  title.textContent = `Story visuals · ${storyId}`;
  root.append(title);
  document.body.replaceChildren(root);
  try {
    const pack = await loadStoryPack(storyId);
    const list = node("section", "story-visual-debug-list");
    root.append(list);
    appendStoryVisuals(list, pack);
  } catch (error) {
    const message = node("p", "glyph-debug-error");
    message.textContent = error instanceof Error ? error.message : String(error);
    root.append(message);
  }
}

function appendStoryVisuals(container: HTMLElement, pack: StoryPack): void {
  const entries = [
    ...pack.items.map((item) => ({ name: item.name, description: item.description, visual: item.visual!, inferred: item.visualInferred })),
    ...pack.locations.flatMap((location) => location.objects.map((object) => ({
      name: object.name, description: object.description, visual: object.visual!, inferred: object.visualInferred,
    }))),
  ];
  for (const entry of entries) {
    const match = resolveVisual(entry.name, entry.description);
    const card = node("article", `story-visual-card${match.confidence < 0.34 ? " story-visual-weak" : ""}`);
    if (!entry.visual) throw new Error(`Story "${pack.identity.id}" is missing a resolved visual for "${entry.name}".`);
    const canvas = getVisualCanvas(entry.visual, "meadow", undefined, entry.inferred, entry.name);
    canvas.className = "story-visual-icon";
    canvas.setAttribute("aria-hidden", "true");
    const text = node("div", "story-visual-copy");
    const name = node("h2", "story-visual-name");
    name.textContent = entry.name;
    const description = node("p", "story-visual-description");
    description.textContent = entry.description;
    const chosen = node("p", "story-visual-meta");
    chosen.textContent = `${entry.visual.icon} · confidence ${match.confidence.toFixed(2)}${match.confidence < 0.34 ? " · weak visual match" : ""}`;
    text.append(name, description, chosen);
    card.append(canvas, text);
    container.append(card);
  }
}

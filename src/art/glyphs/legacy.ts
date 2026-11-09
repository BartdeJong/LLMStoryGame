import { getIconCanvas } from "../icons";
import type { IconRecipe } from "../icons";
import type { PaletteName } from "../palettes";
import { GLYPH_CATALOG } from "./catalog";
import type { VisualSpec } from "./catalog";
import { renderGlyph, renderGlyphById } from "./render";

const LEGACY_SHAPES = ["key", "potion", "book", "gem", "leaf", "feather", "lantern", "coin"] as const;
type LegacyShape = (typeof LEGACY_SHAPES)[number];

export const LEGACY_SHAPE_GLYPHS: Readonly<Record<LegacyShape, string>> = {
  key: "key",
  potion: "potion",
  book: "book",
  gem: "gem",
  leaf: "leaf",
  feather: "feather",
  lantern: "lantern",
  coin: "coin",
};

const glyphIds = new Set(GLYPH_CATALOG.map((glyph) => glyph.id));

export function renderLegacyAdapter(
  glyphId: string,
  palette: PaletteName,
  recipe?: IconRecipe,
): HTMLCanvasElement | null {
  const legacyShape = LEGACY_SHAPES.find((shape) => LEGACY_SHAPE_GLYPHS[shape] === glyphId);
  if (legacyShape && !glyphIds.has(glyphId)) {
    if (recipe) return getIconCanvas({ ...recipe, shape: legacyShape }, palette);
    return getIconCanvas({ shape: legacyShape, primaryColor: "accent", secondaryColor: "cream" }, palette);
  }
  return null;
}

export function renderCatalogOrLegacy(
  glyphId: string,
  palette: PaletteName,
  recipe?: IconRecipe,
): HTMLCanvasElement | null {
  const glyph = GLYPH_CATALOG.find((entry) => entry.id === glyphId);
  if (glyph) return renderGlyph(glyph, { palette });
  return renderLegacyAdapter(glyphId, palette, recipe);
}

export function getVisualCanvas(
  visual: VisualSpec,
  palette: PaletteName,
  recipe?: IconRecipe,
  inferred = false,
  seed = visual.icon,
): HTMLCanvasElement {
  const glyph = renderGlyphById(visual.icon, {
    palette,
    accent: visual.accent,
    states: visual.states,
    seed,
  });
  if (glyph) return glyph;
  if (inferred && recipe) return getIconCanvas(recipe, palette);
  const legacy = renderLegacyAdapter(visual.icon, palette, recipe);
  if (legacy) return legacy;
  throw new Error(`Unknown visual glyph "${visual.icon}".`);
}

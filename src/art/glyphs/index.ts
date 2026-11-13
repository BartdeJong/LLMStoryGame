export {
  GLYPH_CATALOG,
  GLYPH_CATEGORIES,
  GLYPH_MATERIALS,
  GLYPH_STATES,
  getGlyph,
} from "./catalog";
export type { GlyphCategory, GlyphDefinition, GlyphMaterial, GlyphState, VisualSpec } from "./catalog";
export { inferVisualCategory, resolveVisual, resolveVisualSpec, tokenizeVisualText } from "./matcher";
export type { ResolvedVisual } from "./matcher";
export { MATERIAL_RAMPS, renderGlyph, renderGlyphById } from "./render";
export type { GlyphRenderOptions } from "./render";
export { lintGlyphCatalog } from "./lint";
export type { GlyphLintIssue } from "./lint";
export { LEGACY_SHAPE_GLYPHS, getVisualCanvas, renderCatalogOrLegacy, renderLegacyAdapter } from "./legacy";
export {
  BIG_FURNITURE_SCALE, canEnlarge, glyphBottomRow, isBigFurniture, isWallMounted, wallCropRows,
} from "./placement";
export { GLYPH_LIGHTS, getGlyphLight } from "./lights";
export type { GlyphLight } from "./lights";

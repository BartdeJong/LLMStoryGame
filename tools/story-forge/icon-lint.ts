import { GLYPH_CATALOG, lintGlyphCatalog } from "../../src/art/glyphs";

const issues = lintGlyphCatalog(GLYPH_CATALOG);
if (issues.length > 0) {
  for (const issue of issues) console.error(`ERROR [ICON_LINT] ${issue.glyphId}: ${issue.message}`);
  process.exitCode = 1;
} else {
  console.log(`OK ${GLYPH_CATALOG.length} glyphs passed icon lint.`);
}

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GLYPH_CATEGORIES, GLYPH_CATALOG } from "../../src/art/glyphs";

export function writeIconCatalog(root = process.cwd()): string {
  const contents = [
    "# Icon catalog",
    "",
    "Choose a glyph by id. Do not use a wrong icon; add a `visual_requests` entry when none fits.",
    "",
    ...GLYPH_CATEGORIES.flatMap((category) => {
      const entries = GLYPH_CATALOG.filter((glyph) => glyph.category === category);
      if (entries.length === 0) return [];
      return [
        `## ${category}`,
        "",
        ...entries.map((glyph) => `- \`${glyph.id}\` — ${glyph.name} · ${glyph.material} · ${glyph.tags.join(", ")}`),
        "",
      ];
    }),
  ].join("\n");
  const destination = resolve(root, "tools/story-forge/icon-catalog.md");
  writeFileSync(destination, contents, "utf8");
  return destination;
}

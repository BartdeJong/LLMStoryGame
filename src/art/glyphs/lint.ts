import { GLYPH_CATEGORIES, GLYPH_MATERIALS, type GlyphDefinition } from "./catalog";

export interface GlyphLintIssue {
  readonly glyphId: string;
  readonly message: string;
}

const LEGEND = new Set([".", "o", "b", "h", "s", "a", "g", "d"]);

function opaquePixels(glyph: GlyphDefinition): Set<number> {
  const result = new Set<number>();
  glyph.rows.forEach((row, y) => [...row].forEach((pixel, x) => {
    if (pixel !== ".") result.add(y * 16 + x);
  }));
  return result;
}

function largestConnectedShape(pixels: ReadonlySet<number>): number {
  const remaining = new Set(pixels);
  let largest = 0;
  while (remaining.size > 0) {
    const start = remaining.values().next().value;
    if (start === undefined) break;
    remaining.delete(start);
    const queue = [start];
    let size = 0;
    while (queue.length > 0) {
      const point = queue.pop()!;
      size += 1;
      const x = point % 16;
      const y = Math.floor(point / 16);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        const next = ny * 16 + nx;
        if (nx >= 0 && nx < 16 && ny >= 0 && ny < 16 && remaining.has(next)) {
          remaining.delete(next);
          queue.push(next);
        }
      }
    }
    largest = Math.max(largest, size);
  }
  return largest;
}

export function lintGlyphCatalog(glyphs: readonly GlyphDefinition[]): GlyphLintIssue[] {
  const issues: GlyphLintIssue[] = [];
  const ids = new Set<string>();
  glyphs.forEach((glyph) => {
    const issue = (message: string): void => { issues.push({ glyphId: glyph.id || "(missing id)", message }); };
    if (ids.has(glyph.id)) issue("id is not unique");
    ids.add(glyph.id);
    if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(glyph.id)) issue("id must be snake_case");
    if (glyph.rows.length !== 16) issue(`rows must contain exactly 16 entries (found ${glyph.rows.length})`);
    if (glyph.rows.some((row) => row.length !== 16)) issue("each row must contain exactly 16 characters");
    if (glyph.rows.some((row) => [...row].some((character) => !LEGEND.has(character)))) issue("rows contain characters outside the pixel legend");
    if (!glyph.rows.some((row) => row.includes("o"))) issue("glyph must contain at least one outline pixel (o)");
    const pixels = opaquePixels(glyph);
    if (pixels.size < 30 || pixels.size > 190) issue(`opaque pixel count must be between 30 and 190 (found ${pixels.size})`);
    if (pixels.size > 0 && largestConnectedShape(pixels) < pixels.size * 0.9) {
      issue("largest 8-connected shape must contain at least 90% of opaque pixels");
    }
    if (pixels.size > 0) {
      const xs = [...pixels].map((point) => point % 16);
      const ys = [...pixels].map((point) => Math.floor(point / 16));
      if (Math.max(Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1) < 10) {
        issue("bounding box must be at least 10 pixels wide or high");
      }
    }
    if (glyph.tags.length < 5 || glyph.tags.some((tag) => tag !== tag.toLowerCase() || !/^[a-z]+$/.test(tag))) {
      issue("tags must contain at least 5 lowercase keywords");
    }
    if (!GLYPH_CATEGORIES.includes(glyph.category)) issue(`invalid category "${glyph.category}"`);
    if (!GLYPH_MATERIALS.includes(glyph.material)) issue(`invalid material "${glyph.material}"`);
  });

  for (let left = 0; left < glyphs.length; left += 1) {
    const leftPixels = opaquePixels(glyphs[left]!);
    for (let right = left + 1; right < glyphs.length; right += 1) {
      const rightPixels = opaquePixels(glyphs[right]!);
      let intersection = 0;
      for (const point of leftPixels) {
        if (rightPixels.has(point)) intersection += 1;
      }
      const union = leftPixels.size + rightPixels.size - intersection;
      if (union > 0 && intersection / union >= 0.9) {
        issues.push({ glyphId: glyphs[left]!.id, message: `pixel silhouette is at least 90% identical to "${glyphs[right]!.id}"` });
      }
    }
  }
  return issues;
}

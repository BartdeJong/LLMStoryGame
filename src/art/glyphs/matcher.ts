import { GLYPH_CATALOG, type GlyphCategory, type GlyphDefinition, type GlyphState, type VisualSpec } from "./catalog";

export interface ResolvedVisual extends VisualSpec {
  readonly confidence: number;
}

const STOPWORDS = new Set(["the", "a", "an", "of", "old", "small", "big", "little"]);
const MODIFIER_STATES: Readonly<Record<string, GlyphState>> = {
  rusty: "rusty",
  broken: "cracked",
  cracked: "cracked",
  glowing: "glow",
  glow: "glow",
  bloodstained: "stained",
  stained: "stained",
  dusty: "dusty",
};

const ACCENTS: Readonly<Record<string, string>> = {
  red: "accent", orange: "accent", yellow: "highlight", gold: "earth",
  green: "leaf", blue: "water", purple: "accent", pink: "skin",
  brown: "earth", silver: "highlight", black: "ink", white: "cream",
  teal: "water",
};

const CATEGORY_KEYWORDS: Readonly<Record<GlyphCategory, readonly string[]>> = {
  container: ["box", "crate", "chest", "bin", "basket", "bag", "bottle", "flask", "jar", "vase", "bowl"],
  tool: ["key", "hammer", "hook", "rope", "wick", "tool", "spyglass", "lens", "telescope"],
  paper: ["book", "ledger", "letter", "note", "receipt", "record", "paper", "document", "map", "scroll", "poster", "proof", "docket"],
  valuable: ["coin", "token", "gem", "jewel", "trinket", "pendant", "seal", "medallion"],
  clothing: ["coat", "hat", "scarf", "dress", "shirt", "boot", "apron", "cloth"],
  food: ["bun", "bread", "loaf", "cake", "food", "pastry", "fruit", "meal"],
  nature: ["leaf", "flower", "tree", "plant", "fern", "shell", "moth", "reed"],
  furniture: ["chair", "table", "desk", "cot", "bed", "shelf", "stool", "bench", "cabinet"],
  machine: ["lamp", "lantern", "bell", "clock", "machine", "barometer", "mirror", "press"],
  danger: ["poison", "blade", "trap", "weapon", "bomb", "danger"],
  generic: [],
};

const CATEGORY_GLYPHS: Readonly<Record<GlyphCategory, string>> = {
  container: "generic_container",
  tool: "generic_tool",
  paper: "generic_paper",
  valuable: "generic_trinket",
  clothing: "generic_prop",
  food: "generic_prop",
  nature: "generic_prop",
  furniture: "generic_prop",
  machine: "generic_prop",
  danger: "generic_prop",
  generic: "generic_prop",
};

export function tokenizeVisualText(text: string): string[] {
  return text.toLocaleLowerCase().split(/[^\p{L}]+/u).filter(Boolean).map((token) => {
    if (/(?:s|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2);
    if (token.endsWith("s") && !token.endsWith("ss") && token.length > 2) return token.slice(0, -1);
    return token;
  }).filter((token) => !STOPWORDS.has(token));
}

function glyphTokens(glyph: GlyphDefinition): Set<string> {
  return new Set([...tokenizeVisualText(glyph.name), ...glyph.tags.flatMap(tokenizeVisualText)]);
}

function guessCategory(tokens: readonly string[]): GlyphCategory {
  for (const category of GLYPH_CATEGORIES_ORDER) {
    if (CATEGORY_KEYWORDS[category].some((keyword) => tokens.includes(keyword))) return category;
  }
  return "generic";
}

const GLYPH_CATEGORIES_ORDER: readonly GlyphCategory[] = [
  "container", "tool", "paper", "valuable", "clothing", "food", "nature", "furniture", "machine", "danger",
];

export function inferVisualCategory(name: string, description = ""): GlyphCategory {
  return guessCategory([...tokenizeVisualText(name), ...tokenizeVisualText(description)]);
}

export function resolveVisual(
  name: string,
  description: string,
  catalog: readonly GlyphDefinition[] = GLYPH_CATALOG,
): ResolvedVisual {
  const nameTokens = tokenizeVisualText(name);
  const descriptionTokens = tokenizeVisualText(description);
  const states = new Set<GlyphState>();
  let accent: string | undefined;
  for (const token of [...nameTokens, ...descriptionTokens]) {
    const state = MODIFIER_STATES[token];
    if (state) states.add(state);
    if (ACCENTS[token]) accent = ACCENTS[token];
  }

  const head = nameTokens[nameTokens.length - 1];
  let best: GlyphDefinition | undefined;
  let bestScore = 0;
  for (const glyph of catalog) {
    const tokens = glyphTokens(glyph);
    let score = 0;
    for (const token of nameTokens) {
      if (!tokens.has(token)) continue;
      score += 3;
      if (token === head) score += 3;
    }
    let descriptionMatches = 0;
    for (const token of descriptionTokens) {
      if (glyph.tags.includes(token)) descriptionMatches += 1;
    }
    score += Math.min(3, descriptionMatches);
    if (score > bestScore) {
      best = glyph;
      bestScore = score;
    }
  }
  if (best && bestScore >= 3) {
    return { icon: best.id, ...(accent ? { accent } : {}), states: [...states], confidence: Math.min(1, bestScore / 6) };
  }

  const category = inferVisualCategory(name, description);
  return { icon: CATEGORY_GLYPHS[category], ...(accent ? { accent } : {}), states: [...states], confidence: 0 };
}

export function resolveVisualSpec(name: string, description: string) {
  const { confidence: _confidence, ...visual } = resolveVisual(name, description);
  return visual;
}

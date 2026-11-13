// Glyphs that give off light. The lighting layer (src/art/lighting.ts) turns these into soft glows.
export interface GlyphLight {
  readonly color: string;
  // Reach in world pixels.
  readonly radius: number;
  // 0..1 strength at the centre.
  readonly intensity: number;
  // 0..1 how much the glow wavers; 0 is steady.
  readonly flicker: number;
  // Where the light sits inside the 16px tile (default 8, the middle).
  readonly offsetY?: number;
}

export const GLYPH_LIGHTS: Readonly<Record<string, GlyphLight>> = {
  candle: { color: "#ffcf7a", radius: 28, intensity: 0.8, flicker: 0.1 },
  torch: { color: "#ffad4f", radius: 44, intensity: 0.9, flicker: 0.14 },
  lantern: { color: "#ffd27a", radius: 40, intensity: 0.85, flicker: 0.05 },
  lantern_hand: { color: "#ffd27a", radius: 32, intensity: 0.8, flicker: 0.05 },
  lamp_post: { color: "#ffe2a0", radius: 56, intensity: 0.85, flicker: 0.02, offsetY: 3 },
  lamp_stand: { color: "#ffd27a", radius: 30, intensity: 0.7, flicker: 0 },
  stove: { color: "#ff9a4a", radius: 48, intensity: 0.75, flicker: 0.12 },
  lighthouse: { color: "#fff0b0", radius: 64, intensity: 0.9, flicker: 0, offsetY: 4 },
  stone_lighthouse: { color: "#fff0b0", radius: 64, intensity: 0.9, flicker: 0, offsetY: 4 },
};

export function getGlyphLight(id: string): GlyphLight | undefined {
  return GLYPH_LIGHTS[id.replace(/_open$/, "")];
}

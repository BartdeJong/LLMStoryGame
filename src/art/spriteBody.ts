// Body parts of the layered character sprites: legs, torso with its outfit, arms, tails and back gear (shell, quills).

import { FEET_ROW, flare, outfitBottom, tone, type Ctx } from "./spriteGrid";
import type { SpriteSpecies } from "./spriteSpec";

const SHOE = tone("#3a2b25");

export function drawLegs(c: Ctx): void {
  const { g } = c;
  const top = c.legTop;
  const legs = c.outfit.legs;
  const human = c.spec.species === "human";
  const shoes = human ? SHOE : tone(c.skin.dark);
  const bottomLeft = FEET_ROW - (c.legLift === -1 ? 1 : 0);
  const bottomRight = FEET_ROW - (c.legLift === 1 ? 1 : 0);

  if (c.view === "side") {
    const spread = c.pose === 1 || c.pose === 3;
    const swapped = c.pose === 3;
    // The leg at the back is drawn first and a little darker; the one in front overlaps it.
    const back = { x: spread ? (swapped ? 6 : 9) : 7, bottom: spread ? (swapped ? FEET_ROW : FEET_ROW - 1) : FEET_ROW };
    const front = { x: spread ? (swapped ? 9 : 6) : 7, bottom: spread ? (swapped ? FEET_ROW - 1 : FEET_ROW) : FEET_ROW };
    const leg = (x: number, bottom: number, shade: boolean): void => {
      if (c.bird) {
        g.rect(x + 1, top, 1, bottom - top + 1, c.beak);
        g.rect(x - 1, bottom, 3, 1, c.beak);
        return;
      }
      const t = shade ? tone(legs.dark) : legs;
      g.shaded(x, top, 2, Math.max(1, bottom - top), t);
      g.rect(x - 1, bottom, 3, 1, shade ? shoes.dark : shoes.base);
    };
    leg(back.x, back.bottom, true);
    leg(front.x, front.bottom, false);
    return;
  }

  const draw = (x: number, bottom: number, toeOut: number): void => {
    if (c.bird) {
      const stem = x + (toeOut < 0 ? 1 : 0);
      g.rect(stem, top, 1, bottom - top + 1, c.beak);
      g.rect(stem - 1, bottom, 3, 1, c.beak);
      return;
    }
    g.shaded(x, top, 2, Math.max(1, bottom - top), legs);
    g.rect(toeOut < 0 ? x - 1 : x, bottom, 3, 1, shoes.base);
  };
  draw(5, bottomLeft, -1);
  draw(9, bottomRight, 1);
}

export function drawTail(c: Ctx): void {
  const s = tailShape(c.spec.species);
  if (!s) return;
  const palette = { b: c.skin.base, d: c.skin.dark, a: c.accent.base, p: "#d99a9a", t: c.skin.light };
  const hip = c.legTop - 1 + c.bob;
  const height = s.length;
  if (c.view === "back") {
    c.g.art(8 - Math.floor(s[0]!.length / 2), hip - height + 2, s, palette);
    return;
  }
  const x = c.view === "side" ? c.tr + 1 : Math.min(c.tr + 2, 11);
  c.g.art(x, hip - height + 1, s, palette);
}

function tailShape(species: SpriteSpecies): readonly string[] | null {
  switch (species) {
    case "bear": case "badger": case "tortoise": case "mole": case "sheep": return ["bb", "bd"];
    case "dog": return [".bb", "bb."];
    case "cat": return [".ba", ".b.", ".b.", "bb."];
    case "fox": return ["..aa", ".bba", "bbb.", "bb.."];
    case "mouse": return ["..pp", ".pp.", "pp.."];
    case "rabbit": return ["aa", "aa"];
    case "otter": return ["..bb", ".bbb", "bbd."];
    case "magpie": return ["..ddd", ".ddd.", "ddd.."];
    case "crow": return [".dd", "dd."];
    case "wren": return ["b.", "bb", "b."];
    case "owl": return ["dd"];
    default: return null;
  }
}

export function drawBackGear(c: Ctx, layer: "behind" | "over"): void {
  const { g } = c;
  const species = c.spec.species;
  const top = c.torsoTop;
  const hip = top + c.torsoH - 1;
  if (species === "tortoise") {
    const shell = c.accent;
    const lines = shell.dark;
    if (c.view === "front" && layer === "behind") {
      g.shaded(c.tl - 2, top - 1, c.tw + 4, c.torsoH + 1, shell);
      g.rect(c.tl - 2, top + 1, 1, 1, lines);
    } else if (c.view === "side" && layer === "behind") {
      g.shaded(c.tr - 2, top - 2, 7, c.torsoH + 2, shell);
      g.rect(c.tr, top - 1, 1, c.torsoH + 1, lines);
      g.rect(c.tr - 2, top + 2, 7, 1, lines);
    } else if (c.view === "back" && layer === "over") {
      g.shaded(c.tl - 2, top - 2, c.tw + 4, c.torsoH + 3, shell);
      g.rect(c.tl - 2, top + 1, c.tw + 4, 1, lines);
      g.rect(c.tl - 2, top + 4, c.tw + 4, 1, lines);
      g.rect(7, top - 2, 2, c.torsoH + 3, lines);
    }
  } else if (species === "hedgehog") {
    const quill = c.skin;
    const spikes = (x: number, y: number, w: number, h: number): void => {
      g.rect(x, y, w, h, quill.base);
      for (let i = 0; i < w; i += 2) g.set(x + i, y - 1, quill.base);
      for (let j = 1; j < h; j += 2) g.set(x + w, y + j, quill.dark);
      g.rect(x + 1, y + 1, Math.max(0, w - 2), 1, quill.dark);
    };
    if (c.view === "side" && layer === "behind") spikes(c.tr - 1, c.h0, 5, c.headH + c.torsoH - 2);
    else if (c.view === "front" && layer === "behind") {
      spikes(c.tl - 1, top, 2, c.torsoH);
      spikes(c.tr, top, 2, c.torsoH);
    } else if (c.view === "back" && layer === "over") {
      spikes(c.tl - 1, c.h0, c.tw + 2, c.headH + c.torsoH);
      g.rect(c.tl, hip, c.tw, 1, quill.dark);
    }
  }
}

// Torso, the garment on it, and the arms.
export function drawBody(c: Ctx): void {
  const { g, view, outfit } = c;
  const style = outfit.style;
  const top = c.torsoTop;
  const hip = top + c.torsoH - 1;
  const w = view === "side" ? c.sd : c.tw;
  const left = c.tl;
  const bottom = outfitBottom(c);
  const base = style === "overalls" ? outfit.trim : outfit.color;
  const front = view === "front";

  g.shaded(left, top, w, c.torsoH, base);
  if (style === "none") {
    // Bare fur or feathers: a lighter belly in the middle.
    if (front) g.rect(left + 2, top + 1, w - 4, c.torsoH - 1, c.accent.base);
    else if (view === "side") g.rect(left, top + 1, 2, c.torsoH - 2, c.accent.base);
  }
  for (let row = hip + 1; row <= bottom; row += 1) {
    const e = flare(style, row - hip);
    g.rect(left - e, row, w + 2 * e, 1, outfit.color.base);
    g.set(left - e, row, outfit.color.light);
    g.set(left + w + e - 1, row, outfit.color.dark);
  }
  const wide = w + 2 * flare(style, Math.max(1, bottom - hip));
  const edge = left - flare(style, Math.max(1, bottom - hip));
  const hem = (): void => {
    g.rect(edge, bottom, wide, 1, outfit.trim.base);
  };

  switch (style) {
    case "shirt":
      g.rect(7, top, 2, 1, outfit.trim.base);
      if (front) g.set(7, top + 2, outfit.trim.base), g.set(7, top + 4, outfit.trim.base);
      break;
    case "jumper":
      g.rect(left, hip, w, 1, outfit.trim.base);
      g.rect(7, top, 2, 1, outfit.trim.base);
      break;
    case "striped":
      for (let row = top + 1; row <= hip; row += 2) g.rect(left, row, w, 1, outfit.trim.base);
      break;
    case "dress":
    case "robe":
      g.rect(7, top, 2, 1, c.skin.base);
      if (c.torsoH >= 5) g.rect(left, top + c.torsoH - 2, w, 1, outfit.trim.base);
      if (bottom > hip) hem();
      break;
    case "coat":
    case "duffle-coat":
      if (style === "duffle-coat") {
        g.rect(left - 1, top, w + 2, 2, outfit.color.light);
        g.rect(left - 1, top + 1, w + 2, 1, outfit.color.dark);
        g.rect(7, top, 2, 1, c.skin.dark);
      } else {
        g.set(left, top, outfit.trim.base);
        g.set(left + w - 1, top, outfit.trim.base);
      }
      if (front) {
        g.rect(7, top + 2, 2, bottom - top - 1, outfit.color.deep);
        for (let row = top + 3; row < Math.min(bottom, top + 8); row += 2) {
          if (style === "duffle-coat") g.rect(6, row, 4, 1, outfit.trim.base);
          else g.set(8, row, outfit.trim.base);
        }
      }
      g.rect(edge, bottom, wide, 1, outfit.color.dark);
      break;
    case "suit":
      if (front) {
        g.rect(7, top, 2, 2, outfit.trim.base);
        g.set(8, top + 3, outfit.color.deep);
      } else g.rect(7, top, 2, 1, outfit.trim.base);
      break;
    case "waistcoat":
      g.rect(7, top, 2, 1, outfit.trim.base);
      if (front) {
        g.rect(left, top + 1, 1, c.torsoH - 1, outfit.trim.base);
        g.rect(left + w - 1, top + 1, 1, c.torsoH - 1, outfit.trim.base);
        for (let row = top + 2; row < hip; row += 2) g.set(8, row, outfit.trim.base);
      }
      break;
    case "uniform":
      g.rect(7, top, 2, 1, outfit.trim.base);
      g.rect(left, hip - 1, w, 1, outfit.color.deep);
      if (front) {
        g.set(8, hip - 1, outfit.trim.base);
        for (let row = top + 1; row < hip - 1; row += 2) {
          g.set(6, row, outfit.trim.base);
          g.set(9, row, outfit.trim.base);
        }
      }
      break;
    case "cape":
      g.rect(left - 2, top, w + 4, 3, outfit.color.light);
      g.rect(left - 2, top + 2, w + 4, 1, outfit.trim.base);
      g.rect(left - 2 + w + 3, top, 1, 3, outfit.color.dark);
      if (front) g.rect(7, top, 2, 1, outfit.trim.base);
      g.rect(edge, bottom, wide, 1, outfit.color.dark);
      break;
    case "overalls":
      g.shaded(left + 1, top + 1, w - 2, c.torsoH - 1, outfit.color);
      g.rect(left + 1, top, 1, 1, outfit.color.base);
      g.rect(left + w - 2, top, 1, 1, outfit.color.base);
      if (front) g.rect(left + 2, top + 2, 2, 1, outfit.color.dark);
      break;
    case "cardigan":
      if (front) {
        g.rect(7, top, 2, c.torsoH, outfit.trim.base);
        g.set(left + 1, hip - 1, outfit.color.dark);
        g.set(left + w - 2, hip - 1, outfit.color.dark);
      } else g.rect(7, top, 2, 1, outfit.trim.base);
      break;
    case "smock":
      g.rect(7, top, 2, 1, outfit.trim.base);
      g.rect(edge, bottom, wide, 1, outfit.color.dark);
      break;
    default:
      break;
  }
}

export function drawArms(c: Ctx): void {
  const { g, outfit } = c;
  if (outfit.style === "cape") return;
  const sleeve = outfit.style === "waistcoat" || outfit.style === "overalls"
    ? outfit.trim
    : outfit.style === "none" ? c.skin : outfit.color;
  const hand = c.spec.species === "mole" ? c.accent.base : c.bird ? c.skin.dark : c.skin.base;
  const top = c.torsoTop;
  const length = c.torsoH - 1;
  const arm = (x: number, extra: number): void => {
    const rows = Math.max(2, length + extra);
    g.shaded(x, top + 1, 2, rows - 1, sleeve);
    g.rect(x, top + rows, 2, 1, hand);
    if (outfit.style === "robe" || outfit.style === "duffle-coat") g.rect(x, top + rows - 1, 2, 1, outfit.trim.base);
  };
  if (c.view === "side") {
    const swing = c.pose === 1 ? -1 : c.pose === 3 ? 1 : 0;
    arm(7 + swing, 0);
    return;
  }
  arm(c.tl - 1, c.pose === 1 ? 1 : c.pose === 3 ? -1 : 0);
  arm(c.tr, c.pose === 1 ? -1 : c.pose === 3 ? 1 : 0);
}

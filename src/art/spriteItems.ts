// Accessories of the layered character sprites: things worn on the face and body, and things carried in a hand.

import { FEET_ROW, outfitBottom, tone, type Ctx } from "./spriteGrid";
import { HELD_ACCESSORIES, type SpriteAccessory } from "./spriteSpec";

const DEFAULT_COLOR: Record<string, string> = {
  glasses: "#2c2326", monocle: "#d8b44a", moustache: "#4a3322", beard: "#6a4a30", brows: "#6e6a66", pipe: "#5a3a24",
  freckles: "#a8643c", scarf: "#b4443c", bowtie: "#a8323a", apron: "#f1ede2", shawl: "#7a5a8a", locket: "#e3b341",
  nametag: "#f2ece0", belt: "#4a3326", satchel: "#8a5a32", cane: "#5a3a24", umbrella: "#2c3340", spoon: "#c99a5a",
  broom: "#b8934a", notebook: "#3f5f8a", basket: "#b8843c", lantern: "#e3b341", suitcase: "#8a5a32", orange: "#f08a24",
  book: "#7a3030", spyglass: "#c9a24a", "medical-bag": "#2a2a30", flower: "#d94a6a", ball: "#f2efe6",
};

function colorOf(item: SpriteAccessory): string {
  return item.color ?? DEFAULT_COLOR[item.kind] ?? "#888888";
}

const BODY_KINDS = ["scarf", "bowtie", "apron", "shawl", "locket", "nametag", "belt", "satchel"];
const FACE_KINDS = ["glasses", "monocle", "moustache", "beard", "brows", "pipe", "freckles"];

export function drawBodyAccessories(c: Ctx): void {
  for (const item of c.spec.accessories ?? []) if (BODY_KINDS.includes(item.kind)) bodyItem(c, item.kind, tone(colorOf(item)));
}

export function drawFaceAccessories(c: Ctx): void {
  if (c.view === "back") return;
  for (const item of c.spec.accessories ?? []) if (FACE_KINDS.includes(item.kind)) faceItem(c, item.kind, tone(colorOf(item)));
}

export function drawHeldItems(c: Ctx): void {
  const item = (c.spec.accessories ?? []).find((entry) => HELD_ACCESSORIES.includes(entry.kind));
  if (!item) return;
  // In back views the hands swap sides, so the item is drawn mirrored.
  c.g.flip = c.view === "back";
  heldItem(c, item.kind, tone(colorOf(item)));
  c.g.flip = false;
}

function bodyItem(c: Ctx, kind: string, t: ReturnType<typeof tone>): void {
  const { g, torsoTop: top, torsoH } = c;
  const w = c.view === "side" ? c.sd : c.tw;
  const left = c.tl;
  const hip = top + torsoH - 1;
  const front = c.view === "front";
  switch (kind) {
    case "scarf":
      g.shaded(left - 1, top, w + 2, 2, t);
      if (c.view === "side") g.shaded(c.tr, top + 2, 2, 4, t);
      else g.shaded(c.tr - 2, top + 2, 2, 4, t);
      g.set(left + 1, top + 1, t.dark);
      break;
    case "bowtie":
      if (front) {
        g.rect(6, top, 4, 1, t.base);
        g.rect(7, top, 2, 1, t.dark);
        g.set(6, top + 1, t.base);
        g.set(9, top + 1, t.base);
      } else if (c.view === "side") g.rect(left, top, 2, 1, t.base);
      break;
    case "apron": {
      const bottom = Math.max(hip, Math.min(outfitBottom(c), hip + 2));
      if (c.view === "back") {
        g.rect(7, hip - 1, 2, 1, t.base);
        g.set(6, hip, t.base);
        g.set(9, hip, t.base);
      } else if (c.view === "side") {
        g.shaded(left - 1, top + 1, 3, bottom - top, t);
      } else {
        g.shaded(left + 1, top + 2, w - 2, bottom - top - 1, t);
        g.rect(left + 2, top, w - 4, 2, t.base);
        g.set(left + 2, top, t.light);
        g.set(left + 1, top + 1, t.dark);
        g.set(left + w - 2, top + 1, t.dark);
        g.rect(left + 2, bottom, w - 4, 1, t.light);
        g.rect(left + 2, hip - 1, 2, 1, t.dark);
      }
      break;
    }
    case "shawl":
      g.shaded(left - 1, top, w + 2, 2, t);
      g.rect(left + 1, top + 2, w - 2, 1, t.dark);
      if (front) g.rect(7, top + 3, 2, 1, t.dark);
      break;
    case "locket":
      if (front) {
        g.set(7, top + 1, t.light);
        g.set(8, top + 2, t.base);
      }
      break;
    case "nametag":
      if (front) {
        g.rect(left + 1, top + 2, 2, 2, "#f2ece0");
        g.set(left + 1, top + 3, t.deep);
      }
      break;
    case "belt":
      g.rect(left, hip - 1, w, 1, t.base);
      if (front) g.set(8, hip - 1, "#e3b341");
      break;
    case "satchel":
      if (c.view !== "side") {
        for (let step = 0; step < w; step += 1) g.set(left + step, top + Math.round((step * (torsoH - 3)) / Math.max(1, w - 1)), t.dark);
        if (front) g.shaded(c.tr - 1, hip - 2, 3, 3, t);
        else g.shaded(left - 1, hip - 2, 3, 3, t);
      } else g.shaded(7, hip - 2, 3, 3, t);
      break;
    default:
      break;
  }
}

function faceItem(c: Ctx, kind: string, t: ReturnType<typeof tone>): void {
  const { g, ey, h1 } = c;
  const side = c.view === "side";
  const ring = (x: number): void => {
    g.set(x - 1, ey, t.base);
    g.set(x + 1, ey, t.base);
    g.set(x, ey - 1, t.base);
    g.set(x, ey + 1, t.base);
  };
  switch (kind) {
    case "glasses":
      if (side) {
        ring(6);
        g.rect(8, ey, 3, 1, t.base);
      } else {
        ring(6);
        ring(9);
      }
      break;
    case "monocle":
      ring(side ? 6 : 9);
      g.rect(side ? 7 : 10, h1, 1, 3, "#d8b44a");
      break;
    case "moustache":
      if (side) g.rect(3, ey + 1, 3, 1, t.base);
      else {
        g.rect(5, ey + 1, 6, 1, t.base);
        g.set(5, ey + 2, t.dark);
        g.set(10, ey + 2, t.dark);
      }
      break;
    case "beard":
      if (side) {
        g.shaded(4, ey + 1, 5, h1 - ey + 1, t);
      } else {
        g.shaded(4, ey + 1, 8, h1 - ey, t);
        g.shaded(5, h1 + 1, 6, 1, t);
        g.rect(7, ey + 1, 2, 1, "#9a4a4a");
      }
      break;
    case "brows":
      if (side) g.rect(5, ey - 1, 2, 1, t.base);
      else {
        g.rect(5, ey - 1, 3, 1, t.base);
        g.rect(8, ey - 1, 3, 1, t.base);
      }
      break;
    case "pipe":
      if (side) {
        g.rect(2, h1, 3, 1, t.base);
        g.rect(1, h1 - 1, 1, 2, t.dark);
      } else {
        g.rect(8, h1, 3, 1, t.base);
        g.rect(11, h1 - 1, 1, 2, t.dark);
      }
      break;
    case "freckles":
      if (side) {
        g.set(5, ey + 1, t.base);
        g.set(6, ey + 1, t.base);
      } else {
        g.set(5, ey + 1, t.base);
        g.set(6, ey + 1, t.base);
        g.set(9, ey + 1, t.base);
        g.set(10, ey + 1, t.base);
      }
      break;
    default:
      break;
  }
}

function heldItem(c: Ctx, kind: string, t: ReturnType<typeof tone>): void {
  const { g } = c;
  const hand = c.torsoTop + c.torsoH - 1;
  const ix = (c.view === "side" ? 6 : c.tl - 1) - 1;
  const floor = FEET_ROW;
  switch (kind) {
    case "cane":
      g.rect(ix, hand, 1, floor - hand + 1, t.base);
      g.rect(ix, hand - 1, 2, 1, t.light);
      break;
    case "umbrella":
      g.rect(ix, hand - 1, 2, 1, "#5a3a24");
      g.rect(ix, hand, 1, 1, "#5a3a24");
      g.shaded(ix, hand + 1, 2, Math.min(6, floor - hand - 1), t);
      g.set(ix, floor, t.deep);
      break;
    case "spoon":
      g.rect(ix, hand - 4, 1, 5, t.base);
      g.shaded(ix, hand - 6, 2, 2, t);
      break;
    case "broom":
      g.rect(ix, hand - 8, 1, floor - hand + 6, t.base);
      g.shaded(ix, floor - 2, 3, 3, tone("#c9a44a"));
      g.rect(ix, floor - 2, 3, 1, t.dark);
      break;
    case "notebook":
      g.shaded(ix, hand - 2, 3, 3, t);
      g.set(ix + 1, hand - 1, "#f2ece0");
      break;
    case "book":
      g.shaded(ix, hand - 3, 3, 4, t);
      g.rect(ix + 2, hand - 2, 1, 2, "#f2ece0");
      break;
    case "basket":
      g.rect(ix, hand - 1, 4, 1, t.dark);
      g.shaded(ix, hand, 4, 3, t);
      g.set(ix + 1, hand + 1, t.dark);
      g.set(ix + 3, hand + 1, t.dark);
      break;
    case "lantern":
      g.set(ix + 1, hand - 1, "#2a2a30");
      g.rect(ix, hand, 3, 4, "#2a2a30");
      g.rect(ix + 1, hand + 1, 1, 2, "#ffe08a");
      break;
    case "suitcase":
      g.rect(ix + 1, hand, 2, 1, "#2a2a30");
      g.shaded(ix, hand + 1, 4, 4, t);
      g.rect(ix, hand + 2, 4, 1, t.dark);
      g.set(ix + 1, hand + 3, "#e3b341");
      break;
    case "medical-bag":
      g.rect(ix + 1, hand, 2, 1, "#555560");
      g.shaded(ix, hand + 1, 4, 3, t);
      g.set(ix + 1, hand + 2, "#e8e8e8");
      g.set(ix + 2, hand + 2, "#e8e8e8");
      break;
    case "orange":
      g.rect(ix, hand - 1, 2, 2, t.base);
      g.set(ix, hand - 1, t.light);
      g.set(ix + 1, hand - 2, "#4a8a3a");
      break;
    case "spyglass":
      g.rect(ix, hand - 5, 2, 2, t.dark);
      g.shaded(ix, hand - 3, 2, 4, t);
      g.set(ix, hand - 5, "#9fd8e8");
      break;
    case "ball":
      g.rect(ix, hand, 3, 3, t.base);
      g.set(ix, hand, null);
      g.set(ix + 2, hand + 2, null);
      g.set(ix + 1, hand + 1, "#2a2a30");
      g.set(ix + 2, hand, t.dark);
      g.set(ix, hand + 2, t.dark);
      break;
    case "flower":
      g.rect(ix, hand - 1, 1, 3, "#4a8a3a");
      g.shaded(ix, hand - 3, 2, 2, t);
      break;
    default:
      break;
  }
}

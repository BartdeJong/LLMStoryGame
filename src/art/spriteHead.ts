// Head of the layered character sprites: the head shape, species features (ears, snout, beak), hair and headwear.

import { tone, type Ctx } from "./spriteGrid";

const NOSE = "#2a1b1d";
const PINK = "#e29a9f";

// Head box: columns 4..11, rows h0..h1. Faces look left in side views.
export function drawHead(c: Ctx): void {
  const { g, h0, h1, skin } = c;
  g.rect(5, h0, 6, 1, skin.light);
  g.rect(4, h0 + 1, 8, c.headH - 2, skin.base);
  g.rect(5, h1, 6, 1, skin.base);
  g.rect(11, h0 + 1, 1, c.headH - 2, skin.dark);
  g.set(10, h1, skin.dark);
  drawEars(c);
  if (c.view === "back") return;
  if (c.view === "side") drawFaceSide(c);
  else drawFaceFront(c);
}

function drawEars(c: Ctx): void {
  const { g, h0, skin: s, accent: a } = c;
  const side = c.view === "side";
  const both = (draw: (x: number, mirror: boolean) => void, left: number, right: number): void => {
    if (side) draw(left + 4, false);
    else {
      draw(left, false);
      draw(right, true);
    }
  };
  switch (c.spec.species) {
    case "human":
      if (!side) {
        g.set(3, c.ey, s.dark);
        g.set(12, c.ey, s.dark);
      } else g.set(8, c.ey, s.dark);
      break;
    case "bear":
    case "badger":
      both((x) => {
        g.rect(x, h0 - 1, 2, 2, s.base);
        g.set(x, h0 - 1, c.spec.species === "badger" ? a.base : s.light);
      }, 4, 10);
      break;
    case "dog":
      both((x, mirror) => g.rect(x - (mirror ? -1 : 1), h0 + 1, 2, 4, a.dark), 3, 11);
      break;
    case "cat":
      both((x, mirror) => {
        g.rect(x, h0 - 1, 2, 1, s.base);
        g.set(mirror ? x + 1 : x, h0 - 2, s.base);
        g.set(mirror ? x : x + 1, h0, a.dark);
      }, 4, 10);
      break;
    case "fox":
      both((x, mirror) => {
        g.rect(x, h0 - 1, 2, 1, s.base);
        g.set(mirror ? x + 1 : x, h0 - 2, s.base);
        g.set(mirror ? x + 1 : x, h0 - 3, s.dark);
        g.set(mirror ? x : x + 1, h0 - 1, NOSE);
      }, 4, 10);
      break;
    case "mouse":
      both((x) => {
        g.rect(x - 1, h0 - 1, 3, 3, s.base);
        g.set(x, h0, PINK);
      }, 4, 10);
      break;
    case "rabbit":
      both((x) => {
        g.rect(x + 1, h0 - 4, 2, 5, s.base);
        g.rect(x + 1, h0 - 3, 1, 3, PINK);
      }, 4, 8);
      break;
    case "owl":
      both((x, mirror) => {
        g.set(mirror ? x + 1 : x, h0 - 1, s.dark);
        g.set(mirror ? x + 1 : x, h0, s.dark);
        g.set(mirror ? x : x + 1, h0 - 1, s.base);
      }, 4, 10);
      break;
    case "hedgehog":
    case "otter":
      both((x) => g.rect(x, h0 - 1, 2, 1, s.base), 4, 10);
      break;
    case "sheep":
      both((x, mirror) => g.rect(mirror ? x + 2 : x - 1, h0 + 2, 2, 2, s.dark), 3, 10);
      break;
    default:
      break;
  }
}

function drawFaceFront(c: Ctx): void {
  const { g, h0, h1, ey, skin: s, accent: a } = c;
  const eyes = (color = c.eye, left = 6, right = 9, y = ey): void => {
    g.set(left, y, color);
    g.set(right, y, color);
  };
  const mouth = (): void => {
    g.rect(7, h1, 2, 1, "#9a4a4a");
  };
  switch (c.spec.species) {
    case "human":
      eyes();
      g.set(8, ey + 1, s.dark);
      mouth();
      break;
    case "bear":
    case "dog":
    case "otter":
      eyes();
      g.rect(6, ey + 1, 4, h1 - ey, a.base);
      g.rect(7, ey + 1, 2, 1, NOSE);
      if (c.spec.species === "otter") {
        g.rect(5, ey + 1, 6, h1 - ey, a.base);
        g.rect(7, ey + 1, 2, 1, NOSE);
        g.set(3, ey + 1, a.light);
        g.set(12, ey + 1, a.light);
      }
      break;
    case "cat":
      eyes();
      g.rect(7, ey + 1, 2, 1, PINK);
      g.rect(7, h1, 2, 1, a.base);
      g.set(3, ey + 1, a.light);
      g.set(12, ey + 1, a.light);
      break;
    case "fox":
      eyes();
      g.rect(4, ey + 1, 8, h1 - ey, a.base);
      g.rect(5, h1, 6, 1, a.base);
      g.rect(7, ey + 1, 2, 1, NOSE);
      break;
    case "mouse":
      eyes();
      g.rect(7, ey + 1, 2, 1, PINK);
      g.rect(6, h1, 4, 1, a.base);
      g.set(3, ey + 1, a.light);
      g.set(12, ey + 1, a.light);
      break;
    case "rabbit":
      eyes();
      g.rect(6, ey + 1, 4, h1 - ey, a.base);
      g.rect(7, ey + 1, 2, 1, PINK);
      g.set(7, h1, "#ffffff");
      break;
    case "owl":
      g.rect(4, ey - 2, 8, 4, a.base);
      g.rect(5, ey - 1, 2, 2, "#fff6d8");
      g.rect(9, ey - 1, 2, 2, "#fff6d8");
      g.set(6, ey, NOSE);
      g.set(9, ey, NOSE);
      g.rect(7, ey, 2, 2, c.beak);
      break;
    case "badger":
      g.rect(6, h0, 4, c.headH, a.base);
      g.set(5, ey, NOSE);
      g.set(10, ey, NOSE);
      eyes(NOSE, 6, 9);
      g.rect(7, ey + 1, 2, 1, NOSE);
      break;
    case "hedgehog":
      g.rect(5, h0 + 2, 6, c.headH - 2, a.base);
      g.rect(4, h0, 8, 2, s.dark);
      g.set(4, h0 + 2, s.dark);
      g.set(11, h0 + 2, s.dark);
      eyes(NOSE);
      g.rect(7, ey + 1, 2, 1, NOSE);
      break;
    case "frog":
      g.rect(4, h0 - 1, 3, 3, s.base);
      g.rect(9, h0 - 1, 3, 3, s.base);
      g.rect(5, h0 - 1, 1, 2, "#f4f0c8");
      g.rect(10, h0 - 1, 1, 2, "#f4f0c8");
      g.set(5, h0, NOSE);
      g.set(10, h0, NOSE);
      g.rect(5, ey + 1, 6, 1, NOSE);
      g.rect(6, h1, 4, 1, a.base);
      g.set(5, ey, s.dark);
      g.set(10, ey, s.dark);
      break;
    case "sheep":
      g.rect(3, h0 - 1, 10, 3, a.base);
      g.rect(4, h0 - 2, 8, 1, a.light);
      g.set(3, h0 + 2, a.dark);
      g.set(12, h0 + 2, a.dark);
      g.rect(5, h0 + 2, 6, c.headH - 2, s.base);
      eyes("#f2ead8");
      g.rect(7, ey + 1, 2, 1, s.light);
      break;
    case "mole":
      g.set(5, ey, c.eye);
      g.set(10, ey, c.eye);
      g.rect(7, ey, 2, 3, PINK);
      g.set(7, ey, "#f4b8bb");
      break;
    case "tortoise":
      eyes();
      g.rect(5, h1 - 1, 6, 1, s.dark);
      g.rect(6, h1, 4, 1, a.dark);
      g.set(5, h0 + 1, s.light);
      g.set(10, h0 + 1, s.light);
      break;
    case "heron":
      eyes();
      g.rect(7, ey, 2, 4, c.beak);
      g.set(11, h0, s.dark);
      g.set(12, h0 + 1, s.dark);
      g.set(12, h0 + 2, s.dark);
      break;
    default:
      // magpie, crow, wren
      eyes();
      g.rect(7, ey + 1, 2, 2, c.beak);
      if (c.spec.species === "wren") g.set(8, ey, s.light);
      break;
  }
}

function drawFaceSide(c: Ctx): void {
  const { g, h0, h1, ey, skin: s, accent: a } = c;
  const eye = (x = 6, y = ey): void => g.set(x, y, c.eye);
  const snout = (length: number, rows: number, color: string, y = ey + 1): void => {
    g.rect(4 - length, y, length, rows, color);
  };
  switch (c.spec.species) {
    case "human":
      eye();
      g.set(3, ey, s.base);
      g.set(3, ey + 1, s.dark);
      g.set(5, h1, "#9a4a4a");
      break;
    case "bear":
    case "dog":
      eye();
      snout(2, h1 - ey, a.base);
      g.set(2, ey + 1, NOSE);
      break;
    case "otter":
      eye();
      snout(2, h1 - ey, a.base);
      g.set(2, ey + 1, NOSE);
      g.set(1, ey + 1, a.light);
      break;
    case "cat":
      eye();
      snout(1, h1 - ey, a.base);
      g.set(3, ey + 1, PINK);
      break;
    case "fox":
      eye();
      snout(3, h1 - ey, a.base);
      g.set(1, ey + 1, NOSE);
      g.set(5, ey + 2, a.base);
      break;
    case "mouse":
      eye();
      snout(2, h1 - ey, a.base);
      g.set(2, ey + 1, PINK);
      break;
    case "rabbit":
      eye();
      snout(1, h1 - ey, a.base);
      g.set(3, ey + 1, PINK);
      break;
    case "owl":
      g.rect(4, ey - 2, 3, 4, a.base);
      g.rect(5, ey - 1, 2, 2, "#fff6d8");
      g.set(5, ey, NOSE);
      g.rect(2, ey, 2, 2, c.beak);
      break;
    case "badger":
      g.rect(4, h0, 4, c.headH - 1, a.base);
      g.set(5, ey, NOSE);
      g.set(6, ey, NOSE);
      snout(2, h1 - ey, a.base);
      g.set(2, ey + 1, NOSE);
      break;
    case "hedgehog":
      g.rect(4, h0 + 2, 4, c.headH - 2, a.base);
      eye(5);
      snout(3, h1 - ey, a.base);
      g.set(1, ey + 1, NOSE);
      g.rect(4, h0, 8, 2, s.dark);
      break;
    case "frog":
      g.rect(5, h0 - 1, 3, 3, s.base);
      g.set(6, h0, "#f4f0c8");
      g.set(5, h0, NOSE);
      g.rect(3, ey + 1, 4, 1, NOSE);
      g.set(3, h1, a.base);
      break;
    case "sheep":
      g.rect(3, h0 - 1, 9, 3, a.base);
      g.rect(8, h0 + 2, 4, c.headH - 2, a.base);
      g.rect(4, h0 + 2, 4, c.headH - 2, s.base);
      eye(5);
      snout(1, h1 - ey, s.base);
      break;
    case "mole":
      eye(5);
      g.rect(2, ey, 2, 2, PINK);
      g.set(1, ey, PINK);
      break;
    case "tortoise":
      eye(5);
      snout(1, h1 - ey, s.dark);
      g.set(3, h1, a.dark);
      break;
    case "heron":
      eye(5);
      g.rect(0, ey, 4, 2, c.beak);
      g.set(11, h0, s.dark);
      g.set(12, h0 + 1, s.dark);
      break;
    default:
      eye(5);
      snout(c.spec.species === "wren" ? 2 : 3, 2, c.beak, ey);
      break;
  }
}

export function drawHair(c: Ctx): void {
  const hair = c.spec.hair;
  if (!hair || hair.style === "none") return;
  const { g, h0, h1, headH, view } = c;
  const t = tone(hair.color);
  const cap = (x: number, y: number, w: number, h: number): void => {
    g.shaded(x, y, w, h, t);
    g.set(x, y, null);
    g.set(x + w - 1, y, null);
  };
  const behind = view === "back";
  const side = view === "side";
  const down = c.torsoTop + 2;

  if (behind) {
    // The back of the head is all hair.
    if (hair.style === "balding") {
      g.rect(4, h0 + 2, 1, 3, t.base);
      g.rect(11, h0 + 2, 1, 3, t.dark);
      g.rect(5, h0 + 3, 6, 2, t.base);
      g.rect(5, h0 + 2, 6, 1, t.dark);
    } else {
      cap(4, h0 - 1, 8, headH);
      if (hair.style === "long") g.shaded(4, h0 + headH - 1, 8, down - (h0 + headH - 1), t);
      if (hair.style === "bob") g.shaded(3, h0 + 2, 10, headH - 1, t);
      if (hair.style === "bun") g.shaded(6, h0 - 3, 4, 3, t);
      if (hair.style === "ponytail") g.shaded(7, h0 + 3, 2, 6, t);
      if (hair.style === "pigtails") {
        g.shaded(2, h0 + 2, 2, 4, t);
        g.shaded(12, h0 + 2, 2, 4, t);
      }
      if (hair.style === "curly") g.shaded(3, h0 - 1, 10, headH, t);
      if (hair.style === "messy" || hair.style === "mop") {
        g.set(5, h0 - 2, t.base);
        g.set(8, h0 - 2, t.base);
        g.set(10, h0 - 2, t.base);
      }
    }
    return;
  }

  if (side) {
    cap(4, h0 - 1, 8, 3);
    g.set(4, h0 + 1, null);
    g.set(4, h0, t.base);
    const back = (extra: number): void => g.shaded(8, h0 + 2, 4, headH - 2 + extra, t);
    switch (hair.style) {
      case "short": back(-1); break;
      case "messy": back(-1); g.set(6, h0 - 2, t.base); g.set(9, h0 - 2, t.base); g.set(5, h0 + 2, t.base); break;
      case "long": g.shaded(8, h0 + 1, 5, down - h0, t); break;
      case "bob": g.shaded(8, h0 + 1, 5, headH, t); break;
      case "bun": back(-1); g.shaded(9, h0 - 3, 3, 3, t); break;
      case "ponytail": back(-1); g.shaded(12, h0 + 2, 2, 6, t); break;
      case "curly": g.shaded(4, h0 - 1, 9, 4, t); back(0); break;
      case "pigtails": back(-1); g.shaded(9, h0 + 3, 2, 4, t); break;
      case "balding": g.rect(4, h0 - 1, 8, 3, null); g.shaded(8, h0 + 1, 4, 3, t); break;
      case "mop": back(0); g.rect(4, h0 + 1, 3, 1, t.base); break;
      default: break;
    }
    return;
  }

  // Front view.
  switch (hair.style) {
    case "short":
      cap(4, h0 - 1, 8, 3);
      g.set(4, h0 + 2, t.base);
      g.set(11, h0 + 2, t.dark);
      break;
    case "messy":
      cap(4, h0 - 1, 8, 3);
      g.set(4, h0 - 2, t.base);
      g.set(6, h0 - 2, t.light);
      g.set(9, h0 - 2, t.base);
      g.set(11, h0 - 2, t.dark);
      g.set(5, h0 + 2, t.base);
      g.set(8, h0 + 2, t.base);
      g.set(11, h0 + 2, t.dark);
      break;
    case "long":
      cap(4, h0 - 1, 8, 3);
      g.shaded(3, h0 + 1, 2, down - h0 - 1, t);
      g.shaded(11, h0 + 1, 2, down - h0 - 1, t);
      break;
    case "bob":
      cap(4, h0 - 1, 8, 3);
      g.shaded(3, h0 + 1, 2, headH - 1, t);
      g.shaded(11, h0 + 1, 2, headH - 1, t);
      break;
    case "bun":
      cap(4, h0 - 1, 8, 3);
      g.shaded(6, h0 - 3, 4, 2, t);
      g.set(4, h0 + 2, t.base);
      g.set(11, h0 + 2, t.dark);
      break;
    case "ponytail":
      cap(4, h0 - 1, 8, 3);
      g.set(4, h0 + 2, t.base);
      g.shaded(12, h0 + 1, 2, 5, t);
      break;
    case "curly":
      cap(3, h0 - 1, 10, 4);
      g.set(4, h0 + 2, t.light);
      g.set(11, h0 + 2, t.dark);
      g.set(7, h0 - 1, t.light);
      break;
    case "balding":
      g.rect(4, h0 + 1, 1, 3, t.base);
      g.rect(11, h0 + 1, 1, 3, t.dark);
      g.rect(5, h0, 1, 1, t.base);
      g.rect(10, h0, 1, 1, t.dark);
      g.set(7, h0, c.skin.light);
      g.set(8, h0, c.skin.light);
      break;
    case "pigtails":
      cap(4, h0 - 1, 8, 3);
      g.set(4, h0 + 2, t.base);
      g.set(11, h0 + 2, t.dark);
      g.shaded(2, h0 + 2, 2, 4, t);
      g.shaded(12, h0 + 2, 2, 4, t);
      break;
    case "mop":
      cap(4, h0 - 1, 8, 4);
      g.set(7, h0 + 2, null);
      g.set(4, h0 + 3, null);
      g.set(11, h0 + 3, null);
      break;
    default:
      break;
  }
  void h1;
}

export function drawHeadwear(c: Ctx): void {
  const hw = c.spec.headwear;
  if (!hw || hw.style === "none") return;
  const { g, h0, view } = c;
  const col = tone(hw.color);
  const trim = tone(hw.trim ?? hw.color);
  const side = view === "side";
  const front = view === "front";
  // The visor of a cap shows in front views and points left in side views.
  const visor = (color: string, y: number, width = 8): void => {
    if (front) g.rect(4, y, width, 1, color);
    else if (side) g.rect(2, y, 4, 1, color);
  };
  switch (hw.style) {
    case "deerstalker":
      g.shaded(4, h0 - 2, 8, 3, col);
      g.rect(6, h0 - 3, 4, 1, col.base);
      g.set(7, h0 - 3, col.light);
      g.set(5, h0 - 1, col.light);
      g.set(9, h0 - 2, col.dark);
      g.set(7, h0, col.light);
      if (front || side) visor(col.dark, h0 + 1);
      if (!side) {
        g.rect(3, h0, 1, 3, col.dark);
        g.rect(12, h0, 1, 3, col.dark);
        if (view === "back") g.rect(4, h0 + 1, 8, 1, col.dark);
      } else {
        g.rect(8, h0 + 1, 3, 2, col.dark);
        g.rect(11, h0 + 1, 2, 1, col.dark);
      }
      break;
    case "bowler":
      g.rect(6, h0 - 3, 4, 1, col.light);
      g.shaded(5, h0 - 2, 6, 2, col);
      g.rect(5, h0 - 1, 6, 1, trim.base);
      g.rect(3, h0, 10, 1, col.dark);
      break;
    case "top-hat":
      g.shaded(5, h0 - 3, 6, 3, col);
      g.rect(5, h0 - 1, 6, 1, trim.base);
      g.rect(3, h0, 10, 1, col.dark);
      g.rect(6, h0 - 3, 1, 2, col.light);
      break;
    case "flat-cap":
      g.shaded(4, h0 - 1, 8, 2, col);
      g.set(4, h0 - 1, null);
      g.set(11, h0 - 1, null);
      g.set(7, h0 - 2, col.base);
      g.set(8, h0 - 2, col.light);
      visor(col.dark, h0 + 1, 7);
      if (front) g.rect(4, h0 + 1, 8, 1, col.dark);
      break;
    case "bonnet":
      g.shaded(4, h0 - 2, 8, 3, col);
      g.set(4, h0 - 2, null);
      g.set(11, h0 - 2, null);
      g.rect(3, h0 + 1, 10, 1, trim.base);
      if (!side) {
        g.rect(3, h0 + 1, 1, 4, trim.base);
        g.rect(12, h0 + 1, 1, 4, trim.base);
        g.rect(4, h0 + 2, 1, 3, col.dark);
        g.rect(11, h0 + 2, 1, 3, col.dark);
      } else g.rect(8, h0 + 2, 4, 3, col.dark);
      g.set(5, h0 - 1, col.light);
      if (front) {
        g.set(5, c.h1 + 1, trim.base);
        g.set(10, c.h1 + 1, trim.base);
      }
      break;
    case "headscarf":
      g.shaded(4, h0 - 1, 8, 3, col);
      g.set(4, h0 - 1, null);
      g.set(11, h0 - 1, null);
      g.rect(4, h0 + 2, 1, 2, col.dark);
      g.rect(11, h0 + 2, 1, 2, col.dark);
      g.set(5, h0, trim.base);
      g.set(8, h0, trim.base);
      g.set(10, h0 + 1, trim.base);
      if (view === "back") g.rect(4, h0 + 1, 8, 4, col.base);
      else g.rect(11, h0 + 2, 2, 2, col.dark);
      break;
    case "bush-hat":
      g.shaded(5, h0 - 3, 6, 3, col);
      g.rect(5, h0 - 1, 6, 1, trim.base);
      g.rect(2, h0, 12, 1, col.dark);
      g.set(2, h0 + 1, col.dark);
      g.set(13, h0 + 1, col.dark);
      g.rect(3, h0, 3, 1, col.base);
      g.set(7, h0 - 3, col.light);
      break;
    case "straw-hat":
      g.shaded(5, h0 - 2, 6, 2, col);
      g.rect(5, h0 - 1, 6, 1, trim.base);
      g.rect(2, h0, 12, 1, col.dark);
      g.rect(3, h0, 8, 1, col.base);
      g.set(2, h0 + 1, col.dark);
      g.set(13, h0 + 1, col.dark);
      break;
    case "police-helmet":
      g.rect(7, h0 - 4, 2, 1, col.base);
      g.shaded(5, h0 - 3, 6, 3, col);
      g.rect(4, h0 - 1, 8, 1, col.dark);
      g.rect(7, h0 - 2, 2, 1, trim.base);
      visor(col.dark, h0, 8);
      if (front || view === "back") g.rect(4, h0, 8, 1, col.dark);
      break;
    case "chef-hat":
      g.shaded(4, h0 - 3, 8, 3, col);
      g.rect(5, h0 - 4, 2, 1, col.light);
      g.rect(9, h0 - 4, 2, 1, col.light);
      g.rect(4, h0 - 1, 8, 1, col.dark);
      g.rect(4, h0, 8, 1, trim.base);
      break;
    case "captain-cap":
      g.shaded(4, h0 - 2, 8, 2, col);
      g.rect(3, h0 - 3, 10, 1, trim.base);
      g.rect(3, h0 - 3, 10, 1, "#f0ede4");
      g.rect(4, h0 - 1, 8, 1, trim.base);
      g.rect(7, h0 - 2, 2, 1, "#e3b341");
      visor("#1d1a22", h0);
      if (front) g.rect(4, h0, 8, 1, "#1d1a22");
      break;
    case "peaked-cap":
      g.shaded(4, h0 - 2, 8, 2, col);
      g.rect(4, h0 - 1, 8, 1, trim.base);
      g.set(7, h0 - 2, "#e3b341");
      g.set(8, h0 - 2, "#e3b341");
      visor(col.dark, h0);
      if (front) g.rect(4, h0, 8, 1, col.dark);
      break;
    case "beret":
      g.shaded(4, h0 - 2, 8, 2, col);
      g.rect(3, h0 - 1, 9, 1, col.base);
      g.rect(3, h0, 2, 1, col.dark);
      g.set(7, h0 - 3, trim.base);
      break;
    case "woolly-hat":
      g.shaded(4, h0 - 2, 8, 3, col);
      g.rect(4, h0, 8, 1, trim.base);
      g.rect(7, h0 - 4, 2, 2, trim.base);
      break;
    case "hood":
      g.shaded(4, h0 - 1, 8, 2, col);
      g.shaded(3, h0, 2, c.headH + 1, col);
      g.shaded(11, h0, 2, c.headH + 1, col);
      break;
    case "veil-hat":
      g.shaded(4, h0 - 2, 8, 2, col);
      g.rect(3, h0, 10, 1, col.dark);
      g.set(5, h0 - 2, trim.base);
      for (let x = 4; x < 12; x += 1) {
        g.blend(x, h0 + 1, "#201828", 0.55);
        g.blend(x, h0 + 2, "#201828", 0.4);
      }
      break;
    default:
      break;
  }
}

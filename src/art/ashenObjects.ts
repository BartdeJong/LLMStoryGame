import { createPixelCanvas } from "./canvas";
import { PALETTES, type PaletteName } from "./palettes";

type SpritePattern = readonly [string, string, string, string, string, string, string, string];

const ASHEN_OBJECT_PATTERNS = {
  i_wren_docket: [
    "..####..",
    ".#pppp#.",
    ".#p##p#.",
    ".#p##p#.",
    ".#pppp#.",
    ".#p#p#p#",
    ".#pppp#.",
    "..####..",
  ],
  i_charred_envelope: [
    "..####..",
    ".#saa##.",
    "#pppppp#",
    "#p#pp#p#",
    "#pp##pp#",
    ".#pppp#.",
    "..####..",
    "...#....",
  ],
  i_ferry_token: [
    "..####..",
    ".#pppp#.",
    "#p#pp#p#",
    "#pp##pp#",
    "#pp##pp#",
    "#p#pp#p#",
    ".#pppp#.",
    "..####..",
  ],
  i_ward_receipt: [
    ".######.",
    "#pppppp#",
    "#p##ppp#",
    "#pppppp#",
    "#p##ppp#",
    "#pppppp#",
    "#p#..p#.",
    ".######.",
  ],
  i_press_proof: [
    ".######.",
    "#pppppp#",
    "#p####p#",
    "#p#pp#p#",
    "#pppppp#",
    "#p#p##p#",
    "#pppppp#",
    ".######.",
  ],
  i_duplicate_ledger: [
    "########",
    "#pp##pp#",
    "#p#p#pp#",
    "#p#p#pp#",
    "#pp##pp#",
    "#p#p#pp#",
    "#p#p#pp#",
    "########",
  ],
  cl_watson_inquest: [
    "..####..",
    ".#pppp#.",
    "#p####p#",
    "#pppppp#",
    "#p#p#pp#",
    "#pp##pp#",
    ".#pppp#.",
    "..####..",
  ],
  cl_ward_appeal: [
    "..####..",
    ".#pppp#.",
    "#p##ppp#",
    "#pp##pp#",
    "#p####p#",
    "#pp##pp#",
    ".#pppp#.",
    "..####..",
  ],
  cl_lestrade_keylog: [
    "##......",
    "#p##....",
    "#pp#....",
    ".##.####",
    "....#pp#",
    "....#p#.",
    ".....##.",
    "........",
  ],
  cl_wren_docket: [
    "########",
    "#pp##pp#",
    "#p#p#pp#",
    "#pp##pp#",
    "#p#p#pp#",
    "#pp##pp#",
    "#p#p#pp#",
    "########",
  ],
  cl_mortuary_fibres: [
    "...##...",
    "..#pp#..",
    ".#p##p#.",
    "#p#pp#p#",
    "#p#pp#p#",
    ".#p##p#.",
    "..#pp#..",
    "...##...",
  ],
  cl_unpaid_vouchers: [
    "..####..",
    ".#pppp#.",
    "#pppppp#",
    "#p##ppp#",
    "#pppppp#",
    ".#pppp#.",
    "..####..",
    "........",
  ],
  cl_river_drag: [
    "........",
    "..##....",
    ".#pp#...",
    "..#pp#..",
    "...#pp#.",
    "....#pp#",
    ".....##.",
    "........",
  ],
  cl_wax_initials: [
    "...##...",
    "..#aa#..",
    ".#appp#.",
    "#a#ppp#.",
    "#ap#pp#.",
    ".#appp#.",
    "..#aa#..",
    "...##...",
  ],
  cl_duplicate_key: [
    "..####..",
    ".#pppp#.",
    "..####..",
    "....##..",
    "....##..",
    "..######",
    "..##..##",
    "..##..##",
  ],
  cl_relief_columns: [
    ".######.",
    "#pppppp#",
    "#p#p#pp#",
    "#p#p#pp#",
    "#pp#p#p#",
    "#pp#p#p#",
    "#pppppp#",
    ".######.",
  ],
  cl_cab_entry: [
    ".######.",
    "#pppppp#",
    "#p##p#p#",
    "#pppppp#",
    "#p#p##p#",
    "#pppppp#",
    "#ppp#pp#",
    ".######.",
  ],
  cl_silas_pump_grease: [
    "...##...",
    "..#pp#..",
    "..#pp#..",
    ".#pppp#.",
    ".#pppp#.",
    ".#p##p#.",
    "..####..",
    "...##...",
  ],
  cl_token_register: [
    "########",
    "#pp##pp#",
    "#p#p#pp#",
    "#p#p#pp#",
    "#pp##pp#",
    "#ppp#p##",
    "#ppppp##",
    "########",
  ],
  cl_planting_trace: [
    "........",
    ".##..##.",
    ".##..##.",
    ".######.",
    "..####..",
    "...##...",
    "..#..#..",
    ".##..##.",
  ],
  cl_ada_receipt: [
    "...##...",
    "..#pp#..",
    ".#pppp#.",
    "#p#pp#p#",
    "#pppppp#",
    "#p#pp#p#",
    ".#pppp#.",
    "..####..",
  ],
  cl_envelope_proof: [
    ".######.",
    "#pppppp#",
    "#p#pp#p#",
    "#pp#ppp#",
    "#p##ppp#",
    "#pppppp#",
    "#p#p##p#",
    ".######.",
  ],
  cl_press_archive: [
    "########",
    "#pppppp#",
    "#p#pp#p#",
    "#pppppp#",
    "#p#pp#p#",
    "#pppppp#",
    "#pppppp#",
    "########",
  ],
} as const satisfies Readonly<Record<string, SpritePattern>>;

export type AshenObjectId = keyof typeof ASHEN_OBJECT_PATTERNS;
export const ASHEN_OBJECT_SPRITE_IDS = Object.keys(ASHEN_OBJECT_PATTERNS) as AshenObjectId[];

const spriteCache = new Map<string, HTMLCanvasElement>();

function isAshenObjectId(objectId: string): objectId is AshenObjectId {
  return Object.hasOwn(ASHEN_OBJECT_PATTERNS, objectId);
}

export function getAshenObjectSprite(objectId: string, paletteName: PaletteName): HTMLCanvasElement | null {
  if (!isAshenObjectId(objectId)) return null;

  const key = `${paletteName}:${objectId}`;
  let canvas = spriteCache.get(key);
  if (!canvas) {
    const { canvas: created, context } = createPixelCanvas();
    const palette = PALETTES[paletteName];
    const colors: Readonly<Record<string, string>> = {
      "#": palette.ink,
      p: palette.cream,
      s: palette.shadow,
      a: palette.accent,
    };
    const pattern = ASHEN_OBJECT_PATTERNS[objectId];
    pattern.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        const color = colors[row[x]!];
        if (color) {
          context.fillStyle = color;
          context.fillRect(x * 2, y * 2, 2, 2);
        }
      }
    });
    canvas = created;
    spriteCache.set(key, canvas);
  }
  return canvas;
}

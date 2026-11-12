import { Tile } from "./types";
import type { GridPoint, TileLayers } from "./types";

// The ASCII map format used for pre-baked areas in story packs (location.area.map).
// One string per row, all rows the same length: at most 40 wide and 24 high, at least 10 wide and 8 high.
// A smaller map is centred on screen with the background around it.
//
//   ' '  void (outside the area)          '#'  wall (drawn in the area's wall style)
//   '.'  floor (the area's floor style)   'R'  rug on the floor
//   'C'  counter / table / shelf run      'O'  boulder on the floor (caves)
//   ','  grass                            ':'  path
//   '~'  water                            '='  bridge over water
//   'T'  tree on grass                    'o'  rock on grass
//   '*'  flowers on grass                 '@'  floor where the player starts (start locations)
//   '1'..'9'  door to area.doors[n - 1]; a door to a location outside the current length is drawn as wall
export const MAP_MAX_WIDTH = 40;
export const MAP_MAX_HEIGHT = 24;
export const MAP_MIN_WIDTH = 10;
export const MAP_MIN_HEIGHT = 8;

const CELLS: Readonly<Record<string, readonly [ground: Tile, feature: Tile]>> = {
  " ": [Tile.Void, Tile.Grass],
  "#": [Tile.Floor, Tile.Wall],
  ".": [Tile.Floor, Tile.Grass],
  "@": [Tile.Floor, Tile.Grass],
  R: [Tile.Rug, Tile.Grass],
  C: [Tile.Floor, Tile.Counter],
  O: [Tile.Floor, Tile.Rock],
  ",": [Tile.Grass, Tile.Grass],
  ":": [Tile.Path, Tile.Grass],
  "~": [Tile.Water, Tile.Grass],
  "=": [Tile.Bridge, Tile.Grass],
  T: [Tile.Grass, Tile.Tree],
  o: [Tile.Grass, Tile.Rock],
  "*": [Tile.Grass, Tile.Flowers],
};

export const MAP_CHARACTERS = [...Object.keys(CELLS), "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export interface ParsedAreaMap {
  width: number;
  height: number;
  layers: TileLayers;
  doorSlots: Map<number, GridPoint>; // 1-based door number -> tile
  start?: GridPoint;
}

// Throws on an unknown character, a repeated door digit or ragged rows. Door tiles get Floor ground and a Door feature.
export function parseAreaMap(rows: readonly string[]): ParsedAreaMap {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const ground: Tile[][] = [];
  const feature: Tile[][] = [];
  const doorSlots = new Map<number, GridPoint>();
  let start: GridPoint | undefined;
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`Map row ${y} has ${row.length} characters; expected ${width}.`);
    const groundRow: Tile[] = [];
    const featureRow: Tile[] = [];
    [...row].forEach((char, x) => {
      if (char >= "1" && char <= "9") {
        const door = Number(char);
        if (doorSlots.has(door)) throw new Error(`Door ${door} appears twice in the map.`);
        doorSlots.set(door, { x, y });
        groundRow.push(Tile.Floor);
        featureRow.push(Tile.Door);
        return;
      }
      const cell = CELLS[char];
      if (!cell) throw new Error(`Unknown map character "${char}" at ${x},${y}.`);
      if (char === "@") start = { x, y };
      groundRow.push(cell[0]);
      featureRow.push(cell[1]);
    });
    ground.push(groundRow);
    feature.push(featureRow);
  });
  return { width, height, layers: { ground, feature }, doorSlots, start };
}

// The reverse, for the bake tool. `doors` maps "x,y" to a 1-based door number.
export function formatAreaMap(layers: TileLayers, doors: ReadonlyMap<string, number> = new Map(), start?: GridPoint): string[] {
  return layers.ground.map((row, y) => row.map((ground, x) => {
    const door = doors.get(`${x},${y}`);
    if (door !== undefined) return String(door);
    if (start && start.x === x && start.y === y) return "@";
    const feature = layers.feature[y]![x]!;
    for (const [char, [g, f]] of Object.entries(CELLS)) {
      if (char !== "@" && g === ground && f === feature) return char;
    }
    if (feature === Tile.Wall) return "#";
    if (feature === Tile.Tree) return "T";
    if (feature === Tile.Rock) return ground === Tile.Floor ? "O" : "o";
    if (feature === Tile.Flowers) return "*";
    if (feature === Tile.Counter) return "C";
    if (ground === Tile.Void) return " ";
    if (ground === Tile.Water) return "~";
    if (ground === Tile.Path) return ":";
    if (ground === Tile.Grass) return ",";
    return ".";
  }).join(""));
}

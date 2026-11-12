import { doorPointsForBearings } from "../world/doorSlots";
import type { GridPoint } from "../world/types";
import type { LengthView } from "./loader";
import { LENGTH_IDS, type StoryPack } from "./types";

// A location's place on the compass grid of the story world. Rows grow southwards, columns eastwards.
export interface LocationCell {
  readonly column: number;
  readonly row: number;
}

export type StoryWorldLayout = ReadonlyMap<string, LocationCell>;

// Offsets at one grid distance, nearest first; ties run clockwise from east so the result never depends on chance.
function ring(radius: number): LocationCell[] {
  const offsets: LocationCell[] = [];
  for (let row = -radius; row <= radius; row += 1) {
    for (let column = -radius; column <= radius; column += 1) {
      if (Math.max(Math.abs(column), Math.abs(row)) === radius) offsets.push({ column, row });
    }
  }
  const turn = (offset: LocationCell): number => (Math.atan2(offset.row, offset.column) + 2 * Math.PI) % (2 * Math.PI);
  return offsets.sort((a, b) =>
    Math.hypot(a.column, a.row) - Math.hypot(b.column, b.row) || turn(a) - turn(b));
}

// Every neighbour of a location in the whole pack. Doors work in both directions.
function packNeighbours(pack: StoryPack, locationId: string): string[] {
  const outgoing = pack.locations.find((location) => location.id === locationId)?.doors.map((door) => door.to) ?? [];
  const incoming = pack.locations.filter((other) => other.doors.some((door) => door.to === locationId)).map((other) => other.id);
  return [...new Set([...outgoing, ...incoming])].filter((id) => id !== locationId);
}

// Gives every location of the pack its own cell, so that a door can face the place it leads to and the map can show
// places where they really are. Connected places end up next to each other wherever there is room.
// The layout is the same for every story length (it starts from the longest length's start location), because the
// door sides are baked into the pack by Story Forge. `view` is accepted for older callers and ignored.
export function layoutStoryWorld(pack: StoryPack, _view?: LengthView): Map<string, LocationCell> {
  const ids = pack.locations.map((location) => location.id);
  const neighbours = new Map(ids.map((id) => [id, packNeighbours(pack, id)]));
  const cells = new Map<string, LocationCell>();
  const taken = new Set<string>();
  const key = (column: number, row: number): string => `${column},${row}`;
  const freeSides = (cell: LocationCell): number =>
    ([[1, 0], [0, 1], [-1, 0], [0, -1]] as const)
      .filter(([column, row]) => !taken.has(key(cell.column + column, cell.row + row))).length;

  const choose = (id: string, parent: LocationCell): LocationCell => {
    const linked = neighbours.get(id) ?? [];
    const placed = linked.flatMap((other) => cells.get(other) ?? []);
    const waiting = linked.filter((other) => !cells.has(other)).length;
    for (let radius = 1; ; radius += 1) {
      let best: LocationCell | undefined;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const offset of ring(radius)) {
        const cell = { column: parent.column + offset.column, row: parent.row + offset.row };
        if (taken.has(key(cell.column, cell.row))) continue;
        // Stay close to every place already linked to this one, prefer a straight neighbour over a diagonal one,
        // leave room for the places still to come, and keep the whole world compact.
        const score = placed.reduce((sum, other) => sum + Math.hypot(cell.column - other.column, cell.row - other.row), 0)
          + (offset.column !== 0 && offset.row !== 0 ? 0.5 : 0)
          + 0.5 * Math.max(0, waiting - freeSides(cell))
          + 0.05 * Math.hypot(cell.column, cell.row);
        if (score < bestScore - 1e-9) {
          best = cell;
          bestScore = score;
        }
      }
      if (best) return best;
    }
  };

  const spread = (startId: string, start: LocationCell): void => {
    cells.set(startId, start);
    taken.add(key(start.column, start.row));
    const queue = [startId];
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index]!;
      for (const other of neighbours.get(id) ?? []) {
        if (cells.has(other)) continue;
        const cell = choose(other, cells.get(id)!);
        cells.set(other, cell);
        taken.add(key(cell.column, cell.row));
        queue.push(other);
      }
    }
  };

  const origin = { column: 0, row: 0 };
  const longest = [...LENGTH_IDS].reverse().map((id) => pack.lengths[id]).find((definition) => definition !== undefined);
  const first = longest && ids.includes(longest.start_location) ? longest.start_location : ids[0];
  if (first !== undefined) spread(first, origin);
  for (const id of ids) {
    if (!cells.has(id)) spread(id, choose(id, origin));
  }
  return cells;
}

// Compass bearing in degrees from one cell to another: 0 is north, 90 is east.
export function bearingBetween(from: LocationCell, to: LocationCell): number {
  const degrees = Math.atan2(to.column - from.column, from.row - to.row) * 180 / Math.PI;
  return (degrees + 360) % 360;
}

// Door tiles for a location, one per destination and in the same order, each on the side that faces its destination.
// Returns undefined when a place is missing from the layout, so the caller can fall back to the default spots.
export function storyDoorPoints(
  layout: StoryWorldLayout,
  locationId: string,
  destinations: readonly string[],
): GridPoint[] | undefined {
  const here = layout.get(locationId);
  if (!here) return undefined;
  const bearings: number[] = [];
  for (const destination of destinations) {
    const there = layout.get(destination);
    if (!there) return undefined;
    bearings.push(bearingBetween(here, there));
  }
  return doorPointsForBearings(bearings);
}

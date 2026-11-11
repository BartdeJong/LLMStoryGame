import { AREA_HEIGHT, AREA_WIDTH } from "./connectivity";
import type { GridPoint } from "./types";

const SLOT_DEGREES = 22.5;

// Sixteen door spots around the edge of an area, clockwise from north in steps of 22.5 degrees.
// The spots on the north and south edges stay near the middle, so the path carved to them misses the village houses.
function doorSlots(): GridPoint[] {
  const centerX = Math.floor(AREA_WIDTH / 2);
  const centerY = Math.floor(AREA_HEIGHT / 2);
  const left = 2;
  const right = AREA_WIDTH - 3;
  const top = 2;
  const bottom = AREA_HEIGHT - 3;
  return [
    { x: centerX, y: top },
    { x: centerX + 5, y: top },
    { x: right, y: top + 1 },
    { x: right, y: centerY - 5 },
    { x: right, y: centerY },
    { x: right, y: centerY + 5 },
    { x: right, y: bottom - 1 },
    { x: centerX + 5, y: bottom },
    { x: centerX, y: bottom },
    { x: centerX - 5, y: bottom },
    { x: left, y: bottom - 1 },
    { x: left, y: centerY + 5 },
    { x: left, y: centerY },
    { x: left, y: centerY - 5 },
    { x: left, y: top + 1 },
    { x: centerX - 5, y: top },
  ];
}

// One door spot per compass bearing (degrees, 0 is north and 90 is east), in the same order.
// Each door takes the free spot nearest to its bearing, so two doors never share a tile.
export function doorPointsForBearings(bearings: readonly number[]): GridPoint[] {
  const slots = doorSlots();
  const taken = new Set<number>();
  return bearings.map((bearing) => {
    const preferred = Math.round((((bearing % 360) + 360) % 360) / SLOT_DEGREES) % slots.length;
    for (let step = 0; step <= slots.length / 2; step += 1) {
      for (const offset of step === 0 ? [0] : [step, -step]) {
        const index = (preferred + offset + slots.length) % slots.length;
        if (taken.has(index)) continue;
        taken.add(index);
        return slots[index]!;
      }
    }
    throw new Error(`An area has room for ${slots.length} doors, but ${bearings.length} were requested.`);
  });
}

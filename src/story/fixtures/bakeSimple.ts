import { mapPackBiome, mapPackPalette, paletteForBiome } from "../recipes";
import { LENGTH_IDS, type AuthoredArea, type StoryPack } from "../types";

// Test helper: gives every location of a pack a plain hand-made area (a walled room, doors along the top wall,
// the things in a row below them, keyed by entity id), so game logic can be tested without depending on the real baked packs.
// The `@` tile is put on the start location of every length.
export function bakeSimple(source: unknown): unknown {
  const pack = structuredClone(source) as StoryPack;
  const starts = new Set(LENGTH_IDS.flatMap((id) => pack.lengths[id]?.start_location ?? []));
  for (const location of pack.locations) {
    const neighbours = [...new Set([
      ...location.doors.map((door) => door.to),
      ...pack.locations.filter((other) => other.doors.some((door) => door.to === location.id)).map((other) => other.id),
    ])];
    const things = [
      ...location.objects.map((object) => `obj:${object.id}`),
      ...pack.items.filter((item) => item.found_at?.type === "location" && item.found_at.id === location.id).map((item) => `item:${item.id}`),
      ...location.required_characters.map((id) => `char:${id}`),
      ...pack.clues
        .filter((clue) => [clue.where, ...clue.alternatives].some((ref) => ref.type === "location" && ref.id === location.id))
        .map((clue) => `clue:${clue.id}`),
    ];
    const width = Math.max(14, neighbours.length * 2 + 3);
    const rows = Array.from({ length: 8 }, (_, y) => (y === 0 || y === 7 ? "#".repeat(width) : "#" + ".".repeat(width - 2) + "#").split(""));
    neighbours.forEach((_, index) => { rows[0]![index * 2 + 2] = String(index + 1); });
    if (starts.has(location.id)) rows[6]![1] = "@";
    const placements: Record<string, [number, number]> = {};
    things.forEach((id, index) => { placements[id] = [1 + (index % (width - 2)), 2 + Math.floor(index / (width - 2))]; });
    const biome = mapPackBiome(location.biome) ?? "meadow";
    const area: AuthoredArea = {
      description: `A plain place called ${location.name}.`,
      doors: neighbours.map((to, index) => ({ to, label: `Way ${index + 1}`, hint: "A way onward." })),
      biome,
      palette: mapPackPalette(location.palette) ?? paletteForBiome(biome),
      floor: "boards",
      wall: "plaster",
      map: rows.map((row) => row.join("")),
      placements,
      decor: [],
    };
    location.area = area;
  }
  return pack;
}

import { createSeededRandom, hashSeed } from "../art/random";
import { allPointsReachable, isWalkable, reachableTiles } from "../world/connectivity";
import { generateArea } from "../world/generators";
import type { Area, AreaBrief, AreaDoor, AreaEntity, EntitySpawnPoint, GridPoint, SpawnKind } from "../world/types";
import { Tile } from "../world/types";
import type { StoryAreaBrief } from "./briefs";

interface PendingEntity {
  id: string;
  kind: SpawnKind;
  required: boolean;
  make: (point: GridPoint) => AreaEntity;
}

function entityRequests(brief: StoryAreaBrief): PendingEntity[] {
  const requests: PendingEntity[] = [];
  const base = (id: string, kind: SpawnKind, required: boolean) => ({ id, kind, required });
  brief.characters.forEach((character, index) => {
    const id = character.castId ? `char:${character.castId}` : `extra-char:${index}`;
    requests.push({
      ...base(id, "character", character.required),
      make: (point) => ({
        ...point, id, kind: "character", required: character.required, packId: character.castId ?? undefined,
        name: character.name, description: character.personality, character: character.recipe,
      }),
    });
  });
  brief.objects.forEach((object, index) => {
    const id = object.packId ? `${object.keyItem ? "item" : "obj"}:${object.packId}` : `extra-obj:${index}`;
    const kind: SpawnKind = object.keyItem ? "key" : "object";
    requests.push({
      ...base(id, kind, object.required),
      make: (point) => ({
        ...point, id, kind, required: object.required, packId: object.packId ?? undefined,
        name: object.name, description: object.description, icon: object.icon,
        visual: object.visual, visualInferred: object.visualInferred,
      }),
    });
  });
  for (const clue of brief.clues) {
    const id = `clue:${clue.id}`;
    requests.push({
      ...base(id, "clue", true),
      make: (point) => ({
        ...point, id, kind: "clue", required: true, packId: clue.id, truthId: clue.truthId ?? undefined,
        name: "Something to examine", description: clue.text,
        icon: { shape: "gem", primaryColor: "highlight", secondaryColor: "cream" },
      }),
    });
  }
  // Required entities first so minor extras can never crowd them out.
  return requests.sort((a, b) => Number(b.required) - Number(a.required));
}

function candidateTiles(area: Area, random: () => number): { open: GridPoint[]; other: GridPoint[] } {
  const reachable = reachableTiles(area, area.entry);
  const doorZone = new Set<string>();
  for (const door of area.doors) {
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) doorZone.add(`${door.x + dx},${door.y + dy}`);
  }
  const open: GridPoint[] = [];
  const other: GridPoint[] = [];
  for (let y = 0; y < area.height; y += 1) {
    for (let x = 0; x < area.width; x += 1) {
      if (!reachable.has(`${x},${y}`) || area.layers.feature[y]![x] === Tile.Door) continue;
      const roomy = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => isWalkable(area, x + dx!, y + dy!));
      if (roomy && !doorZone.has(`${x},${y}`) && !(x === area.entry.x && y === area.entry.y)) open.push({ x, y });
      else other.push({ x, y });
    }
  }
  const shuffle = (list: GridPoint[]) => {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
  };
  shuffle(open);
  shuffle(other);
  return { open, other };
}

// Brief-to-map: generate the layout from the brief's biome, then place the story entities on reachable tiles.
export function buildStoryArea(brief: StoryAreaBrief, storySeed: string): Area {
  const seed = hashSeed(`${storySeed}:${brief.locationId}`);
  const generatorBrief: AreaBrief = {
    name: brief.name,
    biome: brief.biome,
    mood: brief.mood,
    palette: brief.palette,
    doorLabels: brief.doors.map((door) => door.label),
  };
  const generated = generateArea(seed, generatorBrief);
  const doors: AreaDoor[] = generated.doors.map((door, index) => ({ ...door, targetAreaId: brief.doors[index]?.to }));

  const random = createSeededRandom(`${String(seed)}:placement`);
  const { open, other } = candidateTiles(generated, random);
  const taken: GridPoint[] = [];
  const entities: AreaEntity[] = [];
  const spaced = (point: GridPoint) => taken.every((t) => Math.max(Math.abs(t.x - point.x), Math.abs(t.y - point.y)) >= 2);

  for (const request of entityRequests(brief)) {
    // Prefer roomy tiles that are not next to another entity, then relax.
    const pool = [open, other];
    let chosen: GridPoint | undefined;
    for (const relaxed of [false, true]) {
      for (const list of pool) {
        const index = list.findIndex((point) => relaxed || spaced(point));
        if (index >= 0) { chosen = list.splice(index, 1)[0]; break; }
      }
      if (chosen) break;
    }
    if (!chosen) {
      if (request.required) throw new Error(`No reachable tile for "${request.id}" in "${brief.locationId}".`);
      continue;
    }
    taken.push(chosen);
    entities.push(request.make(chosen));
  }

  const spawnPoints: EntitySpawnPoint[] = entities.map(({ id, kind, x, y }) => ({ id, kind, x, y }));
  const area: Area = { ...generated, id: brief.locationId, doors, spawnPoints, entities };
  if (!allPointsReachable(area)) throw new Error(`Area "${brief.locationId}" has unreachable points.`);
  return area;
}

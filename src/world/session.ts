import { hashSeed, type Seed } from "../art/random";
import { getPlaceholderBrief } from "./briefs";
import { isWalkable } from "./connectivity";
import { generateArea } from "./generators";
import type { Area, AreaDoor, Biome, GridPoint } from "./types";

const BIOME_CONNECTIONS: Readonly<Record<Biome, readonly Biome[]>> = {
  meadow: ["forest", "village", "shore"],
  forest: ["cave", "meadow", "ruins"],
  shore: ["village", "cave", "meadow"],
  cave: ["ruins", "forest", "building"],
  building: ["village", "ruins", "meadow"],
  ruins: ["cave", "forest", "building"],
  village: ["meadow", "building", "shore"],
};

export interface AreaTransition {
  readonly area: Area;
  readonly spawn: GridPoint;
  readonly generated: boolean;
  readonly doorLabel: string;
}

function copyArea(area: Area, changes: Partial<Area>): Area {
  return { ...area, ...changes };
}

function doorSpawn(area: Area, door: AreaDoor): GridPoint {
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
    const point = { x: door.x + dx, y: door.y + dy };
    if (isWalkable(area, point.x, point.y)) return point;
  }
  throw new Error(`Door "${door.id}" in area "${area.id}" has no walkable entry tile.`);
}

export class WorldSession {
  private readonly areas = new Map<string, Area>();

  constructor(initialArea: Area) {
    this.areas.set(initialArea.id, initialArea);
  }

  get initialAreaId(): string {
    const firstArea = this.areas.keys().next().value;
    if (!firstArea) throw new Error("The world session has no initial area.");
    return firstArea;
  }

  getArea(areaId: string): Area {
    const area = this.areas.get(areaId);
    if (!area) throw new Error(`Area "${areaId}" has not been visited.`);
    return area;
  }

  enterDoor(areaId: string, doorId: string): AreaTransition {
    const source = this.getArea(areaId);
    const door = source.doors.find((candidate) => candidate.id === doorId);
    if (!door) throw new Error(`Area "${areaId}" has no door "${doorId}".`);

    if (door.targetAreaId) {
      const target = this.getArea(door.targetAreaId);
      const returnDoor = target.doors.find((candidate) => candidate.targetAreaId === source.id);
      if (!returnDoor) throw new Error(`Area "${target.id}" is missing its return door to "${source.id}".`);
      return {
        area: target,
        spawn: doorSpawn(target, returnDoor),
        generated: false,
        doorLabel: returnDoor.label,
      };
    }

    const options = BIOME_CONNECTIONS[source.biome];
    const doorIndex = source.doors.findIndex((candidate) => candidate.id === door.id);
    const choice = (hashSeed(`${String(source.seed)}:${source.id}`) + doorIndex) % options.length;
    const biome = options[choice]!;
    const seed: Seed = hashSeed(`${String(source.seed)}:${source.id}:${door.id}:area`);
    const brief = getPlaceholderBrief(biome);
    const generated = generateArea(seed, brief);
    if (this.areas.has(generated.id)) {
      throw new Error(`Generated area id "${generated.id}" is already in use.`);
    }

    const returnDoor = generated.doors[0];
    if (!returnDoor) throw new Error(`Generated area "${generated.id}" has no door for its return path.`);
    const linkedTarget = copyArea(generated, {
      doors: generated.doors.map((candidate) =>
        candidate.id === returnDoor.id
          ? { ...candidate, label: `Back to ${source.name}`, targetAreaId: source.id }
          : candidate),
    });
    const linkedSource = copyArea(source, {
      doors: source.doors.map((candidate) =>
        candidate.id === door.id ? { ...candidate, targetAreaId: generated.id } : candidate),
    });
    this.areas.set(source.id, linkedSource);
    this.areas.set(linkedTarget.id, linkedTarget);

    return {
      area: linkedTarget,
      spawn: linkedTarget.entry,
      generated: true,
      doorLabel: door.label,
    };
  }

  get visitedAreaCount(): number {
    return this.areas.size;
  }
}

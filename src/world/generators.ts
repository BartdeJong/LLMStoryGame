import { createSeededRandom, type Seed } from "../art/random";
import { AREA_HEIGHT, AREA_WIDTH, createLayers, repairReachability } from "./connectivity";
import type { Area, AreaBrief, AreaDoor, Biome, DoorKind, EntitySpawnPoint, GridPoint } from "./types";
import { Tile } from "./types";

function makeBase(seed: Seed, brief: AreaBrief, ground: Tile): Area {
  const random = createSeededRandom(`${String(seed)}:${brief.biome}:${brief.name}:${brief.mood}:${brief.palette}`);
  const entry = { x: Math.floor(AREA_WIDTH / 2), y: Math.floor(AREA_HEIGHT / 2) };
  const layers = createLayers(ground);
  const id = `${brief.biome}-${createSeededRandom(`${String(seed)}:${brief.name}`)().toString(36).slice(2, 10)}`;
  const area: Area = {
    id,
    seed,
    name: brief.name,
    biome: brief.biome,
    mood: brief.mood,
    palette: brief.palette,
    width: AREA_WIDTH,
    height: AREA_HEIGHT,
    layers,
    entry,
    spawnPoints: [],
    doors: [],
  };
  return populatePoints(area, brief, random);
}

function populatePoints(area: Area, brief: AreaBrief, random: () => number): Area {
  const centerX = area.entry.x;
  const centerY = area.entry.y;
  const spawnPoints: EntitySpawnPoint[] = [
    { id: "local-character", kind: "character", x: centerX - 2, y: centerY - 1 },
    { id: "local-object", kind: "object", x: centerX + 2, y: centerY - 1 },
    { id: "local-key", kind: "key", x: centerX, y: centerY + 2 },
  ];
  const doorKind: DoorKind = area.biome === "cave"
    ? "cave-mouth"
    : area.biome === "village"
      ? "gate"
      : area.biome === "building" || area.biome === "ruins"
        ? "hatch"
        : "edge";
  const doorCandidates: readonly GridPoint[] = [
    { x: 2, y: centerY },
    { x: area.width - 3, y: centerY },
    { x: centerX, y: 2 },
    { x: centerX, y: area.height - 3 },
    { x: 2, y: 3 },
    { x: area.width - 3, y: area.height - 4 },
  ];
  const doors: AreaDoor[] = brief.doorLabels.map((label, index) => {
    const point = doorCandidates[index % doorCandidates.length]!;
    return { id: `door-${index}`, label, kind: doorKind, ...point };
  });
  const mutable = area as { spawnPoints: readonly EntitySpawnPoint[]; doors: readonly AreaDoor[] };
  mutable.spawnPoints = spawnPoints.map((point) => ({
    ...point,
    x: Math.max(1, Math.min(area.width - 2, point.x + Math.floor(random() * 3) - 1)),
    y: Math.max(1, Math.min(area.height - 2, point.y + Math.floor(random() * 3) - 1)),
  }));
  mutable.doors = doors;
  for (const door of doors) area.layers.feature[door.y]![door.x] = Tile.Door;
  return area;
}

function finish(area: Area): Area {
  repairReachability(area);
  for (const door of area.doors) area.layers.feature[door.y]![door.x] = Tile.Door;
  return area;
}

export function generateOutdoors(seed: Seed, brief: AreaBrief): Area {
  if (!["meadow", "forest", "shore"].includes(brief.biome)) {
    throw new Error(`Outdoor generator cannot create biome "${brief.biome}".`);
  }
  const area = makeBase(seed, brief, Tile.Grass);
  const random = createSeededRandom(`outdoor-noise:${String(seed)}:${brief.biome}:${brief.name}`);
  const chance = brief.biome === "forest" ? 0.34 : brief.biome === "shore" ? 0.17 : 0.11;
  const field = Array.from({ length: area.height }, () =>
    Array.from({ length: area.width }, () => random()));
  for (let y = 1; y < area.height - 1; y += 1) {
    for (let x = 1; x < area.width - 1; x += 1) {
      const neighborhood = [
        field[y]![x]!, field[y - 1]![x]!, field[y + 1]![x]!,
        field[y]![x - 1]!, field[y]![x + 1]!,
      ];
      const noise = neighborhood.reduce((sum, value) => sum + value, 0) / neighborhood.length;
      if (brief.biome === "shore" && x > area.width - 9 + Math.floor(y / 5)) {
        area.layers.ground[y]![x] = Tile.Water;
      } else if (noise < chance) {
        area.layers.feature[y]![x] = brief.biome === "forest" || random() > 0.45 ? Tile.Tree : Tile.Flowers;
      } else if (brief.biome === "shore" && noise > 0.78) {
        area.layers.feature[y]![x] = Tile.Rock;
      }
    }
  }
  return finish(area);
}

function connectCaveCells(area: Area): void {
  const walls = Array.from({ length: area.height }, (_, y) =>
    Array.from({ length: area.width }, (_, x) => area.layers.feature[y]![x] === Tile.Wall));
  for (let pass = 0; pass < 5; pass += 1) {
    const next = walls.map((row) => row.slice());
    for (let y = 1; y < area.height - 1; y += 1) {
      for (let x = 1; x < area.width - 1; x += 1) {
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if ((dx !== 0 || dy !== 0) && walls[y + dy]![x + dx]) neighbors += 1;
          }
        }
        next[y]![x] = neighbors >= 5;
      }
    }
    for (let y = 0; y < area.height; y += 1) {
      walls[y] = next[y]!;
    }
  }
  for (let y = 0; y < area.height; y += 1) {
    for (let x = 0; x < area.width; x += 1) {
      area.layers.feature[y]![x] = walls[y]![x] ? Tile.Rock : Tile.Grass;
    }
  }
}

export function generateCave(seed: Seed, brief: AreaBrief): Area {
  if (brief.biome !== "cave") throw new Error(`Cave generator cannot create biome "${brief.biome}".`);
  const area = makeBase(seed, brief, Tile.Floor);
  const random = createSeededRandom(`cave-cells:${String(seed)}:${brief.name}`);
  for (let y = 0; y < area.height; y += 1) {
    for (let x = 0; x < area.width; x += 1) {
      area.layers.feature[y]![x] = x === 0 || y === 0 || x === area.width - 1 || y === area.height - 1 || random() < 0.46
        ? Tile.Rock
        : Tile.Grass;
    }
  }
  connectCaveCells(area);
  return finish(area);
}

function room(area: Area, x: number, y: number, width: number, height: number): GridPoint {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const border = px === x || py === y || px === x + width - 1 || py === y + height - 1;
      area.layers.ground[py]![px] = Tile.Floor;
      area.layers.feature[py]![px] = border ? Tile.Wall : Tile.Grass;
    }
  }
  return { x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) };
}

function createRooms(seed: Seed, brief: AreaBrief): Area {
  const area = makeBase(seed, brief, Tile.Grass);
  for (const row of area.layers.feature) row.fill(Tile.Wall);
  const random = createSeededRandom(`rooms:${String(seed)}:${brief.biome}:${brief.name}`);
  const centers: GridPoint[] = [];
  const roomCount = 4 + Math.floor(random() * 3);
  const cellWidth = Math.floor((area.width - 2) / 3);
  const cellHeight = Math.floor((area.height - 2) / 2);
  for (let index = 0; index < roomCount; index += 1) {
    const column = index % 3;
    const rowIndex = Math.floor(index / 3);
    const cellX = 1 + column * cellWidth;
    const cellY = 1 + rowIndex * cellHeight;
    const width = Math.min(cellWidth - 1, 5 + Math.floor(random() * 5));
    const height = Math.min(cellHeight - 1, 5 + Math.floor(random() * 4));
    const x = cellX + Math.floor(random() * Math.max(1, cellWidth - width));
    const y = cellY + Math.floor(random() * Math.max(1, cellHeight - height));
    centers.push(room(area, x, y, width, height));
  }
  for (let index = 1; index < centers.length; index += 1) {
    const from = centers[index - 1]!;
    const to = centers[index]!;
    const horizontalFirst = random() > 0.5;
    const steps: GridPoint[] = horizontalFirst
      ? [{ x: to.x, y: from.y }, to]
      : [{ x: from.x, y: to.y }, to];
    let current = from;
    for (const end of steps) {
      while (current.x !== end.x || current.y !== end.y) {
        current = {
          x: current.x + Math.sign(end.x - current.x),
          y: current.y + Math.sign(end.y - current.y),
        };
        area.layers.ground[current.y]![current.x] = Tile.Floor;
        area.layers.feature[current.y]![current.x] = Tile.Grass;
      }
    }
  }
  return area;
}

export function generateBuilding(seed: Seed, brief: AreaBrief): Area {
  if (brief.biome !== "building") throw new Error(`Building generator cannot create biome "${brief.biome}".`);
  return finish(createRooms(seed, brief));
}

export function generateRuins(seed: Seed, brief: AreaBrief): Area {
  if (brief.biome !== "ruins") throw new Error(`Ruins generator cannot create biome "${brief.biome}".`);
  const area = createRooms(seed, brief);
  const random = createSeededRandom(`ruin-overgrowth:${String(seed)}:${brief.name}`);
  for (let y = 1; y < area.height - 1; y += 1) {
    for (let x = 1; x < area.width - 1; x += 1) {
      if (random() < 0.12 && area.layers.ground[y]![x] === Tile.Grass) {
        area.layers.ground[y]![x] = Tile.Grass;
        area.layers.feature[y]![x] = Tile.Tree;
      }
    }
  }
  return finish(area);
}

export function generateVillage(seed: Seed, brief: AreaBrief): Area {
  if (brief.biome !== "village") throw new Error(`Village generator cannot create biome "${brief.biome}".`);
  const area = makeBase(seed, brief, Tile.Grass);
  const roadY = Math.floor(area.height / 2);
  const roadX = Math.floor(area.width / 2);
  for (let x = 1; x < area.width - 1; x += 1) area.layers.ground[roadY]![x] = Tile.Path;
  for (let y = 1; y < area.height - 1; y += 1) area.layers.ground[y]![roadX] = Tile.Path;
  for (const [x, y] of [[4, 3], [26, 3], [4, 16], [27, 16]] as const) {
    for (let py = y; py < y + 5; py += 1) {
      for (let px = x; px < x + 7; px += 1) {
        const border = px === x || py === y || px === x + 6 || py === y + 4;
        area.layers.ground[py]![px] = border ? Tile.Grass : Tile.Floor;
        area.layers.feature[py]![px] = border ? Tile.Wall : Tile.Grass;
      }
    }
    const doorX = x + 3;
    const doorY = y + 4;
    area.layers.feature[doorY]![doorX] = Tile.Door;
    area.layers.ground[doorY]![doorX] = Tile.Path;
  }
  return finish(area);
}

export function generateArea(seed: Seed, brief: AreaBrief): Area {
  switch (brief.biome as Biome) {
    case "meadow":
    case "forest":
    case "shore":
      return generateOutdoors(seed, brief);
    case "cave":
      return generateCave(seed, brief);
    case "building":
      return generateBuilding(seed, brief);
    case "ruins":
      return generateRuins(seed, brief);
    case "village":
      return generateVillage(seed, brief);
  }
}

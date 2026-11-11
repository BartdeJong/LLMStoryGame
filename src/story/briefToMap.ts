import { createSeededRandom, hashSeed } from "../art/random";
import { getGlyph, tokenizeVisualText } from "../art/glyphs";
import { allPointsReachable, isWalkable, reachableTiles } from "../world/connectivity";
import { generateArea } from "../world/generators";
import type { Area, AreaBrief, AreaDoor, AreaEntity, EntitySpawnPoint, GridPoint, SpawnKind } from "../world/types";
import { Tile } from "../world/types";
import type { BriefCharacter, BriefClue, BriefObject, StoryAreaBrief } from "./briefs";

type ObjectPlacement = "wall-mounted" | "against-wall" | "free-standing" | "outdoor";

interface PendingEntity {
  id: string;
  kind: SpawnKind;
  required: boolean;
  make: (point: GridPoint) => AreaEntity;
  object?: BriefObject;
  character?: BriefCharacter;
  clue?: BriefClue;
}

interface TileCandidates {
  all: GridPoint[];
  open: GridPoint[];
  other: GridPoint[];
  room: GridPoint[];
  wallMounted: GridPoint[];
  againstWall: GridPoint[];
  wallMountedRoom: GridPoint[];
  againstWallRoom: GridPoint[];
}

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const WALL_MOUNTED_WORDS = new Set(["window", "shelf", "poster", "banner", "plaque", "hook", "rail", "notice", "board"]);
const WALL_MOUNTED_TAGS = new Set(["window", "shelf", "poster", "banner", "plaque", "notice", "board", "wall"]);
const WALL_FURNITURE_WORDS = new Set(["desk", "cot", "cupboard", "bench", "chair", "table", "bed", "cabinet", "wardrobe"]);
const OUTDOOR_WORDS = new Set([
  "path", "trail", "road", "water", "river", "sea", "shore", "beach", "bank", "garden", "flower", "tree", "plant",
  "reed", "boat", "outdoor", "edge",
]);
const PLACEMENT_STOP_WORDS = new Set([
  "about", "after", "again", "also", "been", "before", "being", "could", "found", "from", "have", "help", "into",
  "just", "keep", "near", "once", "place", "room", "someone", "something", "stay", "that", "their", "there", "they",
  "this", "through", "thing", "want", "what", "when", "where", "which", "with", "would", "your",
]);

function words(text: string): Set<string> {
  return new Set(tokenizeVisualText(text).filter((word) => !PLACEMENT_STOP_WORDS.has(word)));
}

function entityRequests(brief: StoryAreaBrief): PendingEntity[] {
  const requests: PendingEntity[] = [];
  brief.characters.forEach((character, index) => {
    const id = character.castId ? `char:${character.castId}` : `extra-char:${index}`;
    requests.push({
      id, kind: "character", required: character.required, character,
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
      id, kind, required: object.required, object,
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
      id, kind: "clue", required: true, clue,
      make: (point) => ({
        ...point, id, kind: "clue", required: true, packId: clue.id, truthId: clue.truthId ?? undefined,
        name: "Something to examine", description: clue.text,
        icon: { shape: "gem", primaryColor: "highlight", secondaryColor: "cream" },
      }),
    });
  }
  return requests;
}

function objectGlyph(object: BriefObject) {
  const direct = getGlyph(object.visual.icon);
  return direct ?? (object.visual.icon.endsWith("_open") ? getGlyph(object.visual.icon.slice(0, -5)) : undefined);
}

function classifyObject(object: BriefObject): ObjectPlacement {
  const glyph = objectGlyph(object);
  const namedWords = words(`${object.name} ${glyph?.name ?? ""}`);
  const glyphTags = new Set(glyph?.tags.flatMap((tag) => tokenizeVisualText(tag)) ?? []);
  if ([...WALL_MOUNTED_WORDS].some((word) => namedWords.has(word))
    || [...WALL_MOUNTED_TAGS].some((word) => glyphTags.has(word))
    || glyph?.id === "hook") return "wall-mounted";
  if ([...WALL_FURNITURE_WORDS].some((word) => namedWords.has(word)) || glyph?.category === "furniture") {
    return "against-wall";
  }
  const allWords = new Set([...namedWords, ...glyphTags, ...words(object.description)]);
  if (glyph?.category === "nature" || [...OUTDOOR_WORDS].some((word) => allWords.has(word))) return "outdoor";
  return "free-standing";
}

function candidateTiles(area: Area, random: () => number): TileCandidates {
  const reachable = reachableTiles(area, area.entry);
  const doorZone = new Set<string>();
  for (const door of area.doors) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) doorZone.add(`${door.x + dx},${door.y + dy}`);
    }
  }
  const all: GridPoint[] = [];
  for (let y = 0; y < area.height; y += 1) {
    for (let x = 0; x < area.width; x += 1) {
      if (!reachable.has(`${x},${y}`) || area.layers.feature[y]![x] === Tile.Door
        || (x === area.entry.x && y === area.entry.y)) continue;
      all.push({ x, y });
    }
  }
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [all[i], all[j]] = [all[j]!, all[i]!];
  }

  const open = all.filter((point) => DIRECTIONS.every(([dx, dy]) => isWalkable(area, point.x + dx, point.y + dy))
    && !doorZone.has(`${point.x},${point.y}`)
    && !(point.x === area.entry.x && point.y === area.entry.y));
  const openKeys = new Set(open.map(({ x, y }) => `${x},${y}`));
  const other = all.filter((point) => !openKeys.has(`${point.x},${point.y}`));
  const room = open.filter((point) => area.layers.ground[point.y]?.[point.x] === Tile.Floor);
  const indoor = area.biome === "building" || area.biome === "ruins";
  const wallMounted = indoor ? all.filter((point) =>
    area.layers.ground[point.y]?.[point.x] === Tile.Floor
      && area.layers.feature[point.y - 1]?.[point.x] === Tile.Wall,
  ) : [];
  const againstWall = indoor ? all.filter((point) =>
    area.layers.ground[point.y]?.[point.x] === Tile.Floor
      && DIRECTIONS.some(([dx, dy]) => area.layers.feature[point.y + dy]?.[point.x + dx] === Tile.Wall),
  ) : [];
  const roomy = (point: GridPoint): boolean => {
    let count = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) if ((dx || dy) && isWalkable(area, point.x + dx, point.y + dy)) count += 1;
    }
    return count >= 4;
  };
  const wallMountedRoom = wallMounted.filter(roomy);
  const againstWallRoom = againstWall.filter(roomy);
  return { all, open, other, room, wallMounted, againstWall, wallMountedRoom, againstWallRoom };
}

function chooseCandidate(
  pools: readonly (readonly GridPoint[])[],
  available: ReadonlySet<string>,
  taken: readonly GridPoint[],
  preferSpacing = true,
): GridPoint | undefined {
  const spaced = (point: GridPoint) =>
    taken.every((other) => Math.max(Math.abs(other.x - point.x), Math.abs(other.y - point.y)) >= 2);
  for (const relaxed of [false, true]) {
    for (const pool of pools) {
      const point = pool.find((candidate) =>
        available.has(`${candidate.x},${candidate.y}`) && (relaxed || !preferSpacing || spaced(candidate)),
      );
      if (point) return point;
    }
  }
  return undefined;
}

function neighboringPoints(point: GridPoint): GridPoint[] {
  return DIRECTIONS.map(([dx, dy]) => ({ x: point.x + dx, y: point.y + dy }));
}

function overlapCount(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let matches = 0;
  for (const word of a) if (b.has(word)) matches += 1;
  return matches;
}

function objectKeywords(object: BriefObject, includeTags: boolean): Set<string> {
  const glyph = objectGlyph(object);
  const tags = includeTags ? glyph?.tags.join(" ") ?? "" : "";
  return words(`${object.name} ${glyph?.name ?? ""} ${tags}`);
}

function bestObjectMatch(
  request: PendingEntity,
  placedObjects: readonly { request: PendingEntity; point: GridPoint }[],
): GridPoint | undefined {
  if (request.character) {
    const characterWords = words([
      request.character.name,
      request.character.species,
      request.character.personality,
      request.character.goal,
      request.character.secret,
    ].join(" "));
    return placedObjects
      .map(({ request: objectRequest, point }) => ({
        point,
        score: objectRequest.object ? overlapCount(characterWords, objectKeywords(objectRequest.object, true)) : 0,
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0]?.point;
  }
  if (request.clue) {
    const clueWords = words(`${request.clue.id} ${request.clue.where} ${request.clue.text}`);
    return placedObjects
      .map(({ request: objectRequest, point }) => ({
        point,
        score: objectRequest.object ? overlapCount(clueWords, objectKeywords(objectRequest.object, false)) : 0,
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0]?.point;
  }
  return undefined;
}

function outdoorCandidates(area: Area, object: BriefObject, candidates: TileCandidates): GridPoint[] {
  const glyph = objectGlyph(object);
  const content = words(`${object.name} ${object.description} ${glyph?.tags.join(" ") ?? ""}`);
  const feature = content.has("water") || content.has("river") || content.has("sea") || content.has("shore")
    || content.has("beach") || content.has("bank")
    ? "water"
    : content.has("edge")
      ? "edge"
      : "path";
  const distance = (point: GridPoint): number => {
    if (feature === "edge") return Math.min(point.x, point.y, area.width - 1 - point.x, area.height - 1 - point.y);
    let best = Number.POSITIVE_INFINITY;
    for (let y = Math.max(0, point.y - 2); y <= Math.min(area.height - 1, point.y + 2); y += 1) {
      for (let x = Math.max(0, point.x - 2); x <= Math.min(area.width - 1, point.x + 2); x += 1) {
        const matches = feature === "water"
          ? area.layers.ground[y]?.[x] === Tile.Water
          : area.layers.ground[y]?.[x] === Tile.Path;
        if (matches) best = Math.min(best, Math.abs(point.x - x) + Math.abs(point.y - y));
      }
    }
    return best;
  };
  return [...candidates.all].sort((a, b) => distance(a) - distance(b));
}

// Generated rooms can end up cut off from the entry; carve short corridors so every room is reachable.
function connectIsolatedRooms(area: Area): void {
  for (let guard = 0; guard < 12; guard += 1) {
    const reachable = reachableTiles(area, area.entry);
    const parents = new Map<string, string>();
    const queue: GridPoint[] = [...reachable].map((key) => {
      const [x, y] = key.split(",").map(Number);
      return { x: x!, y: y! };
    });
    const seen = new Set(reachable);
    let target: GridPoint | undefined;
    for (let index = 0; index < queue.length && !target; index += 1) {
      const point = queue[index]!;
      for (const [dx, dy] of DIRECTIONS) {
        const x = point.x + dx;
        const y = point.y + dy;
        const key = `${x},${y}`;
        if (x < 1 || y < 1 || x >= area.width - 1 || y >= area.height - 1 || seen.has(key)) continue;
        seen.add(key);
        parents.set(key, `${point.x},${point.y}`);
        if (isWalkable(area, x, y)) {
          target = { x, y };
          break;
        }
        queue.push({ x, y });
      }
    }
    if (!target) return;
    let key = parents.get(`${target.x},${target.y}`);
    while (key && !reachable.has(key)) {
      const [x, y] = key.split(",").map(Number);
      area.layers.ground[y!]![x!] = Tile.Floor;
      area.layers.feature[y!]![x!] = Tile.Grass;
      key = parents.get(key);
    }
  }
}
// Brief-to-map: generate the layout from the brief's biome, then place the story entities on reachable tiles.
// `doorPoints` puts each of the brief's doors on a chosen tile, in the order of `brief.doors`.
export function buildStoryArea(brief: StoryAreaBrief, storySeed: string, doorPoints?: readonly GridPoint[]): Area {
  const seed = hashSeed(`${storySeed}:${brief.locationId}`);
  const generatorBrief: AreaBrief = {
    name: brief.name,
    biome: brief.biome,
    mood: brief.mood,
    palette: brief.palette,
    doorLabels: brief.doors.map((door) => door.label),
    ...(doorPoints ? { doorPoints } : {}),
  };
  const generated = generateArea(seed, generatorBrief);
  if (brief.biome === "building" || brief.biome === "ruins") connectIsolatedRooms(generated);
  const doors: AreaDoor[] = generated.doors.map((door, index) => ({ ...door, targetAreaId: brief.doors[index]?.to }));

  const random = createSeededRandom(`${String(seed)}:placement`);
  const candidates = candidateTiles(generated, random);
  const available = new Set(candidates.all.map(({ x, y }) => `${x},${y}`));
  const taken: GridPoint[] = [];
  const entities: AreaEntity[] = [];
  const placedObjects: { request: PendingEntity; point: GridPoint }[] = [];
  const requests = entityRequests(brief);
  const objectRequests = requests.filter((request) => request.object)
    .sort((a, b) => Number(b.required) - Number(a.required));
  const characterRequests = requests.filter((request) => request.character)
    .sort((a, b) => Number(b.required) - Number(a.required));
  const clueRequests = requests.filter((request) => request.clue);
  const fallbackPools = [candidates.open, candidates.other];
  const indoor = brief.biome === "building" || brief.biome === "ruins";

  const reserved = new Set<string>();
  const anchorLike = (object: BriefObject): boolean => requests.some((other) => {
    if (other.character) {
      const characterWords = words([other.character.name, other.character.species, other.character.personality,
        other.character.goal, other.character.secret].join(" "));
      return overlapCount(characterWords, objectKeywords(object, true)) > 0;
    }
    if (other.clue) {
      return overlapCount(words(`${other.clue.id} ${other.clue.where} ${other.clue.text}`), objectKeywords(object, false)) > 0;
    }
    return false;
  });

  for (const request of objectRequests) {
    const free = new Set([...available].filter((key) => !reserved.has(key)));
    const placement = request.object ? classifyObject(request.object) : "free-standing";
    const preferred = placement === "wall-mounted" && indoor
      ? [candidates.wallMountedRoom, candidates.wallMounted]
      : placement === "against-wall" && indoor
        ? [candidates.againstWallRoom, candidates.againstWall]
        : placement === "outdoor" && !indoor && request.object
          ? [outdoorCandidates(generated, request.object, candidates), candidates.open]
          : [candidates.open];
    let chosen = chooseCandidate(preferred, free, taken);
    if (!chosen) chosen = chooseCandidate(preferred, available, taken);
    if (!chosen && (placement === "wall-mounted" || placement === "against-wall") && indoor) {
      chosen = chooseCandidate(preferred, new Set(candidates.all.map(({ x, y }) => `${x},${y}`)), taken, false);
    }
    if (!chosen) chosen = chooseCandidate(fallbackPools, available, taken);
    if (!chosen) {
      if (request.required) throw new Error(`No reachable tile for "${request.id}" in "${brief.locationId}".`);
      continue;
    }
    available.delete(`${chosen.x},${chosen.y}`);
    taken.push(chosen);
    entities.push(request.make(chosen));
    placedObjects.push({ request, point: chosen });
    if (request.object && anchorLike(request.object)) {
      for (const n of neighboringPoints(chosen)) reserved.add(`${n.x},${n.y}`);
    }
  }

  for (const request of characterRequests) {
    const matchingObject = bestObjectMatch(request, placedObjects);
    const preferred = matchingObject
      ? [neighboringPoints(matchingObject), candidates.room, candidates.open]
      : [candidates.room, candidates.open];
    let chosen = chooseCandidate(preferred, available, taken, !matchingObject);
    if (!chosen) chosen = chooseCandidate(fallbackPools, available, taken);
    if (!chosen) {
      if (request.required) throw new Error(`No reachable tile for "${request.id}" in "${brief.locationId}".`);
      continue;
    }
    available.delete(`${chosen.x},${chosen.y}`);
    taken.push(chosen);
    entities.push(request.make(chosen));
  }

  for (const request of clueRequests) {
    const matchingObject = bestObjectMatch(request, placedObjects);
    const preferred = matchingObject
      ? [neighboringPoints(matchingObject), candidates.open]
      : [candidates.open];
    let chosen = chooseCandidate(preferred, available, taken, !matchingObject);
    if (!chosen) chosen = chooseCandidate(fallbackPools, available, taken);
    if (!chosen) {
      if (request.required) throw new Error(`No reachable tile for "${request.id}" in "${brief.locationId}".`);
      continue;
    }
    available.delete(`${chosen.x},${chosen.y}`);
    taken.push(chosen);
    entities.push(request.make(chosen));
  }

  const spawnPoints: EntitySpawnPoint[] = entities.map(({ id, kind, x, y }) => ({ id, kind, x, y }));
  const area: Area = { ...generated, id: brief.locationId, doors, spawnPoints, entities };
  if (!allPointsReachable(area)) throw new Error(`Area "${brief.locationId}" has unreachable points.`);
  return area;
}

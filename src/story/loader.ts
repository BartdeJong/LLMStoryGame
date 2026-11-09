import { formatIssue, validateStoryPack } from "./validate";
import { LENGTH_IDS, type Beat, type CastMember, type Ending, type LengthDefinition, type LengthId, type Location, type StoryIndex, type StoryIndexEntry, type StoryPack, type Truth } from "./types";
import { resolveVisualSpec } from "../art/glyphs";
import type { VisualSpec } from "../art/glyphs";

export class StoryLoadError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(details.length > 0 ? `${message}\n${details.join("\n")}` : message);
    this.name = "StoryLoadError";
  }
}

type Fetcher = (url: string) => Promise<Response>;

function inferredVisual<T extends object>(entry: T, visual: VisualSpec): T & { visual: VisualSpec; visualInferred: true } {
  const resolved = Object.assign({}, entry, { visual, visualInferred: true as const });
  Object.defineProperty(resolved, "visualInferred", { value: true, enumerable: false });
  return resolved;
}

// Relative URLs keep this working under a GitHub Pages sub-path.
export function storiesUrl(file: string): string {
  return `${import.meta.env.BASE_URL}stories/${file}`;
}

async function fetchJson(fetcher: Fetcher, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch {
    throw new StoryLoadError(`Could not reach ${url}. Check your connection.`);
  }
  if (!response.ok) throw new StoryLoadError(`Could not load ${url} (HTTP ${response.status}).`);
  try {
    return await response.json();
  } catch {
    throw new StoryLoadError(`${url} is not valid JSON.`);
  }
}

export function parseStoryIndex(data: unknown): StoryIndex {
  const entries = (data as { stories?: unknown } | null)?.stories;
  if (!Array.isArray(entries)) throw new StoryLoadError('index.json must be an object with a "stories" array.');
  const stories = entries.map((raw, i): StoryIndexEntry => {
    const e = raw as Partial<StoryIndexEntry> | null;
    const lengths = Array.isArray(e?.lengths) ? e.lengths.filter((l): l is LengthId => LENGTH_IDS.includes(l as LengthId)) : [];
    if (!e || typeof e.id !== "string" || typeof e.title !== "string" || typeof e.logline !== "string" || lengths.length === 0) {
      throw new StoryLoadError(`index.json stories[${i}] needs id, title, logline and at least one valid length.`);
    }
    return { id: e.id, title: e.title, logline: e.logline, lengths, estimated_minutes: e.estimated_minutes ?? {} };
  });
  return { stories };
}

export async function loadStoryIndex(fetcher: Fetcher = fetch): Promise<StoryIndex> {
  return parseStoryIndex(await fetchJson(fetcher, storiesUrl("index.json")));
}

// Fetches a pack and validates it. Invalid packs are rejected with the validator's messages.
export async function loadStoryPack(id: string, fetcher: Fetcher = fetch): Promise<StoryPack> {
  const data = await fetchJson(fetcher, storiesUrl(`${encodeURIComponent(id)}.json`));
  const report = validateStoryPack(data);
  if (!report.ok || !report.pack) {
    throw new StoryLoadError(`Story "${id}" failed validation (${report.errors.length} error(s)).`, report.errors.map(formatIssue));
  }
  if (report.pack.identity.id !== id) {
    throw new StoryLoadError(`Story file "${id}.json" has identity.id "${report.pack.identity.id}". They must match.`);
  }
  return {
    ...report.pack,
    items: report.pack.items.map((item) => item.visual
      ? item
      : inferredVisual(item, resolveVisualSpec(item.name, item.description))),
    locations: report.pack.locations.map((location) => ({
      ...location,
      objects: location.objects.map((object) => object.visual
        ? object
        : inferredVisual(object, resolveVisualSpec(object.name, object.description))),
    })),
  };
}

export interface LengthView {
  storyId: string;
  storyVersion: number;
  length: LengthId;
  targetMinutes: number;
  startLocation: string;
  locations: Location[]; // in play order
  beats: Beat[];
  cast: CastMember[];
  coreTruths: Truth[];
  sideTruths: Truth[];
  endings: Ending[];
  definition: LengthDefinition;
}

export function getLengthView(pack: StoryPack, length: LengthId): LengthView {
  const definition = pack.lengths[length];
  if (!definition) throw new StoryLoadError(`Story "${pack.identity.id}" has no "${length}" length.`);
  const pick = <T extends { id: string }>(all: T[], wanted: string[]): T[] =>
    wanted.map((id) => all.find((x) => x.id === id)).filter((x): x is T => x !== undefined);
  const locationIds = [...new Set(definition.beats.flatMap((b) => b.locations))];
  return {
    storyId: pack.identity.id,
    storyVersion: pack.identity.version,
    length,
    targetMinutes: definition.target_minutes,
    startLocation: definition.start_location,
    locations: pick(pack.locations, locationIds),
    beats: definition.beats,
    cast: pick(pack.cast, definition.cast),
    coreTruths: pick(pack.truths, definition.core_truths),
    sideTruths: pick(pack.truths, definition.side_truths),
    endings: pick(pack.endings, definition.endings),
    definition,
  };
}

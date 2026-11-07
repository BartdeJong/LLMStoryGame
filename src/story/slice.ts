import type { LengthView } from "./loader";
import type { CastMember, Location, StoryPack } from "./types";

export const STYLE_EXCERPT_MAX_CHARS = 500;

export interface SliceCharacter {
  id: string;
  name: string;
  species: string;
  personality: string;
  goal: string;
  secret: string;
  current_goal_state: string;
}

export interface SliceObject {
  id: string;
  name: string;
  description: string;
  kind: "object" | "key_item";
}

export interface SliceClue {
  id: string;
  truth_id: string | null;
  text: string;
}

export interface SliceDoor {
  to: string;
  to_name: string;
}

// Everything the model is allowed to see about one location. Nothing else from the pack goes into a prompt.
export interface LocationSlice {
  location_id: string;
  name: string;
  biome: string;
  mood: string;
  palette: string;
  role: string;
  characters: SliceCharacter[];
  objects: SliceObject[];
  clues: SliceClue[];
  doors: SliceDoor[];
  style: string;
}

// Doors work in both directions, so a location also gets doors from locations that list it.
export function locationDoorTargets(pack: StoryPack, view: LengthView, locationId: string): string[] {
  const inLength = new Set(view.locations.map((location) => location.id));
  const location = pack.locations.find((candidate) => candidate.id === locationId);
  const outgoing = location?.doors.map((door) => door.to) ?? [];
  const incoming = pack.locations.filter((other) => other.doors.some((door) => door.to === locationId)).map((other) => other.id);
  return [...new Set([...outgoing, ...incoming])].filter((id) => inLength.has(id) && id !== locationId);
}

function currentGoalState(character: CastMember, resolved: readonly string[]): string {
  const next = character.goal_states.find((state) => !resolved.includes(state.id));
  return next?.description ?? "resolved";
}

function clipText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function styleExcerpt(pack: StoryPack, castIds: readonly string[]): string {
  const guide = pack.style_guide;
  const parts = [
    `Voice: ${guide.narrator_voice}`,
    `Use: ${guide.use.slice(0, 5).join(", ")}`,
    `Avoid: ${guide.avoid.slice(0, 5).join(", ")}`,
  ];
  for (const example of guide.examples) {
    const line = example.lines[0];
    if (castIds.includes(example.cast_id) && line) parts.push(`Example: ${line}`);
  }
  return clipText(parts.join("\n"), STYLE_EXCERPT_MAX_CHARS);
}

export function buildLocationSlice(
  pack: StoryPack,
  view: LengthView,
  locationId: string,
  resolvedGoalStates: readonly string[] = [],
): LocationSlice {
  const location: Location | undefined = pack.locations.find((candidate) => candidate.id === locationId);
  if (!location) throw new Error(`Story "${pack.identity.id}" has no location "${locationId}".`);
  const allowedCast = new Set(view.definition.cast);
  const characters = location.required_characters
    .filter((id) => allowedCast.has(id))
    .map((id) => pack.cast.find((member) => member.id === id))
    .filter((member): member is CastMember => member !== undefined)
    .map((member): SliceCharacter => ({
      id: member.id,
      name: member.name,
      species: member.species,
      personality: member.personality,
      goal: member.goal,
      secret: member.secret,
      current_goal_state: currentGoalState(member, resolvedGoalStates),
    }));

  const objects: SliceObject[] = [
    ...location.objects.map((object): SliceObject => ({ id: object.id, name: object.name, description: object.description, kind: "object" })),
    ...pack.items
      .filter((item) => item.found_at?.type === "location" && item.found_at.id === locationId)
      .map((item): SliceObject => ({ id: item.id, name: item.name, description: item.description, kind: "key_item" })),
  ];

  const clues: SliceClue[] = pack.clues
    .filter((clue) =>
      (clue.where.type === "location" && clue.where.id === locationId)
      || clue.alternatives.some((alternative) => alternative.type === "location" && alternative.id === locationId))
    .map((clue): SliceClue => ({ id: clue.id, truth_id: clue.truth_id ?? null, text: clue.text }));

  const doors = locationDoorTargets(pack, view, locationId).map((to): SliceDoor => ({
    to,
    to_name: pack.locations.find((candidate) => candidate.id === to)?.name ?? to,
  }));

  return {
    location_id: location.id,
    name: location.name,
    biome: location.biome,
    mood: location.mood,
    palette: location.palette,
    role: location.role,
    characters,
    objects,
    clues,
    doors,
    style: styleExcerpt(pack, characters.map((character) => character.id)),
  };
}

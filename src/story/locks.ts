import type { LengthView } from "./loader";
import type { StoryState } from "./state";
import type { CastMember, Requirement, StoryPack } from "./types";

// Explained locks: every locked door, gated clue and gated beat can say why it is shut, who or what opens it and
// what opened it. Authored texts (reason, lead, unlock_text ...) win; everything here is the derived fallback, built
// from the pack's own structure so packs without authored text still explain themselves. Pure, no session state.

export interface MissingDescription {
  line: string; // a full sentence for the message line
  brief: string; // a few words for the map
  vague: boolean; // true when no source could be traced, so the line is generic
  sources: string[]; // names of the characters or places that can help
}

const GENERIC_LINE = "Locked. Something here still needs working out first.";

// Lock keys name one thing that can be shut: a door (sorted pair of locations), a beat's places or a clue.
export function doorLockKey(locationA: string, locationB: string): string {
  return `door:${[locationA, locationB].sort().join("|")}`;
}
export function beatLockKey(beatId: string): string {
  return `beat:${beatId}`;
}
export function clueLockKey(clueId: string): string {
  return `clue:${clueId}`;
}

export type LockKind = "door" | "beat" | "clue";
export function lockKeyKind(key: string): LockKind {
  return key.startsWith("beat:") ? "beat" : key.startsWith("clue:") ? "clue" : "door";
}
// What follows the kind: a beat id, a clue id, or the two location ids of a door joined by "|".
export function lockKeyBody(key: string): string {
  return key.slice(key.indexOf(":") + 1);
}

export function ownerOfGoalState(pack: StoryPack, goalStateId: string): CastMember | undefined {
  return pack.cast.find((member) => member.goal_states.some((goal) => goal.id === goalStateId));
}

function giverOfItem(pack: StoryPack, itemId: string): { owner: CastMember; goalStateId: string } | undefined {
  for (const member of pack.cast) {
    const goal = member.goal_states.find((candidate) => candidate.gives_items?.includes(itemId));
    if (goal) return { owner: member, goalStateId: goal.id };
  }
  return undefined;
}

function locationName(pack: StoryPack, id: string): string {
  return pack.locations.find((location) => location.id === id)?.name ?? id;
}

// Traces the first missing entry of a requirement (goal states, then items, then truths) back to a source.
export function describeMissing(pack: StoryPack, state: StoryState, req: Requirement | undefined): MissingDescription {
  const generic: MissingDescription = { line: GENERIC_LINE, brief: "Needs working out", vague: true, sources: [] };
  if (!req) return generic;

  const goalId = (req.goal_states ?? []).find((id) => !state.resolvedGoalStates.includes(id));
  if (goalId) {
    const owner = ownerOfGoalState(pack, goalId);
    if (owner) {
      return { line: `${owner.name} seems to be the one who can open this.`, brief: `Ask ${owner.name}`, vague: false, sources: [owner.name] };
    }
    return generic;
  }

  const itemId = (req.items ?? []).find((id) => !state.itemsHeld.includes(id));
  if (itemId) {
    const item = pack.items.find((candidate) => candidate.id === itemId);
    const name = item?.name ?? itemId;
    const brief = `Needs ${name}`;
    const giver = giverOfItem(pack, itemId);
    if (giver) {
      return { line: `${giver.owner.name} seems to be the one who holds the ${name}.`, brief, vague: false, sources: [giver.owner.name] };
    }
    if (item?.found_at?.type === "character") {
      const holder = pack.cast.find((member) => member.id === item.found_at?.id);
      if (holder) return { line: `${holder.name} seems to have the ${name}.`, brief, vague: false, sources: [holder.name] };
    }
    if (item?.found_at?.type === "location") {
      const place = locationName(pack, item.found_at.id);
      return { line: `You will need the ${name}. It may be somewhere around ${place}.`, brief, vague: false, sources: [place] };
    }
    return { line: `You will need the ${name}.`, brief, vague: true, sources: [] };
  }

  const truthId = (req.truths ?? []).find((id) => !state.truthsFound.includes(id));
  if (truthId) {
    const truth = pack.truths.find((candidate) => candidate.id === truthId);
    if (truth?.deduction && state.truthsReady.includes(truthId)) {
      return {
        line: `Answer the question in your journal first: ${truth.deduction.question}`,
        brief: "Check your journal",
        vague: false,
        sources: [],
      };
    }
    for (const clueId of truth?.revealed_by ?? []) {
      const clue = pack.clues.find((candidate) => candidate.id === clueId);
      if (!clue) continue;
      if (clue.where.type === "character") {
        const member = pack.cast.find((candidate) => candidate.id === clue.where.id);
        if (member) {
          return { line: `${member.name} may know something that explains this.`, brief: `Ask ${member.name}`, vague: false, sources: [member.name] };
        }
      } else {
        const place = locationName(pack, clue.where.id);
        return { line: `Something in ${place} may explain this.`, brief: `Look in ${place}`, vague: false, sources: [place] };
      }
    }
  }
  return generic;
}

// What to announce when a lock opens and nothing authored says so. `label` names the place that opened.
export function derivedUnlockLine(pack: StoryPack, req: Requirement | undefined, label: string): string {
  const goalId = (req?.goal_states ?? [])[0];
  if (goalId) {
    const owner = ownerOfGoalState(pack, goalId);
    if (owner) return `Thanks to ${owner.name}, the way to ${label} is open now.`;
  }
  const itemId = (req?.items ?? [])[0];
  if (itemId) {
    const name = pack.items.find((candidate) => candidate.id === itemId)?.name ?? itemId;
    return `With the ${name}, the way to ${label} opens.`;
  }
  return `What you worked out opens the way to ${label}.`;
}

// Lines for a character who holds the key to a lock the player has run into. The prompt adds one shared instruction
// (LOCK_NOTES_INSTRUCTION): the model may mention it naturally but must not hand it over. At most two notes, so the
// prompt stays small. `isOpen` says whether a location is open yet; locks behind a closed beat are left out so no
// later goal leaks into the conversation.
export function lockNotesFor(
  pack: StoryPack,
  view: LengthView,
  state: StoryState,
  characterId: string,
  isOpen: (locationId: string) => boolean = () => true,
): string[] {
  const character = pack.cast.find((member) => member.id === characterId);
  if (!character) return [];
  const mine = new Set(character.goal_states.map((goal) => goal.id));

  // What the player must do to satisfy the part of this requirement that involves this character.
  const heldWhat = (req: Requirement | undefined): string | undefined => {
    for (const id of req?.goal_states ?? []) {
      if (state.resolvedGoalStates.includes(id) || !mine.has(id)) continue;
      return character.goal_states.find((goal) => goal.id === id)?.description;
    }
    for (const id of req?.items ?? []) {
      if (state.itemsHeld.includes(id)) continue;
      const goal = character.goal_states.find((candidate) => candidate.gives_items?.includes(id));
      if (goal) return goal.description;
      const item = pack.items.find((candidate) => candidate.id === id);
      if (item?.found_at?.type === "character" && item.found_at.id === characterId) return `you have the ${item.name}`;
    }
    return undefined;
  };

  const notes: string[] = [];
  const note = (text: string): void => {
    if (!notes.includes(text)) notes.push(text);
  };
  const inView = (id: string): boolean => view.locations.some((location) => location.id === id);
  const visited = (id: string): boolean => state.visitedAreas.includes(id);
  // Doors work both ways, so a lock written on either side counts. The way "into" a place is the side the player
  // has not been to; when both are visited it is the door's own target.
  for (const from of view.locations) {
    for (const door of from.doors) {
      if (!door.lock || !inView(door.to) || !(visited(from.id) || visited(door.to))) continue;
      const target = visited(door.to) && !visited(from.id) ? from.id : door.to;
      if (!isOpen(target)) continue;
      const what = heldWhat(door.lock);
      if (what) note(`The way into ${locationName(pack, target)} stays shut until: ${what}.`);
    }
  }
  for (const clue of pack.clues) {
    if (!clue.object_id || state.cluesFound.includes(clue.id)) continue;
    const place = view.locations.find((location) => visited(location.id) && isOpen(location.id)
      && location.objects.some((object) => object.id === clue.object_id));
    if (!place) continue;
    const what = heldWhat(clue.requirements);
    const object = place.objects.find((candidate) => candidate.id === clue.object_id);
    if (what && object) note(`The ${object.name} in ${place.name} cannot be properly looked at until: ${what}.`);
  }
  return notes.slice(0, 2);
}

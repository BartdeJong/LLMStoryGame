import type { CastMember, LengthDefinition, Location, Requirement, SourceRef, Statement, StoryPack } from "./types";

export interface SolveState {
  locations: Set<string>; // visited locations
  items: Set<string>;
  goalStates: Set<string>;
  truths: Set<string>;
  clues: Set<string>;
  cast: Set<string>; // characters met
}

export interface SolveResult extends SolveState {
  statements: Map<string, string>; // broken statement id -> evidence used ("item:<id>" or "clue:<id>")
  steps: string[]; // readable playthrough log, in discovery order
  endings: string[]; // reachable endings
  lengthLocations: string[]; // ordered locations of this length
  beatOfLocation: Map<string, number>;
}

export function orderedLocations(length: LengthDefinition): string[] {
  const seen = new Set<string>();
  for (const beat of length.beats) for (const id of beat.locations) seen.add(id);
  return [...seen];
}

export function requirementEntries(req: Requirement | undefined): string[] {
  if (!req) return [];
  return [
    ...(req.items ?? []).map((id) => `item:${id}`),
    ...(req.goal_states ?? []).map((id) => `goal:${id}`),
    ...(req.truths ?? []).map((id) => `truth:${id}`),
  ];
}

export function isSatisfied(req: Requirement | undefined, s: SolveState): boolean {
  if (!req) return true;
  return (
    (req.items ?? []).every((id) => s.items.has(id)) &&
    (req.goal_states ?? []).every((id) => s.goalStates.has(id)) &&
    (req.truths ?? []).every((id) => s.truths.has(id))
  );
}

export function missingOf(req: Requirement | undefined, s: SolveState): string[] {
  return requirementEntries(req).filter((entry) => {
    const [kind, id] = entry.split(":");
    if (kind === "item") return !s.items.has(id);
    if (kind === "goal") return !s.goalStates.has(id);
    return !s.truths.has(id);
  });
}

// The evidence of a statement the solver already holds, as "item:<id>" / "clue:<id>".
export function heldEvidence(statement: Statement, s: SolveState): string[] {
  return [
    ...(statement.broken_by.items ?? []).filter((id) => s.items.has(id)).map((id) => `item:${id}`),
    ...(statement.broken_by.clues ?? []).filter((id) => s.clues.has(id)).map((id) => `clue:${id}`),
  ];
}

// Simulates a player who does everything possible. Requirements are never consumed,
// so repeating until nothing changes finds everything reachable.
export function solveLength(pack: StoryPack, length: LengthDefinition): SolveResult {
  const lengthLocations = orderedLocations(length);
  const inLength = new Set(lengthLocations);
  const beatOfLocation = new Map<string, number>();
  length.beats.forEach((beat, i) => beat.locations.forEach((id) => { if (!beatOfLocation.has(id)) beatOfLocation.set(id, i); }));

  const locationById = new Map<string, Location>(pack.locations.map((l) => [l.id, l]));
  const castById = new Map<string, CastMember>(pack.cast.map((c) => [c.id, c]));
  const lengthCast = new Set(length.cast);

  const edges: { from: string; to: string; lock?: Requirement }[] = [];
  for (const id of lengthLocations) {
    for (const door of locationById.get(id)?.doors ?? []) {
      if (!inLength.has(door.to)) continue;
      edges.push({ from: id, to: door.to, lock: door.lock }, { from: door.to, to: id, lock: door.lock });
    }
  }

  const s: SolveResult = {
    locations: new Set(),
    items: new Set(),
    goalStates: new Set(),
    truths: new Set(),
    clues: new Set(),
    cast: new Set(),
    statements: new Map(),
    steps: [],
    endings: [],
    lengthLocations,
    beatOfLocation,
  };

  const log = (text: string): void => { s.steps.push(text); };
  const accessible = (ref: SourceRef): boolean => {
    if (ref.type === "location") return s.locations.has(ref.id);
    const home = castById.get(ref.id)?.home_location;
    return lengthCast.has(ref.id) && home !== undefined && s.locations.has(home);
  };
  const gain = (set: Set<string>, id: string, text: string): boolean => {
    if (set.has(id)) return false;
    set.add(id);
    log(text);
    return true;
  };

  if (inLength.has(length.start_location)) gain(s.locations, length.start_location, `Start at ${length.start_location}`);

  let changed = true;
  while (changed) {
    changed = false;

    // A beat opens once everything the previous beats require has been found.
    let openBeats = 1;
    while (openBeats < length.beats.length && isSatisfied(length.beats[openBeats - 1].must_find, s)) openBeats++;

    for (const edge of edges) {
      if (!s.locations.has(edge.from) || s.locations.has(edge.to)) continue;
      if ((beatOfLocation.get(edge.to) ?? Infinity) >= openBeats) continue;
      if (!isSatisfied(edge.lock, s)) continue;
      changed = gain(s.locations, edge.to, `Enter ${edge.to} from ${edge.from}`) || changed;
    }

    for (const id of length.cast) {
      const home = castById.get(id)?.home_location;
      if (home && s.locations.has(home)) changed = gain(s.cast, id, `Meet ${id} at ${home}`) || changed;
    }

    for (const item of pack.items) {
      if (item.found_at && accessible(item.found_at) && isSatisfied(item.found_requires, s)) {
        changed = gain(s.items, item.id, `Find item ${item.id} at ${item.found_at.id}`) || changed;
      }
    }

    for (const member of pack.cast) {
      if (!accessible({ type: "character", id: member.id })) continue;
      for (const state of member.goal_states) {
        if (!isSatisfied(state.requires, s)) continue;
        changed = gain(s.goalStates, state.id, `Resolve goal ${state.id} with ${member.id}`) || changed;
        for (const itemId of state.gives_items ?? []) {
          changed = gain(s.items, itemId, `Receive item ${itemId} from ${member.id}`) || changed;
        }
      }
    }

    // A statement breaks once its character can be reached, it can be heard and one piece of evidence is held.
    for (const member of pack.cast) {
      if (!accessible({ type: "character", id: member.id })) continue;
      for (const statement of member.statements ?? []) {
        if (s.statements.has(statement.id) || !isSatisfied(statement.requires, s)) continue;
        const [evidence] = heldEvidence(statement, s);
        if (!evidence) continue;
        s.statements.set(statement.id, evidence);
        log(`Break statement ${statement.id} (${member.id}) with ${evidence}`);
        changed = true;
      }
    }

    // A clue a character only gives by admitting the truth needs that statement broken.
    const gateOpen = (ref: SourceRef, clueId: string): boolean => {
      if (ref.type !== "character") return true;
      const gates = (castById.get(ref.id)?.statements ?? []).filter((statement) => statement.clue_id === clueId);
      return gates.length === 0 || gates.some((statement) => s.statements.has(statement.id));
    };
    for (const clue of pack.clues) {
      if (s.clues.has(clue.id)) continue;
      const reachable = [clue.where, ...clue.alternatives].some((ref) => accessible(ref) && gateOpen(ref, clue.id));
      if (!reachable || !isSatisfied(clue.requirements, s)) continue;
      changed = gain(s.clues, clue.id, `Find clue ${clue.id} (${clue.where.type} ${clue.where.id})`) || changed;
    }

    for (const clue of pack.clues) {
      if (!clue.truth_id || !s.clues.has(clue.id) || s.truths.has(clue.truth_id)) continue;
      const truth = pack.truths.find((t) => t.id === clue.truth_id);
      if (!truth || !truth.depends_on.every((id) => s.truths.has(id))) continue;
      changed = gain(s.truths, truth.id, `Learn truth ${truth.id} from clue ${clue.id}`) || changed;
    }
  }

  for (const ending of pack.endings) {
    if (!length.endings.includes(ending.id)) continue;
    const { truths, goal_states } = ending.conditions;
    if (truths.every((id) => s.truths.has(id)) && goal_states.every((id) => s.goalStates.has(id))) {
      s.endings.push(ending.id);
      log(`Reach ending ${ending.id}`);
    }
  }
  return s;
}

import schemaJson from "../../tools/story-forge/schema/story-pack.schema.json";
import { COMPLEXITY, DEFAULT_TEXT_LIMIT, TEXT_LIMITS, type Range } from "./config";
import { checkSchema, joinPath } from "./jsonSchema";
import { missingOf, orderedLocations, requirementEntries, solveLength, type SolveResult } from "./solver";
import { LENGTH_IDS, type LengthDefinition, type LengthId, type Requirement, type SourceRef, type StoryPack } from "./types";

export interface Issue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  pack?: StoryPack;
}

export function formatIssue(issue: Issue): string {
  return `${issue.severity.toUpperCase()} [${issue.code}] ${issue.path}: ${issue.message}`;
}

type Report = (code: string, path: string, message: string) => void;

const MAX_LISTED_IDS = 15;

export function validateStoryPack(data: unknown): ValidationReport {
  const issues: Issue[] = [];
  const error = (code: string, path: string, message: string): void => { issues.push({ severity: "error", code, path, message }); };
  const warn = (code: string, path: string, message: string): void => { issues.push({ severity: "warning", code, path, message }); };
  const finish = (pack?: StoryPack): ValidationReport => {
    const errors = issues.filter((i) => i.severity === "error");
    return { ok: errors.length === 0, errors, warnings: issues.filter((i) => i.severity === "warning"), pack };
  };

  const schemaIssues = checkSchema(data, schemaJson as Record<string, unknown>);
  if (schemaIssues.length > 0) {
    for (const i of schemaIssues) error("SCHEMA", i.path, i.message);
    return finish();
  }
  const pack = data as StoryPack;

  // ---- ids: uniqueness and references ----
  const ids = {
    cast: new Set<string>(),
    truth: new Set<string>(),
    clue: new Set<string>(),
    item: new Set<string>(),
    location: new Set<string>(),
    twist: new Set<string>(),
    red_herring: new Set<string>(),
    ending: new Set<string>(),
    goal_state: new Set<string>(),
    door: new Set<string>(),
  };
  type Kind = keyof typeof ids;

  const register = (kind: Kind, id: string, path: string): void => {
    if (ids[kind].has(id)) error("ID_DUPLICATE", path, `duplicate ${kind} id "${id}"`);
    ids[kind].add(id);
  };
  pack.cast.forEach((c, i) => {
    register("cast", c.id, `cast[${i}].id`);
    c.goal_states.forEach((g, j) => register("goal_state", g.id, `cast[${i}].goal_states[${j}].id`));
  });
  pack.truths.forEach((t, i) => register("truth", t.id, `truths[${i}].id`));
  pack.clues.forEach((c, i) => register("clue", c.id, `clues[${i}].id`));
  pack.items.forEach((x, i) => register("item", x.id, `items[${i}].id`));
  pack.locations.forEach((l, i) => {
    register("location", l.id, `locations[${i}].id`);
    l.doors.forEach((d, j) => register("door", d.id, `locations[${i}].doors[${j}].id`));
  });
  pack.twists.forEach((t, i) => register("twist", t.id, `twists[${i}].id`));
  pack.red_herrings.forEach((r, i) => register("red_herring", r.id, `red_herrings[${i}].id`));
  pack.endings.forEach((e, i) => register("ending", e.id, `endings[${i}].id`));

  const label = (kind: Kind): string => kind.replace("_", " ");
  const ref = (kind: Kind, id: string | undefined, path: string, owner: string): void => {
    if (id === undefined || ids[kind].has(id)) return;
    const known = [...ids[kind]];
    const list = known.length <= MAX_LISTED_IDS ? ` Known ${label(kind)} ids: ${known.join(", ") || "(none)"}.` : "";
    error("REF_UNKNOWN", path, `${owner} references unknown ${label(kind)} id "${id}".${list}`);
  };
  const refs = (kind: Kind, list: string[] | undefined, path: string, owner: string): void =>
    (list ?? []).forEach((id, i) => ref(kind, id, `${path}[${i}]`, owner));
  const refSource = (source: SourceRef, path: string, owner: string): void =>
    ref(source.type === "location" ? "location" : "cast", source.id, `${path}.id`, owner);
  const refReq = (req: Requirement | undefined, path: string, owner: string): void => {
    refs("item", req?.items, `${path}.items`, owner);
    refs("goal_state", req?.goal_states, `${path}.goal_states`, owner);
    refs("truth", req?.truths, `${path}.truths`, owner);
  };

  pack.style_guide.examples.forEach((e, i) => ref("cast", e.cast_id, `style_guide.examples[${i}].cast_id`, "style guide example"));
  pack.cast.forEach((c, i) => {
    const p = `cast[${i}]`;
    const owner = `cast member "${c.id}"`;
    ref("location", c.home_location, `${p}.home_location`, owner);
    c.relationships.forEach((r, j) => ref("cast", r.cast_id, `${p}.relationships[${j}].cast_id`, owner));
    refs("truth", c.knows_truths, `${p}.knows_truths`, owner);
    c.goal_states.forEach((g, j) => {
      refReq(g.requires, `${p}.goal_states[${j}].requires`, `goal state "${g.id}"`);
      refs("item", g.gives_items, `${p}.goal_states[${j}].gives_items`, `goal state "${g.id}"`);
    });
  });
  pack.truths.forEach((t, i) => {
    const owner = `truth "${t.id}"`;
    refs("truth", t.depends_on, `truths[${i}].depends_on`, owner);
    refs("clue", t.revealed_by, `truths[${i}].revealed_by`, owner);
    t.revealed_by.forEach((clueId, j) => {
      const clue = pack.clues.find((c) => c.id === clueId);
      if (clue && clue.truth_id !== t.id) {
        error("REVEAL_MISMATCH", `truths[${i}].revealed_by[${j}]`, `${owner} lists clue "${clueId}", but that clue's truth_id is ${clue.truth_id ? `"${clue.truth_id}"` : "missing"}.`);
      }
    });
  });
  pack.clues.forEach((c, i) => {
    const p = `clues[${i}]`;
    const owner = `clue "${c.id}"`;
    ref("truth", c.truth_id, `${p}.truth_id`, owner);
    refSource(c.where, `${p}.where`, owner);
    c.alternatives.forEach((a, j) => refSource(a, `${p}.alternatives[${j}]`, owner));
    refReq(c.requirements, `${p}.requirements`, owner);
    const truth = pack.truths.find((t) => t.id === c.truth_id);
    if (truth && !truth.revealed_by.includes(c.id)) {
      error("REVEAL_MISMATCH", `${p}.truth_id`, `${owner} points at truth "${truth.id}", but that truth's revealed_by does not list "${c.id}".`);
    }
  });
  const givenItems = new Set(pack.cast.flatMap((c) => c.goal_states.flatMap((g) => g.gives_items ?? [])));
  pack.items.forEach((item, i) => {
    const owner = `item "${item.id}"`;
    if (item.found_at) refSource(item.found_at, `items[${i}].found_at`, owner);
    refReq(item.found_requires, `items[${i}].found_requires`, owner);
    if (!item.found_at && !givenItems.has(item.id)) {
      error("ITEM_NO_SOURCE", `items[${i}]`, `${owner} has no found_at and no goal state gives it, so the player can never get it.`);
    }
  });
  pack.locations.forEach((l, i) => {
    const owner = `location "${l.id}"`;
    refs("cast", l.required_characters, `locations[${i}].required_characters`, owner);
    l.doors.forEach((d, j) => {
      ref("location", d.to, `locations[${i}].doors[${j}].to`, `door "${d.id}"`);
      if (d.to === l.id) error("DOOR_SELF", `locations[${i}].doors[${j}].to`, `door "${d.id}" leads back to its own location "${l.id}".`);
      refReq(d.lock, `locations[${i}].doors[${j}].lock`, `door "${d.id}"`);
    });
  });
  pack.twists.forEach((t, i) => {
    refs("clue", t.setup_clues, `twists[${i}].setup_clues`, `twist "${t.id}"`);
    refReq(t.payoff_trigger, `twists[${i}].payoff_trigger`, `twist "${t.id}"`);
  });
  pack.red_herrings.forEach((r, i) => refs("clue", r.setup_clues, `red_herrings[${i}].setup_clues`, `red herring "${r.id}"`));
  pack.endings.forEach((e, i) => {
    refs("truth", e.conditions.truths, `endings[${i}].conditions.truths`, `ending "${e.id}"`);
    refs("goal_state", e.conditions.goal_states, `endings[${i}].conditions.goal_states`, `ending "${e.id}"`);
  });

  const definedLengths = LENGTH_IDS.filter((id) => pack.lengths[id]);
  if (definedLengths.length === 0) error("NO_LENGTHS", "lengths", "the pack defines no lengths (short, medium or long).");
  for (const lengthId of definedLengths) {
    const len = pack.lengths[lengthId] as LengthDefinition;
    const p = `lengths.${lengthId}`;
    const owner = `length "${lengthId}"`;
    ref("location", len.start_location, `${p}.start_location`, owner);
    refs("cast", len.cast, `${p}.cast`, owner);
    refs("truth", len.core_truths, `${p}.core_truths`, owner);
    refs("truth", len.side_truths, `${p}.side_truths`, owner);
    refs("twist", len.twists, `${p}.twists`, owner);
    refs("red_herring", len.red_herrings, `${p}.red_herrings`, owner);
    refs("ending", len.endings, `${p}.endings`, owner);
    len.subplots.forEach((s, i) => {
      refs("cast", s.cast, `${p}.subplots[${i}].cast`, `subplot "${s.id}"`);
      refs("truth", s.truths, `${p}.subplots[${i}].truths`, `subplot "${s.id}"`);
    });
    len.beats.forEach((b, i) => {
      refs("location", b.locations, `${p}.beats[${i}].locations`, `beat "${b.id}"`);
      refReq(b.must_find, `${p}.beats[${i}].must_find`, `beat "${b.id}"`);
    });
  }

  checkTextLimits(pack, "", "", error);

  // Later checks assume every id resolves.
  if (issues.some((i) => i.severity === "error")) return finish(pack);

  // ---- location graph ----
  const neighbours = new Map<string, Set<string>>(pack.locations.map((l) => [l.id, new Set<string>()]));
  for (const l of pack.locations) for (const d of l.doors) {
    neighbours.get(l.id)?.add(d.to);
    neighbours.get(d.to)?.add(l.id);
  }
  const seen = new Set<string>([pack.locations[0].id]);
  const queue = [pack.locations[0].id];
  while (queue.length > 0) {
    for (const next of neighbours.get(queue.shift() as string) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  pack.locations.forEach((l, i) => {
    if (!seen.has(l.id)) {
      error("LOCATION_DISCONNECTED", `locations[${i}]`, `location "${l.id}" is not connected by any chain of doors to "${pack.locations[0].id}". Add a door between it and a connected location.`);
    }
  });

  checkCycles(pack, error);

  // ---- every length ----
  const usedItems = new Set<string>();
  const markUsed = (req: Requirement | undefined): void => (req?.items ?? []).forEach((id) => usedItems.add(id));
  pack.cast.forEach((c) => c.goal_states.forEach((g) => markUsed(g.requires)));
  pack.clues.forEach((c) => markUsed(c.requirements));
  pack.items.forEach((x) => markUsed(x.found_requires));
  pack.locations.forEach((l) => l.doors.forEach((d) => markUsed(d.lock)));
  pack.twists.forEach((t) => markUsed(t.payoff_trigger));
  for (const lengthId of definedLengths) (pack.lengths[lengthId] as LengthDefinition).beats.forEach((b) => markUsed(b.must_find));

  for (const lengthId of definedLengths) {
    checkLength(pack, lengthId, pack.lengths[lengthId] as LengthDefinition, error, warn);
  }

  // ---- warnings ----
  const castInAnyLength = new Set(definedLengths.flatMap((id) => (pack.lengths[id] as LengthDefinition).cast));
  pack.cast.forEach((c, i) => {
    if (!castInAnyLength.has(c.id)) warn("UNUSED_CAST", `cast[${i}]`, `cast member "${c.id}" is not part of any length's cast.`);
  });
  pack.items.forEach((x, i) => {
    if (!usedItems.has(x.id)) warn("UNUSED_ITEM", `items[${i}]`, `item "${x.id}" is never required by a door, clue, goal state, beat or twist.`);
  });

  return finish(pack);
}

function checkTextLimits(value: unknown, path: string, key: string, error: Report): void {
  if (typeof value === "string") {
    const limit = TEXT_LIMITS[key] ?? DEFAULT_TEXT_LIMIT;
    if (value.length > limit) error("TEXT_TOO_LONG", path, `text has ${value.length} characters but "${key}" allows at most ${limit}. Shorten it.`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => checkTextLimits(v, joinPath(path, i), key, error));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) checkTextLimits(v, joinPath(path, k), k, error);
  }
}

function checkCycles(pack: StoryPack, error: Report): void {
  const deps = new Map<string, string[]>();
  const paths = new Map<string, string>();
  const add = (node: string, path: string, list: string[]): void => { deps.set(node, list); paths.set(node, path); };
  pack.items.forEach((x, i) => add(`item:${x.id}`, `items[${i}]`, requirementEntries(x.found_requires)));
  pack.clues.forEach((c, i) => add(`clue:${c.id}`, `clues[${i}]`, requirementEntries(c.requirements)));
  pack.truths.forEach((t, i) => add(`truth:${t.id}`, `truths[${i}]`, t.depends_on.map((id) => `truth:${id}`)));
  pack.cast.forEach((c, i) => c.goal_states.forEach((g, j) => add(`goal:${g.id}`, `cast[${i}].goal_states[${j}]`, requirementEntries(g.requires))));

  const done = new Set<string>();
  const reported = new Set<string>();
  const stack: string[] = [];
  const visit = (node: string): void => {
    const at = stack.indexOf(node);
    if (at >= 0) {
      const cycle = stack.slice(at);
      const key = [...cycle].sort().join("|");
      if (!reported.has(key)) {
        reported.add(key);
        error("CIRCULAR_REQUIREMENT", paths.get(node) ?? node, `circular requirement: ${[...cycle, node].join(" -> ")}. Break the loop so one of these can be obtained first.`);
      }
      return;
    }
    if (done.has(node)) return;
    stack.push(node);
    for (const next of deps.get(node) ?? []) visit(next);
    stack.pop();
    done.add(node);
  };
  for (const node of deps.keys()) visit(node);
}

function checkRange(value: number, range: Range, what: string, lengthId: string, path: string, error: Report, warn: Report): void {
  if (value < range.min) {
    error("COMPLEXITY_TOO_LOW", path, `length "${lengthId}" has ${value} ${what} but needs at least ${range.min}.`);
  } else if (range.max !== undefined && value > range.max) {
    warn("COMPLEXITY_ABOVE_TARGET", path, `length "${lengthId}" has ${value} ${what}, above the target of ${range.max}.`);
  }
}

function independentRoutes(pack: StoryPack, clueIds: string[]): string[] {
  const chosen: { id: string; keys: Set<string> }[] = [];
  for (const id of clueIds) {
    const clue = pack.clues.find((c) => c.id === id);
    if (!clue) continue;
    const keys = new Set([
      ...[clue.where, ...clue.alternatives].map((w) => `${w.type}:${w.id}`),
      ...requirementEntries(clue.requirements),
    ]);
    if (chosen.every((c) => [...keys].every((k) => !c.keys.has(k)))) chosen.push({ id, keys });
  }
  return chosen.map((c) => c.id);
}

function explainLocation(pack: StoryPack, id: string, length: LengthDefinition, solved: SolveResult): string {
  const reasons: string[] = [];
  const beat = solved.beatOfLocation.get(id) ?? 0;
  for (let j = 0; j < beat; j++) {
    const missing = missingOf(length.beats[j].must_find, solved);
    if (missing.length > 0) reasons.push(`beat "${length.beats[j].id}" never completes (its must_find needs ${missing.join(", ")}), so beat "${length.beats[beat].id}" never opens`);
  }
  const inLength = new Set(solved.lengthLocations);
  let doorCount = 0;
  for (const l of pack.locations) {
    if (!inLength.has(l.id)) continue;
    for (const d of l.doors) {
      if (!((l.id === id && inLength.has(d.to)) || (d.to === id))) continue;
      doorCount++;
      const other = l.id === id ? d.to : l.id;
      const missing = missingOf(d.lock, solved);
      if (!solved.locations.has(other)) reasons.push(`door "${d.id}" connects to "${other}", which is also unreachable`);
      else if (missing.length > 0) reasons.push(`door "${d.id}" from "${other}" is locked and needs ${missing.join(", ")}`);
    }
  }
  if (doorCount === 0) reasons.push("no door connects it to another location of this length");
  return reasons.join("; ");
}

function checkLength(pack: StoryPack, lengthId: LengthId, len: LengthDefinition, error: Report, warn: Report): void {
  const p = `lengths.${lengthId}`;
  const lengthLocations = orderedLocations(len);
  const inLength = new Set(lengthLocations);
  const lengthCast = new Set(len.cast);

  // beats
  const seenInBeat = new Map<string, string>();
  len.beats.forEach((b, i) => b.locations.forEach((id, j) => {
    const earlier = seenInBeat.get(id);
    if (earlier) error("BEAT_DUPLICATE_LOCATION", `${p}.beats[${i}].locations[${j}]`, `location "${id}" is already in beat "${earlier}". Each location belongs to exactly one beat.`);
    else seenInBeat.set(id, b.id);
  }));
  if (!len.beats[0].locations.includes(len.start_location)) {
    error("START_NOT_IN_FIRST_BEAT", `${p}.start_location`, `start location "${len.start_location}" must be in the first beat ("${len.beats[0].id}").`);
  }

  // consistency
  pack.locations.forEach((l) => {
    if (!inLength.has(l.id)) return;
    for (const c of l.required_characters) {
      if (!lengthCast.has(c)) error("CAST_MISSING_FROM_LENGTH", `${p}.cast`, `location "${l.id}" requires character "${c}", who is not in the ${lengthId} cast.`);
    }
  });
  len.cast.forEach((id, i) => {
    const member = pack.cast.find((c) => c.id === id);
    if (member && !inLength.has(member.home_location)) {
      error("CAST_HOME_OUTSIDE_LENGTH", `${p}.cast[${i}]`, `cast member "${id}" lives at "${member.home_location}", which is not a location of the ${lengthId} length, so they can never be met.`);
    }
  });
  len.core_truths.forEach((id, i) => {
    if (pack.truths.find((t) => t.id === id)?.importance !== "core") error("TRUTH_IMPORTANCE", `${p}.core_truths[${i}]`, `truth "${id}" is listed as a core truth but its importance is not "core".`);
  });
  len.side_truths.forEach((id, i) => {
    if (pack.truths.find((t) => t.id === id)?.importance !== "side") error("TRUTH_IMPORTANCE", `${p}.side_truths[${i}]`, `truth "${id}" is listed as a side truth but its importance is not "side".`);
  });

  // minimum complexity
  const c = COMPLEXITY[lengthId];
  const range = (value: number, r: Range, what: string, path: string): void => checkRange(value, r, what, lengthId, path, error, warn);
  range(lengthLocations.length, c.locations, "locations", `${p}.beats`);
  range(len.cast.length, c.cast, "cast members", `${p}.cast`);
  range(len.core_truths.length, c.coreTruths, "core truths", `${p}.core_truths`);
  range(len.red_herrings.length, c.redHerrings, "red herrings", `${p}.red_herrings`);
  range(len.twists.length, c.twists, "twists", `${p}.twists`);
  range(len.subplots.length, c.subplots, "subplots", `${p}.subplots`);
  range(len.endings.length, c.endings, "endings", `${p}.endings`);

  // playthrough
  const solved = solveLength(pack, len);
  lengthLocations.forEach((id) => {
    if (!solved.locations.has(id)) {
      error("LOCATION_UNREACHABLE", `${p}.beats`, `location "${id}" cannot be reached in the ${lengthId} length: ${explainLocation(pack, id, len, solved)}.`);
    }
  });

  const unmet = (req: Requirement | undefined, path: string, owner: string): void => {
    for (const entry of missingOf(req, solved)) {
      error("REQUIREMENT_UNMET", path, `${owner} requires ${entry}, which can never be obtained in the ${lengthId} length before it is needed.`);
    }
  };
  pack.locations.forEach((l, i) => l.doors.forEach((d, j) => {
    if (inLength.has(l.id) && inLength.has(d.to)) unmet(d.lock, `locations[${i}].doors[${j}].lock`, `door "${d.id}"`);
  }));
  len.beats.forEach((b, i) => unmet(b.must_find, `${p}.beats[${i}].must_find`, `beat "${b.id}"`));
  pack.cast.forEach((m, i) => {
    if (!lengthCast.has(m.id)) return;
    m.goal_states.forEach((g, j) => unmet(g.requires, `cast[${i}].goal_states[${j}].requires`, `goal state "${g.id}"`));
  });
  pack.clues.forEach((cl, i) => {
    if ([cl.where, ...cl.alternatives].some((w) => (w.type === "location" ? inLength.has(w.id) : lengthCast.has(w.id)))) {
      unmet(cl.requirements, `clues[${i}].requirements`, `clue "${cl.id}"`);
    }
  });
  pack.items.forEach((x, i) => {
    if (x.found_at && (x.found_at.type === "location" ? inLength.has(x.found_at.id) : lengthCast.has(x.found_at.id))) {
      unmet(x.found_requires, `items[${i}].found_requires`, `item "${x.id}"`);
    }
    if (x.key && x.found_at && !solved.items.has(x.id) && (x.found_at.type === "location" ? inLength.has(x.found_at.id) : lengthCast.has(x.found_at.id))) {
      error("KEY_ITEM_MISSABLE", `items[${i}]`, `key item "${x.id}" cannot be obtained in the ${lengthId} length. Key items must never be missable.`);
    }
  });

  [...len.core_truths, ...len.side_truths].forEach((id) => {
    if (!solved.truths.has(id)) {
      const clues = pack.clues.filter((cl) => cl.truth_id === id).map((cl) => cl.id);
      const found = clues.filter((cl) => solved.clues.has(cl));
      const detail = clues.length === 0 ? "no clue reveals it" : found.length === 0 ? `none of its clues (${clues.join(", ")}) can be found` : `its dependencies are never learned first (depends_on ${JSON.stringify(pack.truths.find((t) => t.id === id)?.depends_on)})`;
      error("TRUTH_UNREACHABLE", `${p}.core_truths`, `truth "${id}" cannot be learned in the ${lengthId} length: ${detail}.`);
    }
  });

  for (const truthId of len.core_truths) {
    const reachable = pack.clues.filter((cl) => cl.truth_id === truthId && solved.clues.has(cl.id)).map((cl) => cl.id);
    const routes = independentRoutes(pack, reachable);
    if (routes.length < c.routesPerCoreTruth) {
      error("CORE_TRUTH_ROUTES", `${p}.core_truths`, `core truth "${truthId}" has ${routes.length} independent clue route(s) in the ${lengthId} length but needs ${c.routesPerCoreTruth}. Obtainable clues: ${reachable.join(", ") || "(none)"}. Routes are independent when their clues are found in different places and share no required items, goal states or truths.`);
    }
  }

  for (const t of pack.twists.filter((t) => len.twists.includes(t.id))) {
    for (const clueId of t.setup_clues) if (!solved.clues.has(clueId)) error("SETUP_CLUE_UNREACHABLE", `twists`, `setup clue "${clueId}" of twist "${t.id}" cannot be found in the ${lengthId} length.`);
  }
  for (const r of pack.red_herrings.filter((r) => len.red_herrings.includes(r.id))) {
    for (const clueId of r.setup_clues) if (!solved.clues.has(clueId)) error("SETUP_CLUE_UNREACHABLE", `red_herrings`, `setup clue "${clueId}" of red herring "${r.id}" cannot be found in the ${lengthId} length.`);
  }

  for (const endingId of len.endings) {
    if (!solved.endings.includes(endingId)) {
      const ending = pack.endings.find((e) => e.id === endingId);
      const missing = ending ? missingOf({ truths: ending.conditions.truths, goal_states: ending.conditions.goal_states }, solved) : [];
      error("ENDING_UNREACHABLE", `${p}.endings`, `ending "${endingId}" cannot be reached in the ${lengthId} length; missing ${missing.join(", ") || "conditions"}.`);
    }
  }
  if (len.endings.length > 0 && solved.endings.length === 0) {
    error("NO_ENDING_REACHABLE", `${p}.endings`, `no ending can be reached in the ${lengthId} length.`);
  }
}

import schemaJson from "../../tools/story-forge/schema/story-pack.schema.json";
import { MIN_SPRITE_DIFFERENCES, spriteDifferences, validateSpriteSpec, type SpriteSpec } from "../art/spriteSpec";
import { COMPLEXITY, DEFAULT_TEXT_LIMIT, DIALOGUE_LIMITS, PROOF_SLOTS, TEXT_LIMITS, type Range } from "./config";
import { narrationIssue } from "../dialogue/lineCleanup";
import { checkSchema, joinPath } from "./jsonSchema";
import { describeMissing } from "./locks";
import { proofPieces, requiredCount } from "./proof";
import { heldEvidence, isSatisfied, missingOf, orderedLocations, requirementEntries, solveLength, type SolveResult } from "./solver";
import type { StoryState } from "./state";
import { LENGTH_IDS, type CastMember, type LengthDefinition, type LengthId, type Location, type Proof, type Requirement, type SourceRef, type StoryPack } from "./types";
import { placedObjects } from "./slice";
import { GLYPH_STATES, getGlyph, resolveVisual, tokenizeVisualText } from "../art/glyphs";
import { PALETTE_COLOR_SLOTS } from "../art";
import { isWalkable, reachableTiles } from "../world/connectivity";
import { MAP_MAX_HEIGHT, MAP_MAX_WIDTH, MAP_MIN_HEIGHT, MAP_MIN_WIDTH, parseAreaMap, type ParsedAreaMap } from "../world/mapLegend";
import { Tile, type Area, type GridPoint } from "../world/types";

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

  const visuals = [
    ...pack.items.map((item, index) => ({ name: item.name, description: item.description, visual: item.visual, path: `items[${index}]` })),
    ...pack.locations.flatMap((location, locationIndex) => location.objects.map((object, objectIndex) => ({
      name: object.name,
      description: object.description,
      visual: object.visual,
      path: `locations[${locationIndex}].objects[${objectIndex}]`,
    }))),
  ];
  const visualGroups = new Map<string, number>();
  for (const entry of visuals) {
    const visual = entry.visual ?? resolveVisual(entry.name, entry.description);
    if (entry.visual && !getGlyph(entry.visual.icon)) {
      error("VISUAL_ICON_UNKNOWN", `${entry.path}.visual.icon`, `visual icon "${entry.visual.icon}" is not in the glyph catalog.`);
    }
    if (entry.visual?.accent
      && !PALETTE_COLOR_SLOTS.some((slot) => slot === entry.visual?.accent)
      && !/^#[0-9A-Fa-f]{6}$/.test(entry.visual.accent)) {
      error("VISUAL_ACCENT_INVALID", `${entry.path}.visual.accent`, `accent "${entry.visual.accent}" must be a palette color slot or a #RRGGBB color.`);
    }
    for (const state of entry.visual?.states ?? []) {
      if (!GLYPH_STATES.some((knownState) => knownState === state)) {
        error("VISUAL_STATE_UNKNOWN", `${entry.path}.visual.states`, `unknown visual state "${state}".`);
      }
    }
    const key = JSON.stringify([visual.icon, visual.accent ?? "", [...(visual.states ?? [])].sort()]);
    visualGroups.set(key, (visualGroups.get(key) ?? 0) + 1);
    const icon = getGlyph(visual.icon);
    const itemTokens = tokenizeVisualText(entry.name);
    const sharesToken = icon
      ? [...tokenizeVisualText(icon.name), ...icon.tags].some((token) => itemTokens.includes(token))
      : false;
    if (!sharesToken || resolveVisual(entry.name, entry.description).confidence < 0.34) {
      warn("VISUAL_WEAK_MATCH", entry.path, `weak visual match for "${entry.name}" using "${visual.icon}".`);
    }
  }
  for (const [key, count] of visualGroups) {
    if (count > 3) {
      const [icon] = JSON.parse(key) as [string];
      warn("VISUAL_DUPLICATE", "items/locations.objects", `duplicate visuals: ${count} entries use "${icon}" with identical accent and states.`);
    }
  }

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
    statement: new Set<string>(),
  };
  type Kind = keyof typeof ids;

  const register = (kind: Kind, id: string, path: string): void => {
    if (ids[kind].has(id)) error("ID_DUPLICATE", path, `duplicate ${kind} id "${id}"`);
    ids[kind].add(id);
  };
  pack.cast.forEach((c, i) => {
    register("cast", c.id, `cast[${i}].id`);
    c.goal_states.forEach((g, j) => register("goal_state", g.id, `cast[${i}].goal_states[${j}].id`));
    (c.statements ?? []).forEach((st, j) => register("statement", st.id, `cast[${i}].statements[${j}].id`));
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
    (c.reactions ?? []).forEach((r, j) => {
      const at = `${p}.reactions[${j}]`;
      ref(r.about.type, r.about.id, `${at}.about.id`, `reaction "${r.id}"`);
      refReq(r.requires, `${at}.requires`, `reaction "${r.id}"`);
      if (r.clue_id !== undefined) ref("clue", r.clue_id, `${at}.clue_id`, `reaction "${r.id}"`);
    });
    (c.statements ?? []).forEach((st, j) => {
      const at = `${p}.statements[${j}]`;
      const who = `statement "${st.id}"`;
      refReq(st.requires, `${at}.requires`, who);
      refs("item", st.broken_by.items, `${at}.broken_by.items`, who);
      refs("clue", st.broken_by.clues, `${at}.broken_by.clues`, who);
      if (st.clue_id !== undefined) ref("clue", st.clue_id, `${at}.clue_id`, who);
    });
    c.goal_states.forEach((g, j) => {
      refReq(g.requires, `${p}.goal_states[${j}].requires`, `goal state "${g.id}"`);
      refs("item", g.gives_items, `${p}.goal_states[${j}].gives_items`, `goal state "${g.id}"`);
    });
  });
  // What backs a deduction or summation answer: known ids, no repeats, a reachable `required` count.
  const checkProof = (proof: Proof | undefined, path: string, owner: string): void => {
    if (!proof) return;
    refs("item", proof.items, `${path}.items`, owner);
    refs("clue", proof.clues, `${path}.clues`, owner);
    const pieces = proofPieces(proof);
    if (pieces.length === 0) {
      error("PROOF_EMPTY", path, `${owner} has a proof that lists no items or clues. Remove it or list what proves the answer.`);
      return;
    }
    if (new Set(pieces.map((piece) => `${piece.type}:${piece.id}`)).size !== pieces.length) {
      error("PROOF_DUPLICATE", path, `${owner} lists the same item or clue more than once in its proof.`);
    }
    if (proof.required !== undefined && (proof.required > pieces.length || proof.required > PROOF_SLOTS)) {
      error("PROOF_REQUIRED_TOO_HIGH", `${path}.required`, `${owner} requires ${proof.required} pieces of proof, but it lists ${pieces.length} and the player can show at most ${PROOF_SLOTS}.`);
    }
  };
  pack.cast.forEach((c, i) => checkDialogueContent(pack, c, `cast[${i}]`, error));
  checkSprites(pack, error);
  pack.truths.forEach((t, i) => {
    const owner = `truth "${t.id}"`;
    refs("truth", t.depends_on, `truths[${i}].depends_on`, owner);
    refs("clue", t.revealed_by, `truths[${i}].revealed_by`, owner);
    if (t.deduction) {
      refs("red_herring", t.deduction.rules_out, `truths[${i}].deduction.rules_out`, owner);
      checkProof(t.deduction.proof, `truths[${i}].deduction.proof`, `${owner} deduction`);
      if (!t.deduction.proof) {
        warn("DEDUCTION_NO_PROOF", `truths[${i}].deduction`, `${owner} has a deduction without a proof, so the player never has to show evidence for it.`);
      }
      const options = [t.deduction.answer, ...t.deduction.wrong_answers].map((text) => text.trim().toLocaleLowerCase());
      if (new Set(options).size !== options.length) {
        error("DEDUCTION_DUPLICATE_ANSWER", `truths[${i}].deduction`, `${owner} has a deduction whose answer and wrong_answers are not all different.`);
      }
      if (new Set(t.deduction.rules_out ?? []).size !== (t.deduction.rules_out ?? []).length) {
        error("DEDUCTION_DUPLICATE_RULES_OUT", `truths[${i}].deduction.rules_out`, `${owner} lists the same red herring more than once in rules_out.`);
      }
    }
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
    // A clue found at a location is anchored to an object there: examining that object finds the clue.
    const places = [...new Set([c.where, ...c.alternatives].filter((s) => s.type === "location").map((s) => s.id))];
    const objectIn = (locationId: string): boolean => pack.locations.some((l) => l.id === locationId
      && placedObjects(pack, l).some((object) => object.id === c.object_id));
    if (c.object_id !== undefined && !pack.locations.some((l) => placedObjects(pack, l).some((o) => o.id === c.object_id))) {
      error("REF_UNKNOWN", `${p}.object_id`, `${owner} is anchored to "${c.object_id}", which is not an object of any location.`);
    } else if (c.object_id !== undefined && !places.some((id) => objectIn(id))) {
      error("CLUE_ANCHOR_ELSEWHERE", `${p}.object_id`, `${owner} is anchored to object "${c.object_id}", but that object is not in a location where the clue can be found.`);
    }
    for (const locationId of places) {
      if (!pack.locations.some((l) => l.id === locationId)) continue;
      if (!objectIn(locationId)) {
        error("CLUE_ANCHOR_MISSING", `${p}`, `${owner} can be found at "${locationId}" but has no object_id naming an object of that location. Add an object to "${locationId}" and set object_id to its id.`);
      }
    }
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
    const placed = new Set(placedObjects(pack, l));
    l.objects.forEach((object, j) => {
      if (!placed.has(object)) {
        error("OBJECT_DUPLICATES_ITEM", `locations[${i}].objects[${j}]`, `object "${object.id}" in "${l.id}" is the same thing as the item "${object.id}" found there. Keep only the item and remove it from objects.`);
      }
    });
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
    const summed = new Set<string>();
    (e.summation ?? []).forEach((entry, j) => {
      const path = `endings[${i}].summation[${j}].truth_id`;
      ref("truth", entry.truth_id, path, `ending "${e.id}"`);
      if (ids.truth.has(entry.truth_id) && !e.conditions.truths.includes(entry.truth_id)) {
        error("SUMMATION_TRUTH_NOT_IN_ENDING", path, `ending "${e.id}" asks about truth "${entry.truth_id}", which is not in its conditions.truths.`);
      }
      if (summed.has(entry.truth_id)) {
        error("SUMMATION_DUPLICATE_TRUTH", path, `ending "${e.id}" asks about truth "${entry.truth_id}" more than once.`);
      }
      summed.add(entry.truth_id);
      checkProof(entry.proof, `endings[${i}].summation[${j}].proof`, `ending "${e.id}" summation question ${j + 1}`);
    });
  });

  const definedLengths = LENGTH_IDS.filter((id) => pack.lengths[id]);
  if (definedLengths.length === 0) error("NO_LENGTHS", "lengths", "the pack defines no length (short, medium or long).");
  if (definedLengths.length > 1) {
    error("MULTIPLE_LENGTHS", "lengths", `the pack defines ${definedLengths.length} lengths (${definedLengths.join(", ")}) but a story has exactly one. Keep only the longest version.`);
  }
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
    if (len.epilogue) {
      ref("location", len.epilogue.location, `${p}.epilogue.location`, `${owner} epilogue`);
      len.epilogue.cast.forEach((entry, i) => {
        ref("cast", entry.id, `${p}.epilogue.cast[${i}].id`, `${owner} epilogue`);
        refs("ending", entry.endings ?? [], `${p}.epilogue.cast[${i}].endings`, `${owner} epilogue`);
      });
    }
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
  pack.cast.forEach((c) => (c.statements ?? []).forEach((st) => (st.broken_by.items ?? []).forEach((id) => usedItems.add(id))));
  for (const lengthId of definedLengths) (pack.lengths[lengthId] as LengthDefinition).beats.forEach((b) => markUsed(b.must_find));

  for (const lengthId of definedLengths) {
    const definition = pack.lengths[lengthId] as LengthDefinition;
    if (!definition.opening) {
      warn("OPENING_MISSING", `lengths.${lengthId}.opening`, "Add authored context so a new player understands the story before exploring.");
    }
    definition.beats.forEach((beat, index) => {
      if (!beat.objective) warn("BEAT_OBJECTIVE_MISSING", `lengths.${lengthId}.beats[${index}].objective`, `Add a player-facing objective for beat "${beat.title}".`);
      if (!beat.guidance) warn("BEAT_GUIDANCE_MISSING", `lengths.${lengthId}.beats[${index}].guidance`, `Add a concrete next step for beat "${beat.title}".`);
    });
    checkLength(pack, lengthId, definition, error, warn);
    checkEpilogue(pack, lengthId, definition, error, warn);
  }

  // ---- warnings ----
  const castInAnyLength = new Set(definedLengths.flatMap((id) => (pack.lengths[id] as LengthDefinition).cast));
  pack.cast.forEach((c, i) => {
    if (!castInAnyLength.has(c.id)) warn("UNUSED_CAST", `cast[${i}]`, `cast member "${c.id}" is not part of any length's cast.`);
  });
  pack.items.forEach((x, i) => {
    if (!usedItems.has(x.id)) warn("UNUSED_ITEM", `items[${i}]`, `item "${x.id}" is never required by a door, clue, goal state, beat or twist.`);
  });
  checkAuthoredAreas(pack, error, warn);
  checkLockText(pack, definedLengths, warn);

  return finish(pack);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);
}

// Locks, gated clues and gated beats should explain themselves. Without authored text the game derives a line from
// the pack (src/story/locks.ts); these warnings point at the places where that derived line would be vague, or
// where nobody in the story ever points the player at the key.
function checkLockText(pack: StoryPack, lengths: readonly LengthId[], warn: Report): void {
  const nothingDone = { resolvedGoalStates: [], itemsHeld: [], truthsFound: [], truthsReady: [] } as unknown as StoryState;
  const isEmpty = (req: Requirement | undefined): boolean => !req || ((req.items?.length ?? 0) + (req.goal_states?.length ?? 0) + (req.truths?.length ?? 0)) === 0;

  pack.locations.forEach((location, i) => location.doors.forEach((door, j) => {
    if (!door.lock || isEmpty(door.lock) || door.lock.reason) return;
    if (describeMissing(pack, nothingDone, door.lock).vague) {
      warn("LOCK_NO_REASON", `locations[${i}].doors[${j}].lock`, `the lock on door "${door.id}" has no reason and its source cannot be traced. Add a "reason" that says why it is shut.`);
    }
  }));
  pack.clues.forEach((clue, i) => {
    if (!clue.object_id || isEmpty(clue.requirements) || clue.locked_glimpse) return;
    if (describeMissing(pack, nothingDone, clue.requirements).vague) {
      warn("LOCK_NO_REASON", `clues[${i}]`, `clue "${clue.id}" is gated, anchored to an object and its source cannot be traced. Add a "locked_glimpse" that hints why it is out of reach.`);
    }
  });
  for (const lengthId of lengths) {
    const beats = (pack.lengths[lengthId] as LengthDefinition).beats;
    beats.forEach((beat, index) => {
      const previous = beats[index - 1];
      if (previous && !isEmpty(previous.must_find) && !beat.gate_reason) {
        warn("BEAT_GATE_NO_REASON", `lengths.${lengthId}.beats[${index}]`, `beat "${beat.id}" has places that stay shut until "${previous.id}" is done but no "gate_reason" says why.`);
      }
    });
  }

  // Text the player can hear that could point at a lock's key.
  const spoken = pack.cast.flatMap((member) => [
    ...member.knowledge.flatMap((item) => [item.text, ...item.keywords]),
    ...member.goal_hints.unmet, ...member.goal_hints.in_progress, ...member.goal_hints.resolved,
  ]).concat(pack.clues.map((clue) => clue.text)).join(" ");
  const mentioned = (term: string): boolean =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "iu").test(spoken);
  pack.locations.forEach((location, i) => location.doors.forEach((door, j) => {
    const lock = door.lock;
    if (!lock || lock.lead || isEmpty(lock) || (!lock.items?.length && !lock.goal_states?.length)) return;
    const terms: string[] = [];
    for (const id of lock.items ?? []) {
      const name = pack.items.find((item) => item.id === id)?.name;
      if (name) terms.push(name, name.split(/\s+/).pop() ?? name);
    }
    if (lock.goal_states?.length) {
      const target = pack.locations.find((candidate) => candidate.id === door.to)?.name ?? "";
      terms.push(target.replace(/^.*?['’]s\s+/, "").replace(/^the\s+/i, ""));
    }
    const wanted = terms.map((term) => term.trim()).filter((term) => term.length > 2);
    if (wanted.length > 0 && !wanted.some(mentioned)) {
      warn("LOCK_NO_LEAD", `locations[${i}].doors[${j}].lock`, `nobody mentions what opens door "${door.id}" (looked for ${wanted.map((term) => `"${term}"`).join(", ")}). Add a "lead" or let a character say it.`);
    }
  }));
}

// Every character and the player needs a valid sprite spec, and no two may look alike.
function checkSprites(pack: StoryPack, error: Report): void {
  const looks: { who: string; path: string; spec: SpriteSpec }[] = [];
  const add = (who: string, path: string, spec: unknown): void => {
    const problems = validateSpriteSpec(spec, `${path}.sprite`);
    for (const problem of problems) error("SPRITE_INVALID", `${path}.sprite`, `${who}: ${problem}`);
    if (problems.length === 0) looks.push({ who, path, spec: spec as SpriteSpec });
  };
  add(`the player "${pack.identity.player.name}"`, "identity.player", pack.identity.player.sprite);
  pack.cast.forEach((c, i) => add(`cast member "${c.id}"`, `cast[${i}]`, c.sprite));
  for (let a = 0; a < looks.length; a += 1) {
    for (let b = a + 1; b < looks.length; b += 1) {
      const first = looks[a]!;
      const second = looks[b]!;
      const differences = spriteDifferences(first.spec, second.spec);
      if (differences < MIN_SPRITE_DIFFERENCES) {
        error("SPRITE_TOO_SIMILAR", `${second.path}.sprite`, `${second.who} looks too much like ${first.who} (${differences} differences, at least ${MIN_SPRITE_DIFFERENCES} needed). Change the outfit, headwear, hair or colours.`);
      }
    }
  }
}

function checkDialogueContent(pack: StoryPack, c: CastMember, p: string, error: Report): void {
  const owner = `cast member "${c.id}"`;
  const lines: [string, string[]][] = [
    ["greetings", c.greetings],
    ["goal_hints.unmet", c.goal_hints.unmet],
    ["goal_hints.in_progress", c.goal_hints.in_progress],
    ["goal_hints.resolved", c.goal_hints.resolved],
    ["deflections", c.deflections],
  ];
  for (const [field, list] of lines) {
    list.forEach((line, j) => {
      const at = `${p}.${field}[${j}]`;
      if (line.length > DIALOGUE_LIMITS.lineChars) error("DIALOGUE_TOO_LONG", at, `${owner} line has ${line.length} characters but at most ${DIALOGUE_LIMITS.lineChars} are allowed.`);
      const issue = narrationIssue(line, c.name);
      if (issue) error("DIALOGUE_NARRATION", at, `${owner}: "${line}" ${issue}. Write spoken words in the character's own voice.`);
    });
  }

  const seen = new Set<string>();
  c.knowledge.forEach((k, j) => {
    const at = `${p}.knowledge[${j}]`;
    if (seen.has(k.id)) error("ID_DUPLICATE", `${at}.id`, `${owner} has duplicate knowledge id "${k.id}".`);
    seen.add(k.id);
    if (k.topic.trim().split(/\s+/).length > DIALOGUE_LIMITS.topicWords) {
      error("KNOWLEDGE_TOPIC", `${at}.topic`, `topic "${k.topic}" has more than ${DIALOGUE_LIMITS.topicWords} words.`);
    }
    const askIssue = narrationIssue(k.ask, c.name);
    if (askIssue) error("DIALOGUE_NARRATION", `${at}.ask`, `${owner}: ask "${k.ask}" ${askIssue}. It must be something the player says.`);
    const textIssue = narrationIssue(k.text, c.name);
    if (textIssue) error("DIALOGUE_NARRATION", `${at}.text`, `${owner}: fact "${k.text}" ${textIssue}.`);
    if (k.keywords.some((word) => !word.trim())) error("KNOWLEDGE_KEYWORDS", `${at}.keywords`, "keywords must not be blank.");
    if (k.clue_id !== undefined) {
      const clue = pack.clues.find((candidate) => candidate.id === k.clue_id);
      if (!clue) {
        error("REF_UNKNOWN", `${at}.clue_id`, `knowledge "${k.id}" references unknown clue id "${k.clue_id}".`);
      } else if (![clue.where, ...clue.alternatives].some((source) => source.type === "character" && source.id === c.id)) {
        error("KNOWLEDGE_CLUE_ELSEWHERE", `${at}.clue_id`, `knowledge "${k.id}" gives clue "${clue.id}", but that clue is not found with ${owner}.`);
      } else if (k.truth_id !== undefined && clue.truth_id !== k.truth_id) {
        error("KNOWLEDGE_TRUTH_MISMATCH", `${at}.truth_id`, `knowledge "${k.id}" has truth_id "${k.truth_id}" but clue "${clue.id}" belongs to ${clue.truth_id ? `"${clue.truth_id}"` : "no truth"}.`);
      }
    }
    if (k.truth_id !== undefined && !pack.truths.some((t) => t.id === k.truth_id)) {
      error("REF_UNKNOWN", `${at}.truth_id`, `knowledge "${k.id}" references unknown truth id "${k.truth_id}".`);
    }
  });

  const reactionIds = new Set<string>();
  (c.reactions ?? []).forEach((r, j) => {
    const at = `${p}.reactions[${j}]`;
    if (reactionIds.has(r.id)) error("ID_DUPLICATE", `${at}.id`, `${owner} has duplicate reaction id "${r.id}".`);
    reactionIds.add(r.id);
    if (r.text.length > DIALOGUE_LIMITS.lineChars) error("DIALOGUE_TOO_LONG", `${at}.text`, `${owner} reaction has ${r.text.length} characters but at most ${DIALOGUE_LIMITS.lineChars} are allowed.`);
    const issue = narrationIssue(r.text, c.name);
    if (issue) error("DIALOGUE_NARRATION", `${at}.text`, `${owner}: reaction "${r.text}" ${issue}.`);
    if (r.clue_id !== undefined) {
      const clue = pack.clues.find((candidate) => candidate.id === r.clue_id);
      if (clue && ![clue.where, ...clue.alternatives].some((source) => source.type === "character" && source.id === c.id)) {
        error("REACTION_CLUE_ELSEWHERE", `${at}.clue_id`, `reaction "${r.id}" gives clue "${clue.id}", but that clue is not found with ${owner}.`);
      }
    }
  });

  checkStatements(pack, c, p, error);

  // Code, not the model, reveals clues, so a clue told by a character needs a knowledge item or a statement.
  const covered = new Set([...c.knowledge.map((k) => k.clue_id), ...(c.statements ?? []).map((st) => st.clue_id)]);
  pack.clues.forEach((clue, j) => {
    const talksHere = [clue.where, ...clue.alternatives].some((source) => source.type === "character" && source.id === c.id);
    if (talksHere && !covered.has(clue.id)) {
      error("CLUE_NOT_TALKABLE", `clues[${j}]`, `clue "${clue.id}" is told by ${owner}, but none of their knowledge items or statements has clue_id "${clue.id}".`);
    }
  });
}

// Statements: spoken like any other line, breakable by evidence, and the only way this character gives their clue.
function checkStatements(pack: StoryPack, c: CastMember, p: string, error: Report): void {
  const owner = `cast member "${c.id}"`;
  (c.statements ?? []).forEach((st, j) => {
    const at = `${p}.statements[${j}]`;
    const who = `statement "${st.id}"`;
    if (st.topic.trim().split(/\s+/).length > DIALOGUE_LIMITS.topicWords) {
      error("KNOWLEDGE_TOPIC", `${at}.topic`, `topic "${st.topic}" has more than ${DIALOGUE_LIMITS.topicWords} words.`);
    }
    const askIssue = narrationIssue(st.ask, c.name);
    if (askIssue) error("DIALOGUE_NARRATION", `${at}.ask`, `${owner}: ask "${st.ask}" ${askIssue}. It must be something the player says.`);
    if (st.keywords.some((word) => !word.trim())) error("KNOWLEDGE_KEYWORDS", `${at}.keywords`, "keywords must not be blank.");
    for (const [field, line] of [["text", st.text], ["admission", st.admission], ["rebuff", st.rebuff]] as const) {
      if (line === undefined) continue;
      if (line.length > DIALOGUE_LIMITS.lineChars) error("DIALOGUE_TOO_LONG", `${at}.${field}`, `${who} ${field} has ${line.length} characters but at most ${DIALOGUE_LIMITS.lineChars} are allowed.`);
      const issue = narrationIssue(line, c.name);
      if (issue) error("DIALOGUE_NARRATION", `${at}.${field}`, `${owner}: ${field} "${line}" ${issue}. Write spoken words in the character's own voice.`);
    }
    const evidence = [...(st.broken_by.items ?? []), ...(st.broken_by.clues ?? [])];
    if (evidence.length === 0) error("STATEMENT_NO_EVIDENCE", `${at}.broken_by`, `${who} lists no item or clue that breaks it.`);
    if (st.clue_id === undefined) return;
    if ((st.broken_by.clues ?? []).includes(st.clue_id)) {
      error("STATEMENT_SELF_EVIDENCE", `${at}.broken_by.clues`, `${who} is broken by its own clue "${st.clue_id}".`);
    }
    const clue = pack.clues.find((candidate) => candidate.id === st.clue_id);
    if (!clue) return;
    if (![clue.where, ...clue.alternatives].some((source) => source.type === "character" && source.id === c.id)) {
      error("STATEMENT_CLUE_ELSEWHERE", `${at}.clue_id`, `${who} reveals clue "${clue.id}", but that clue is not found with ${owner}. Add the character to the clue's where or alternatives.`);
    }
    c.knowledge.forEach((k, n) => {
      if (k.clue_id === clue.id) error("STATEMENT_CLUE_GIVEN_FREELY", `${p}.knowledge[${n}].clue_id`, `knowledge "${k.id}" gives clue "${clue.id}" freely, but ${who} of the same character hides it. Remove the clue_id (and the fact) from the knowledge item.`);
    });
    (c.reactions ?? []).forEach((r, n) => {
      if (r.clue_id === clue.id) error("STATEMENT_CLUE_GIVEN_FREELY", `${p}.reactions[${n}].clue_id`, `reaction "${r.id}" gives clue "${clue.id}" freely, but ${who} of the same character hides it. Remove the clue_id from the reaction.`);
    });
    const needed = requirementEntries(clue.requirements);
    const heardWith = new Set(requirementEntries(st.requires));
    const uncovered = needed.filter((entry) => !heardWith.has(entry));
    if (uncovered.length > 0) {
      error("STATEMENT_CLUE_REQUIREMENTS", `${at}.requires`, `${who} reveals clue "${clue.id}", which requires ${uncovered.join(", ")}; the statement's requires must include them so the admission never gives a clue early.`);
    }
  });
}

const key = (x: number, y: number): string => `${x},${y}`;

interface AreaCheckContext {
  pack: StoryPack;
  error: Report;
  warn: Report;
}

// Everything about a place is baked into the pack: map, door signs, where each story thing stands, decor.
// The game only reads it, so every mistake here must be caught before play.
function checkAuthoredAreas(pack: StoryPack, error: Report, warn: Report): void {
  const context: AreaCheckContext = { pack, error, warn };
  pack.locations.forEach((l, i) => checkLocationArea(context, l, i));
  for (const lengthId of LENGTH_IDS) {
    const definition = pack.lengths[lengthId];
    const start = definition && pack.locations.find((l) => l.id === definition.start_location);
    if (!definition || !start?.area) continue;
    const parsed = tryParseMap(start.area.map);
    if (!parsed) continue;
    const inLength = new Set(orderedLocations(definition));
    const active = start.area.doors.some((d, index) => parsed.doorSlots.has(index + 1) && inLength.has(d.to));
    if (!parsed.start && !active) {
      error("AREA_START_NO_ENTRY", `locations[${pack.locations.indexOf(start)}].area.map`, `"${start.id}" starts the ${lengthId} length but has no "@" tile and no door to a place in that length.`);
    }
  }
}

function tryParseMap(rows: readonly string[]): ParsedAreaMap | undefined {
  try {
    return parseAreaMap(rows);
  } catch {
    return undefined;
  }
}

function checkLocationArea({ pack, error, warn }: AreaCheckContext, l: Location, index: number): void {
  const lower = (text: string): string => text.trim().toLowerCase();
  const path = `locations[${index}].area`;
  const a = l.area;
  if (!a) {
    error("AREA_MISSING", `locations[${index}]`, `location "${l.id}" has no "area" block. Run the Story Forge bake step to add the map, doors and placements.`);
    return;
  }

  // ---- map ----
  let parsed: ParsedAreaMap | undefined;
  if (a.map.length < MAP_MIN_HEIGHT || a.map.length > MAP_MAX_HEIGHT) {
    error("AREA_MAP_SIZE", `${path}.map`, `the map has ${a.map.length} rows; it needs ${MAP_MIN_HEIGHT} to ${MAP_MAX_HEIGHT}.`);
  } else if (a.map.some((row) => row.length < MAP_MIN_WIDTH || row.length > MAP_MAX_WIDTH)) {
    error("AREA_MAP_SIZE", `${path}.map`, `every map row must be ${MAP_MIN_WIDTH} to ${MAP_MAX_WIDTH} characters wide.`);
  } else {
    try {
      parsed = parseAreaMap(a.map);
    } catch (e) {
      error("AREA_MAP_INVALID", `${path}.map`, e instanceof Error ? e.message : String(e));
    }
  }

  // ---- doors ----
  const neighbours = new Set([
    ...l.doors.map((d) => d.to),
    ...pack.locations.filter((o) => o.doors.some((d) => d.to === l.id)).map((o) => o.id),
  ]);
  const seen = new Set<string>();
  a.doors.forEach((d, j) => {
    const at = `${path}.doors[${j}]`;
    if (!neighbours.has(d.to)) error("AREA_DOOR_NOT_NEIGHBOUR", `${at}.to`, `"${d.to}" is not connected to "${l.id}" by any door.`);
    if (seen.has(d.to)) error("AREA_DOOR_DUPLICATE", `${at}.to`, `"${d.to}" already has a sign in this area.`);
    seen.add(d.to);
    if (d.label.trim().split(/\s+/).length > 4) warn("AREA_DOOR_LABEL_LONG", `${at}.label`, "door signs should be at most 4 words.");
    const other = pack.locations.find((o) => o.id !== d.to && o.name.length > 2 && lower(d.label).includes(lower(o.name)));
    if (other) error("AREA_DOOR_MISLEADING", `${at}.label`, `the sign names "${other.name}" but leads to "${d.to}".`);
  });
  for (const id of neighbours) {
    if (!seen.has(id)) error("AREA_DOOR_MISSING", `${path}.doors`, `no door for the way to "${id}"; every neighbouring location needs one.`);
  }
  if (a.doors.length > 9) error("AREA_DOOR_COUNT", `${path}.doors`, "an area can have at most 9 doors (map digits 1 to 9).");
  if (parsed) {
    for (let n = 1; n <= a.doors.length; n += 1) {
      if (!parsed.doorSlots.has(n)) error("AREA_DOOR_DIGIT_MISSING", `${path}.map`, `door ${n} (to "${a.doors[n - 1]!.to}") does not appear in the map.`);
    }
    for (const n of parsed.doorSlots.keys()) {
      if (n > a.doors.length) error("AREA_DOOR_DIGIT_EXTRA", `${path}.map`, `the map has a door ${n}, but the area lists only ${a.doors.length} door(s).`);
    }
  }

  // ---- placements ----
  // A placement is keyed by the entity id ("obj:o_bin", "item:i_key", "char:c_mira") or, when the pack id is unique
  // among the things at this location, by the plain pack id. Clues have no placement: they belong to an object.
  const things: { entityId: string; packId: string; kind: "object" | "item" | "character" }[] = [
    ...placedObjects(pack, l).map((o) => ({ entityId: `obj:${o.id}`, packId: o.id, kind: "object" as const })),
    ...pack.items.filter((x) => x.found_at?.type === "location" && x.found_at.id === l.id)
      .map((x) => ({ entityId: `item:${x.id}`, packId: x.id, kind: "item" as const })),
    ...l.required_characters.map((id) => ({ entityId: `char:${id}`, packId: id, kind: "character" as const })),
  ];
  const thingKinds = new Map<string, "object" | "item" | "character">();
  const resolved = new Map<string, number[]>();
  const usedKeys = new Set<string>();
  for (const thing of things) {
    thingKinds.set(thing.entityId, thing.kind);
    const shared = things.filter((other) => other.packId === thing.packId).length > 1;
    const exact = a.placements[thing.entityId];
    const plain = a.placements[thing.packId];
    if (exact) {
      resolved.set(thing.entityId, exact);
      usedKeys.add(thing.entityId);
    } else if (plain && !shared) {
      resolved.set(thing.entityId, plain);
      usedKeys.add(thing.packId);
    } else if (plain && shared) {
      usedKeys.add(thing.packId);
      error("AREA_PLACEMENT_AMBIGUOUS", `${path}.placements.${thing.packId}`, `"${thing.packId}" names more than one thing at "${l.id}"; key each placement by its entity id (${things.filter((other) => other.packId === thing.packId).map((other) => `"${other.entityId}"`).join(", ")}).`);
    } else {
      error("AREA_PLACEMENT_MISSING", `${path}.placements`, `the ${thing.kind} "${thing.packId}" belongs at "${l.id}" but has no placement.`);
    }
  }
  for (const id of Object.keys(a.placements)) {
    if (!usedKeys.has(id)) error("AREA_PLACEMENT_UNKNOWN", `${path}.placements.${id}`, `"${id}" is not an object, item or character that can appear at "${l.id}".`);
  }
  if (!parsed) return;

  const base: Area = {
    id: l.id, seed: l.id, name: l.name, biome: a.biome, mood: l.mood, palette: a.palette,
    width: parsed.width, height: parsed.height, layers: parsed.layers, entry: parsed.start ?? { x: 0, y: 0 },
    spawnPoints: [], doors: [],
  };
  const isDoor = (x: number, y: number): boolean => parsed.layers.feature[y]?.[x] === Tile.Door;
  const tileOk = (x: number, y: number): boolean => isWalkable(base, x, y) && !isDoor(x, y);
  const taken = new Map<string, string>();
  const placed = new Map<string, GridPoint>();
  for (const [id, point] of resolved) {
    const at = `${path}.placements.${id}`;
    const [x, y] = point;
    if (x === undefined || y === undefined || x < 0 || y < 0 || x >= parsed.width || y >= parsed.height) {
      error("AREA_PLACEMENT_OUT_OF_BOUNDS", at, `"${id}" is placed at ${x},${y}, outside the ${parsed.width}x${parsed.height} map.`);
      continue;
    }
    if (!tileOk(x, y)) error("AREA_PLACEMENT_BLOCKED", at, `"${id}" is placed at ${x},${y}, which is not walkable floor (wall, void, counter, water, door or other solid tile).`);
    const other = taken.get(key(x, y));
    if (other) error("AREA_PLACEMENT_OVERLAP", at, `"${id}" and "${other}" are both placed at ${x},${y}.`);
    else taken.set(key(x, y), id);
    if (parsed.start && parsed.start.x === x && parsed.start.y === y) warn("AREA_PLACEMENT_ON_START", at, `"${id}" stands on the player's start tile.`);
    placed.set(id, { x, y });
  }

  // ---- decor ----
  const decorTiles = new Set<string>();
  a.decor.forEach((d, j) => {
    const at = `${path}.decor[${j}]`;
    if (!getGlyph(d.icon)) error("AREA_DECOR_ICON_UNKNOWN", `${at}.icon`, `decor icon "${d.icon}" is not in the glyph catalog.`);
    if (d.x < 0 || d.y < 0 || d.x >= parsed.width || d.y >= parsed.height) {
      error("AREA_DECOR_OUT_OF_BOUNDS", at, `decor is at ${d.x},${d.y}, outside the map.`);
      return;
    }
    if (!tileOk(d.x, d.y)) error("AREA_DECOR_BLOCKED", at, `decor at ${d.x},${d.y} is not on walkable floor.`);
    const other = taken.get(key(d.x, d.y));
    if (other) error("AREA_DECOR_ON_PLACEMENT", at, `decor at ${d.x},${d.y} covers "${other}".`);
    if (decorTiles.has(key(d.x, d.y))) error("AREA_DECOR_OVERLAP", at, `two decor items at ${d.x},${d.y}.`);
    decorTiles.add(key(d.x, d.y));
  });

  // ---- reachability, once per length that includes this place ----
  for (const lengthId of LENGTH_IDS) {
    const definition = pack.lengths[lengthId];
    if (!definition) continue;
    const inLength = new Set(orderedLocations(definition));
    if (!inLength.has(l.id)) continue;
    const layers = { ground: parsed.layers.ground.map((row) => [...row]), feature: parsed.layers.feature.map((row) => [...row]) };
    const active: GridPoint[] = [];
    for (const [number, point] of [...parsed.doorSlots].sort((x, y) => x[0] - y[0])) {
      const target = a.doors[number - 1];
      if (target && inLength.has(target.to)) active.push(point);
      else layers.feature[point.y]![point.x] = Tile.Wall;
    }
    const origin = parsed.start ?? active[0];
    if (!origin) continue; // a start location without entry is reported elsewhere
    const area: Area = { ...base, layers, decor: a.decor };
    const reachable = reachableTiles(area, origin);
    const lengthCast = new Set(definition.cast);
    const present = [...placed].filter(([id]) => thingKinds.get(id) !== "character" || lengthCast.has(id.slice("char:".length)));
    const from = parsed.start ? "the start tile" : "the first door";
    for (const point of active) {
      if (!reachable.has(key(point.x, point.y))) {
        error("AREA_UNREACHABLE", `${path}.map`, `in the ${lengthId} length the door at ${point.x},${point.y} cannot be reached from ${from}.`);
      }
    }
    for (const [id, point] of present) {
      if (!reachable.has(key(point.x, point.y))) {
        error("AREA_UNREACHABLE", `${path}.placements.${id}`, `in the ${lengthId} length "${id}" at ${point.x},${point.y} cannot be reached from ${from}.`);
      }
    }
  }
}

// The epilogue area is the location's baked area with the ending's people standing where the epilogue says.
function checkEpilogue(pack: StoryPack, lengthId: LengthId, definition: LengthDefinition, error: Report, warn: Report): void {
  const epilogue = definition.epilogue;
  if (!epilogue) {
    warn("EPILOGUE_MISSING", `lengths.${lengthId}.epilogue`, "Add an epilogue so the player can talk with everyone after the ending.");
    return;
  }
  const path = `lengths.${lengthId}.epilogue`;
  if (epilogue.player_sprite) {
    for (const problem of validateSpriteSpec(epilogue.player_sprite, `${path}.player_sprite`)) error("EPILOGUE_PLAYER_SPRITE", `${path}.player_sprite`, problem);
  }
  const inLength = new Set(orderedLocations(definition));
  if (!inLength.has(epilogue.location)) error("EPILOGUE_LOCATION_NOT_IN_LENGTH", `${path}.location`, `"${epilogue.location}" is not a location of the ${lengthId} length.`);
  const lengthEndings = new Set(definition.endings);
  const seen = new Set<string>();
  epilogue.cast.forEach((entry, i) => {
    const at = `${path}.cast[${i}]`;
    if (!definition.cast.includes(entry.id)) error("EPILOGUE_CAST_NOT_IN_LENGTH", `${at}.id`, `"${entry.id}" is not in the ${lengthId} length's cast.`);
    if (seen.has(entry.id)) error("EPILOGUE_CAST_DUPLICATE", `${at}.id`, `"${entry.id}" is listed twice.`);
    seen.add(entry.id);
    for (const endingId of entry.endings ?? []) {
      if (!lengthEndings.has(endingId)) error("EPILOGUE_ENDING_NOT_IN_LENGTH", `${at}.endings`, `"${endingId}" is not an ending of the ${lengthId} length.`);
    }
  });
  for (const endingId of definition.endings) {
    if (!epilogue.cast.some((entry) => !entry.endings || entry.endings.includes(endingId))) {
      error("EPILOGUE_EMPTY_FOR_ENDING", `${path}.cast`, `nobody is present after ending "${endingId}".`);
    }
  }
  const location = pack.locations.find((l) => l.id === epilogue.location);
  const parsed = location?.area ? tryParseMap(location.area.map) : undefined;
  if (!location?.area || !parsed) return;
  const a = location.area;
  const layers = { ground: parsed.layers.ground.map((row) => [...row]), feature: parsed.layers.feature.map((row) => [...row]) };
  const active: GridPoint[] = [];
  for (const [number, point] of [...parsed.doorSlots].sort((x, y) => x[0] - y[0])) {
    const target = a.doors[number - 1];
    if (target && inLength.has(target.to)) active.push(point);
    else layers.feature[point.y]![point.x] = Tile.Wall;
  }
  const area: Area = {
    id: location.id, seed: location.id, name: location.name, biome: a.biome, mood: location.mood, palette: a.palette,
    width: parsed.width, height: parsed.height, layers, entry: parsed.start ?? { x: 0, y: 0 }, spawnPoints: [], doors: [], decor: a.decor,
  };
  const origin = parsed.start ?? active[0];
  const reachable = origin ? reachableTiles(area, origin) : new Set<string>();
  // The location's usual people are not there in the epilogue, so only objects and items block a spot.
  const blocked = new Set<string>([
    ...Object.entries(a.placements).filter(([id]) => !id.startsWith("char:") && !(location.required_characters ?? []).includes(id))
      .map(([, [x, y]]) => key(x!, y!)),
    ...a.decor.map((d) => key(d.x, d.y)),
  ]);
  const taken = new Map<string, string>();
  epilogue.cast.forEach((entry, i) => {
    const at = `${path}.cast[${i}].at`;
    const [x, y] = entry.at;
    if (x < 0 || y < 0 || x >= parsed.width || y >= parsed.height) {
      error("EPILOGUE_PLACEMENT_OUT_OF_BOUNDS", at, `"${entry.id}" is placed at ${x},${y}, outside the ${parsed.width}x${parsed.height} map.`);
      return;
    }
    if (!isWalkable(area, x, y) || parsed.layers.feature[y]?.[x] === Tile.Door) {
      error("EPILOGUE_PLACEMENT_BLOCKED", at, `"${entry.id}" is placed at ${x},${y}, which is not walkable floor.`);
    }
    if (blocked.has(key(x, y))) error("EPILOGUE_PLACEMENT_OVERLAP", at, `"${entry.id}" at ${x},${y} stands on an object or decor.`);
    const other = taken.get(key(x, y));
    if (other) error("EPILOGUE_PLACEMENT_OVERLAP", at, `"${entry.id}" and "${other}" are both placed at ${x},${y}.`);
    taken.set(key(x, y), entry.id);
    if (parsed.start && parsed.start.x === x && parsed.start.y === y) error("EPILOGUE_PLACEMENT_ON_START", at, `"${entry.id}" stands on the player's start tile.`);
    if (origin && !reachable.has(key(x, y))) error("EPILOGUE_UNREACHABLE", at, `"${entry.id}" at ${x},${y} cannot be reached.`);
  });
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

// Routes are independent when they share no place, requirement or evidence. A clue that only comes out of a
// broken statement also depends on the statement's evidence when exactly one piece of it can be obtained.
function independentRoutes(pack: StoryPack, clueIds: string[], solved: SolveResult): string[] {
  const chosen: { id: string; keys: Set<string> }[] = [];
  for (const id of clueIds) {
    const clue = pack.clues.find((c) => c.id === id);
    if (!clue) continue;
    const sources = [clue.where, ...clue.alternatives];
    const gates = sources.map((w) => (w.type === "character"
      ? pack.cast.find((m) => m.id === w.id)?.statements?.filter((st) => st.clue_id === clue.id) ?? []
      : []));
    const evidenceKeys: string[] = [];
    if (gates.every((list) => list.length > 0)) {
      const pieces = new Set(gates.flat().flatMap((st) => heldEvidence(st, solved)));
      if (pieces.size === 1) evidenceKeys.push(...pieces);
    }
    const keys = new Set([
      `clue:${clue.id}`,
      ...sources.map((w) => `${w.type}:${w.id}`),
      ...requirementEntries(clue.requirements),
      ...evidenceKeys,
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

  // The proof for a question must be gatherable before the player answers it: for a deduction without the truth
  // it confirms, for a summation question with everything the player can do.
  const unobtainable = (proof: Proof, found: SolveResult, path: string, owner: string): void => {
    const obtainable = proofPieces(proof).filter((piece) => (piece.type === "item" ? found.items : found.clues).has(piece.id));
    if (obtainable.length >= requiredCount(proof)) return;
    error("PROOF_UNOBTAINABLE", path, `${owner} needs ${requiredCount(proof)} piece(s) of proof in the ${lengthId} length, but only ${obtainable.length} can be obtained before it is answered. Obtainable: ${obtainable.map((piece) => piece.id).join(", ") || "(none)"}.`);
  };
  [...len.core_truths, ...len.side_truths].forEach((id) => {
    const index = pack.truths.findIndex((t) => t.id === id);
    const proof = pack.truths[index]?.deduction?.proof;
    if (!proof) return;
    unobtainable(proof, solveLength(pack, len, { withholdTruth: id }), `truths[${index}].deduction.proof`, `the deduction of truth "${id}"`);
  });
  len.endings.forEach((endingId) => {
    const index = pack.endings.findIndex((e) => e.id === endingId);
    (pack.endings[index]?.summation ?? []).forEach((entry, j) => {
      if (entry.proof) unobtainable(entry.proof, solved, `endings[${index}].summation[${j}].proof`, `the summation question ${j + 1} of ending "${endingId}"`);
    });
  });

  for (const truthId of len.core_truths) {
    const reachable = pack.clues.filter((cl) => cl.truth_id === truthId && solved.clues.has(cl.id)).map((cl) => cl.id);
    const routes = independentRoutes(pack, reachable, solved);
    if (routes.length < c.routesPerCoreTruth) {
      error("CORE_TRUTH_ROUTES", `${p}.core_truths`, `core truth "${truthId}" has ${routes.length} independent clue route(s) in the ${lengthId} length but needs ${c.routesPerCoreTruth}. Obtainable clues: ${reachable.join(", ") || "(none)"}. Routes are independent when their clues are found in different places and share no required items, goal states or truths.`);
    }
  }

  // Every statement that can be heard in this length must be breakable in it.
  pack.cast.forEach((m, i) => {
    if (!solved.cast.has(m.id)) return;
    (m.statements ?? []).forEach((st, j) => {
      if (!isSatisfied(st.requires, solved) || solved.statements.has(st.id)) return;
      const evidence = [...(st.broken_by.items ?? []), ...(st.broken_by.clues ?? [])];
      error("STATEMENT_UNBREAKABLE", `cast[${i}].statements[${j}].broken_by`, `statement "${st.id}" can be heard in the ${lengthId} length, but none of its evidence (${evidence.join(", ") || "none"}) can be obtained there. Add evidence from this length or gate the statement with requires.`);
    });
  });

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

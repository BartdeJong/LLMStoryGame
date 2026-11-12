// Clue anchors. A clue found at a location is attached to one object there (clue.object_id): examining that object
// finds the clue, so a clue is never a floating marker of its own. Story Forge runs this once per pack (anchor-clues).
import { getGlyph, resolveVisualSpec } from "../../../src/art/glyphs";
import { placedObjects } from "../../../src/story/slice";
import type { Clue, Location, StoryPack, WorldObject } from "../../../src/story/types";
import { overlap, words } from "./furnish";

export type AnchorDecision =
  | { type: "clue"; locationId: string; clueId: string; objectId: string; reason: "same id" | "word match" | "new object" }
  | { type: "object"; locationId: string; object: WorldObject; forClueId: string };

// The location a clue is found at. A clue told only by a character needs no anchor.
function foundAt(clue: Clue): string | undefined {
  return [clue.where, ...clue.alternatives].find((source) => source.type === "location")?.id;
}

function objectWords(object: WorldObject): Set<string> {
  const icon = object.visual?.icon ?? resolveVisualSpec(object.name, object.description).icon;
  return words(`${object.name} ${getGlyph(icon)?.name ?? ""}`);
}

// "cl_shard_match" -> "Shard match"
function nameFromClueId(clueId: string): string {
  const label = clueId.replace(/^cl_/, "").replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Attaches every clue found at a location that has no anchor yet. Mutates the pack and returns the decisions, so the
// text edits made from them can be checked against the pack. For each clue, in order:
//   1. a location object with the clue's id;
//   2. else the location object whose name (or glyph name) shares the most words with the clue's id and text;
// Clues still without an object then get a new one at their location, with the clue's id, a name made from it, the
// clue text and a matching icon. Existing objects are always tried first, so a new object never pulls in a clue meant
// for another object. Several clues may share one object. Throws when a clue names an object not at its location.
export function anchorClues(pack: StoryPack): AnchorDecision[] {
  const decisions: AnchorDecision[] = [];
  const unanchored: { clue: Clue; location: Location }[] = [];
  for (const clue of pack.clues) {
    const locationId = foundAt(clue);
    if (!locationId) continue;
    const location = pack.locations.find((candidate) => candidate.id === locationId);
    if (!location) throw new Error(`Clue "${clue.id}" is found at unknown location "${locationId}".`);
    const objects = placedObjects(pack, location);
    if (clue.object_id !== undefined) {
      if (objects.some((object) => object.id === clue.object_id)) continue;
      throw new Error(`Clue "${clue.id}" names object "${clue.object_id}", which is not an object of "${locationId}". Fix it by hand.`);
    }

    const same = objects.find((object) => object.id === clue.id);
    if (same) {
      clue.object_id = same.id;
      decisions.push({ type: "clue", locationId, clueId: clue.id, objectId: same.id, reason: "same id" });
      continue;
    }

    const clueWords = words(`${clue.id.replace(/_/g, " ")} ${clue.text}`);
    let best: WorldObject | undefined;
    let bestScore = 0;
    for (const object of objects) {
      const score = overlap(clueWords, objectWords(object));
      if (score > bestScore) {
        best = object;
        bestScore = score;
      }
    }
    if (best) {
      clue.object_id = best.id;
      decisions.push({ type: "clue", locationId, clueId: clue.id, objectId: best.id, reason: "word match" });
    } else {
      unanchored.push({ clue, location });
    }
  }

  for (const { clue, location } of unanchored) {
    if (location.objects.some((object) => object.id === clue.id)) {
      throw new Error(`Cannot add an object for clue "${clue.id}": "${location.id}" already has an object with that id.`);
    }
    const name = nameFromClueId(clue.id);
    const object: WorldObject = {
      id: clue.id,
      name,
      description: clue.text,
      visual: { icon: resolveVisualSpec(name, clue.text).icon },
    };
    location.objects.push(object);
    clue.object_id = object.id;
    decisions.push({ type: "object", locationId: location.id, object, forClueId: clue.id });
    decisions.push({ type: "clue", locationId: location.id, clueId: clue.id, objectId: object.id, reason: "new object" });
  }
  return decisions;
}

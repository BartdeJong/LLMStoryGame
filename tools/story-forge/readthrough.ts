import { solveLength } from "../../src/story/solver";
import type { LengthId, Requirement, StoryPack } from "../../src/story/types";

function list(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- (none)";
}

function requiredItems(requirement: Requirement | undefined): string[] {
  return requirement?.items ?? [];
}

function usedItemIds(pack: StoryPack, steps: string[], foundItems: Set<string>, foundClues: Set<string>, resolvedGoals: Set<string>): Set<string> {
  const used = new Set<string>();
  const add = (items: string[]): void => items.forEach((id) => {
    if (foundItems.has(id)) used.add(id);
  });

  for (const clue of pack.clues) {
    if (foundClues.has(clue.id)) add(requiredItems(clue.requirements));
  }
  for (const member of pack.cast) {
    for (const state of member.goal_states) {
      if (resolvedGoals.has(state.id)) add(requiredItems(state.requires));
    }
  }
  for (const item of pack.items) {
    if (foundItems.has(item.id)) add(requiredItems(item.found_requires));
  }
  for (const step of steps) {
    const match = /^Enter (\S+) from (\S+)$/.exec(step);
    if (!match) continue;
    const [, destination, source] = match;
    const door = pack.locations.find((location) => location.id === source)?.doors.find((candidate) => candidate.to === destination);
    if (door) add(requiredItems(door.lock));
  }
  return used;
}

function named(id: string, collection: { id: string; name: string }[]): string {
  return collection.find((entry) => entry.id === id)?.name ?? id;
}

export function formatReadthrough(pack: StoryPack, lengthId: LengthId): string {
  const length = pack.lengths[lengthId];
  if (!length) throw new Error(`Story "${pack.identity.id}" has no "${lengthId}" length.`);

  const solved = solveLength(pack, length);
  const locationIds = solved.steps.flatMap((step) => {
    const match = /^(?:Start at|Enter) (\S+)/.exec(step);
    return match ? [match[1]] : [];
  });
  const clueIds = [...solved.clues];
  const castIds = [...solved.cast];
  const truthIds = [...solved.truths];
  const usedItems = usedItemIds(pack, solved.steps, solved.items, solved.clues, solved.goalStates);
  const locationLines = locationIds.map((id, index) => `${index + 1}. ${named(id, pack.locations)}`);
  const clueLines = clueIds.map((id) => {
    const clue = pack.clues.find((entry) => entry.id === id);
    return clue ? `${clue.text} [${id}]` : id;
  });
  const castLines = castIds.map((id) => {
    const member = pack.cast.find((entry) => entry.id === id);
    return member ? `${member.name} (${member.species})` : id;
  });
  const itemLines = [...usedItems].map((id) => `${named(id, pack.items)} [${id}]`);
  const truthLines = truthIds.map((id) => {
    const truth = pack.truths.find((entry) => entry.id === id);
    return truth ? `${truth.text} [${id}]` : id;
  });
  const evidenceName = (ref: string): string => {
    const [kind, id = ""] = ref.split(":");
    if (kind === "item") return `item ${named(id, pack.items)}`;
    return `clue "${pack.clues.find((entry) => entry.id === id)?.text ?? id}"`;
  };
  const statementLines = pack.cast.flatMap((member) => (member.statements ?? []).map((statement) => {
    const evidence = solved.statements.get(statement.id);
    const reveals = statement.clue_id ? ` -> reveals [${statement.clue_id}]` : "";
    return evidence
      ? `${member.name}: "${statement.text}" broken with ${evidenceName(evidence)} [${evidence}]${reveals} [${statement.id}]`
      : solved.cast.has(member.id) ? `${member.name}: "${statement.text}" left standing (cannot be heard or broken) [${statement.id}]` : "";
  })).filter(Boolean);
  const endingLines = solved.endings.map((id) => {
    const ending = pack.endings.find((entry) => entry.id === id);
    return ending ? `${ending.scene_outline} [${id}]` : id;
  });

  return [
    `${pack.identity.title} - ${lengthId} (${length.target_minutes} min)`,
    "",
    "Locations:",
    ...locationLines,
    "",
    "Clues found:",
    list(clueLines),
    "",
    "Characters met:",
    list(castLines),
    "",
    "Items used:",
    list(itemLines),
    "",
    "Statements broken:",
    list(statementLines),
    "",
    "Truths revealed:",
    list(truthLines),
    "",
    "Ending reached:",
    list(endingLines),
  ].join("\n");
}

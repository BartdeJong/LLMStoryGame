import { describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import lanterntide from "../../public/stories/lanterntide.json";
import holmes from "../../public/stories/holmesashenvelope.json";
import { ConversationController } from "../dialogue/controller";
import { giveOptions } from "../dialogue/effects";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import { getLengthView } from "./loader";
import { storyMockRespond } from "./mockResponder";
import { findDoorLock, isRequirementMet } from "./requirements";
import { solveLength } from "./solver";
import { writeEnding } from "./ending";
import { StorySession } from "./storySession";
import { answerDeduction, openDeductions } from "./deduction";
import type { LengthId, StoryPack } from "./types";
import { validateStoryPack } from "./validate";

function loadPack(data: unknown): StoryPack {
  const report = validateStoryPack(data);
  if (!report.pack) throw new Error(`Invalid test pack: ${report.errors.map((issue) => issue.message).join("; ")}`);
  return report.pack;
}

async function makeClient(): Promise<LLMClient> {
  const client = new LLMClient(
    new MockBackend({ respond: storyMockRespond }),
    { pauseWhenHidden: false },
  );
  await client.load();
  return client;
}

async function simulate(pack: StoryPack, lengthId: LengthId): Promise<void> {
  const view = getLengthView(pack, lengthId);
  const expected = solveLength(pack, view.definition);
  expect(expected.endings.length, `${pack.identity.id} ${lengthId} has a solver path`).toBeGreaterThan(0);

  const client = await makeClient();
  const story = new StorySession(pack, view, client);
  let currentAreaId = (await story.start()).id;
  const firstFinaleLocation = view.beats[view.beats.length - 1]?.locations[0];
  if (firstFinaleLocation) expect(story.getEndingChoices(firstFinaleLocation)).toEqual([]);

  const moveTo = async (targetId: string): Promise<void> => {
    if (targetId === currentAreaId) return;
    const queue = [currentAreaId];
    const previous = new Map<string, string | null>([[currentAreaId, null]]);
    for (let cursor = 0; cursor < queue.length && !previous.has(targetId); cursor += 1) {
      const from = queue[cursor]!;
      const location = pack.locations.find((candidate) => candidate.id === from);
      if (!location) continue;
      const neighbours = [
        ...location.doors.map((door) => door.to),
        ...pack.locations.filter((candidate) => candidate.doors.some((door) => door.to === from)).map((candidate) => candidate.id),
      ];
      for (const to of neighbours) {
        if (previous.has(to) || !story.isLocationOpen(to)) continue;
        if (!isRequirementMet(findDoorLock(pack, from, to), story.state)) continue;
        previous.set(to, from);
        queue.push(to);
      }
    }
    if (!previous.has(targetId)) throw new Error(`No open route from ${currentAreaId} to ${targetId}.`);
    const path: string[] = [];
    for (let step: string | null = targetId; step && step !== currentAreaId; step = previous.get(step) ?? null) path.unshift(step);
    for (const nextId of path) {
      const area = story.getArea(currentAreaId);
      const door = area.doors.find((candidate) => candidate.targetAreaId === nextId);
      if (!door) throw new Error(`Missing generated door from ${currentAreaId} to ${nextId}.`);
      currentAreaId = (await story.enterDoor(currentAreaId, door.id)).area.id;
    }
  };

  const speakTo = async (characterId: string, goalStateId?: string, clueId?: string): Promise<void> => {
    const character = pack.cast.find((candidate) => candidate.id === characterId);
    if (!character) throw new Error(`Missing character ${characterId}.`);
    await moveTo(character.home_location);
    const area = story.getArea(currentAreaId);
    const controller = new ConversationController(client, pack, story.state, character, {
      locationName: area.name,
      locationMood: area.mood,
      storySummary: story.state.summary,
      inventory: pack.items.filter((item) => story.state.itemsHeld.includes(item.id)).map((item) => ({ id: item.id, name: item.name })),
    });
    await controller.start();
    for (let turns = 0; turns < 4; turns += 1) {
      const goalOpen = goalStateId && !story.state.resolvedGoalStates.includes(goalStateId);
      const clueOpen = clueId && !story.state.cluesFound.includes(clueId);
      const option = giveOptions(pack, story.state, character)[0];
      if (goalOpen && option) await controller.give(option.itemId);
      else if (clueOpen) {
        const knowledge = character.knowledge.find((item) => item.clue_id === clueId);
        const statement = character.statements?.find((candidate) => candidate.clue_id === clueId);
        if (knowledge) await controller.reply(knowledge.ask);
        else if (statement) await hearAndBreak(controller, statement.id, statement.ask);
        else break;
      } else break;
    }
    if (goalStateId) expect(story.state.resolvedGoalStates, `resolved ${goalStateId}`).toContain(goalStateId);
    if (clueId) expect(story.state.cluesFound, `found ${clueId}`).toContain(clueId);
  };

  // Hears a statement, then challenges it with the evidence the solver used.
  const hearAndBreak = async (controller: ConversationController, statementId: string, ask: string): Promise<void> => {
    if (!story.state.statementsHeard?.includes(statementId)) await controller.reply(ask);
    expect(story.state.statementsHeard, `heard ${statementId}`).toContain(statementId);
    const [type, id] = (expected.statements.get(statementId) ?? "").split(":") as ["item" | "clue", string];
    await controller.challenge(statementId, { type, id });
  };

  // A solving player answers every open casebook question as soon as it appears.
  const confirmOpenDeductions = (): void => {
    for (let guard = 0; guard < 20; guard += 1) {
      const [open] = openDeductions(pack, story.state);
      if (!open) return;
      expect(answerDeduction(pack, story.state, open.id, open.deduction!.answer).correct).toBe(true);
    }
  };

  for (const step of expected.steps) {
    confirmOpenDeductions();
    const enter = /^Enter (\S+) from /.exec(step);
    if (enter) {
      await moveTo(enter[1]!);
      continue;
    }

    const goal = /^Resolve goal (\S+) with (\S+)$/.exec(step);
    if (goal) {
      await speakTo(goal[2]!, goal[1]);
      continue;
    }

    const item = /^Find item (\S+) at /.exec(step);
    if (item) {
      const definition = pack.items.find((candidate) => candidate.id === item[1]);
      if (definition?.found_at?.type === "location") {
        await moveTo(definition.found_at.id);
        const entity = story.getArea(currentAreaId).entities?.find(
          (candidate) => candidate.kind === "key" && candidate.packId === definition.id,
        );
        expect(entity, `item entity ${definition.id}`).toBeDefined();
        story.collectItem(entity!);
        expect(story.state.itemsHeld).toContain(definition.id);
      } else if (definition?.found_at?.type === "character") {
        await speakTo(definition.found_at.id);
        expect(story.state.itemsHeld).toContain(definition.id);
      }
      continue;
    }

    const clueMatch = /^Find clue (\S+) \(/.exec(step);
    if (clueMatch) {
      const clue = pack.clues.find((candidate) => candidate.id === clueMatch[1])!;
      const sources = [clue.where, ...clue.alternatives];
      const accessibleSource = sources.find((source) => {
        const locationId = source.type === "location"
          ? source.id
          : pack.cast.find((candidate) => candidate.id === source.id)?.home_location;
        return locationId !== undefined && story.state.visitedAreas.includes(locationId);
      });
      expect(accessibleSource, `accessible source for ${clue.id}`).toBeDefined();
      if (accessibleSource?.type === "location") {
        await moveTo(accessibleSource.id);
        const entity = story.getArea(currentAreaId).entities?.find(
          (candidate) => candidate.clueIds?.includes(clue.id),
        );
        expect(entity, `object anchoring clue ${clue.id}`).toBeDefined();
        story.examineClues(entity!);
        expect(story.state.cluesFound).toContain(clue.id);
      } else if (accessibleSource?.type === "character") {
        await speakTo(accessibleSource.id, undefined, clue.id);
      }
    }
  }

  confirmOpenDeductions();
  expect([...expected.truths].every((id) => story.state.truthsFound.includes(id))).toBe(true);
  expect([...expected.goalStates].every((id) => story.state.resolvedGoalStates.includes(id))).toBe(true);
  expect([...expected.items].every((id) => story.state.itemsHeld.includes(id))).toBe(true);

  const finaleLocation = view.beats[view.beats.length - 1]?.locations.find((id) => expected.locations.has(id));
  expect(finaleLocation).toBeDefined();
  await moveTo(finaleLocation!);
  const choices = story.getEndingChoices(currentAreaId);
  expect(choices.length, "the finale offers a choice").toBeGreaterThan(0);
  for (const chosen of choices) {
    story.state.choicesMade.length = 0;
    const selected = new Set(chosen.choices);
    const expectedEnding = view.endings
      .filter((ending) =>
        ending.conditions.truths.every((id) => expected.truths.has(id))
        && ending.conditions.goal_states.every((id) => expected.goalStates.has(id))
        && ending.conditions.choices.every((id) => selected.has(id)),
      )
      .sort((a, b) =>
        b.conditions.truths.length + b.conditions.goal_states.length + b.conditions.choices.length
        - a.conditions.truths.length - a.conditions.goal_states.length - a.conditions.choices.length,
      )[0];
    expect(expectedEnding, `choice "${chosen.label}" matches a solver-reachable ending`).toBeDefined();
    const played = await story.finishEnding(chosen.choices, currentAreaId);
    expect(played.endingId).toBe(expectedEnding!.id);
    expect(played.scene).toBe(expectedEnding!.scene_outline);
    expect(played.epilogue).toBe(expectedEnding!.epilogue_notes);
  }
}

describe("M7 pacing and ending simulations", () => {
  const packs = [loadPack(example), loadPack(lanterntide)];
  for (const pack of packs) {
    for (const lengthId of Object.keys(pack.lengths) as LengthId[]) {
      it(`plays ${pack.identity.id} (${lengthId}) from the solver path to its ending`, async () => {
        await simulate(pack, lengthId);
      });
    }
  }

  it("draws the Sherlock cast in-game from their authored sprite specs", async () => {
    const pack = loadPack(holmes);
    const view = getLengthView(pack);
    const story = new StorySession(pack, view, await makeClient());
    const area = await story.start();
    const characters = area.entities?.filter((entity) => entity.kind === "character") ?? [];

    expect(characters.length).toBeGreaterThan(0);
    for (const entity of characters) {
      const member = pack.cast.find((candidate) => candidate.id === entity.packId);
      expect(member).toBeDefined();
      expect(entity.sprite).toEqual(member!.sprite);
    }
    expect(characters.map((entity) => entity.sprite?.headwear?.style)).toEqual([
      "deerstalker",
      undefined,
      "bonnet",
    ]);
  });

  it("uses the authored outline and epilogue when ending generation fails", async () => {
    const pack = loadPack(example);
    const ending = pack.endings[0]!;
    const client = new LLMClient(
      new MockBackend({ respond: () => "{broken" }),
      { pauseWhenHidden: false },
    );
    await client.load();

    await expect(writeEnding(client, pack, ending)).resolves.toMatchObject({
      endingId: ending.id,
      scene: ending.scene_outline,
      epilogue: ending.epilogue_notes,
    });
  });
});

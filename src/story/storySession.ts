import type { LLMClient } from "../llm/client";
import type { Area, AreaEntity, GridPoint } from "../world/types";
import { buildPackArea, doorSpawn, type BriefCharacter, type StoryAreaBrief } from "./packArea";
import type { LengthView } from "./loader";
import { findDoorLock, isRequirementMet, missingRequirementNames } from "./requirements";
import { endingChoiceLabel, writeEnding } from "./ending";
import { pickSummation, type SummationQuestion } from "./deduction";
import type { EndingChoice, EndingScene } from "./ending";
import { caseRecordOf, createStoryState, giveItem, grantTruthsFromFoundClues, markClueFound, markCollected, markVisited, summaryDue } from "./state";
import type { StoryState } from "./state";
import { refreshSummary } from "./summary";
import { statementForClue } from "./statements";
import { caseResult, endingVariant } from "./caseRecord";
import { layoutStoryWorld, type LocationCell, type StoryWorldLayout } from "./worldLayout";
import type { Beat, CastMember, Ending, Epilogue, EpilogueCast, Item, StoryPack } from "./types";
import { recipeFromSprite } from "./recipes";
import type { GameSave } from "../save/types";

export interface CollectResult {
  item: Item;
  given: boolean; // false when the item was already held (a repeat pickup changes nothing)
  blocked: boolean;
}

export interface StoryTransition {
  area: Area;
  spawn: GridPoint;
}

// Runtime glue: pack + length -> areas the player can walk through. Areas are built from the pack, never generated.
export class StorySession {
  readonly state: StoryState;
  private readonly areas = new Map<string, Area>();
  private readonly briefsByArea = new Map<string, StoryAreaBrief>();
  private readonly worldLayout: StoryWorldLayout;
  private summaryRunning = false;

  constructor(
    readonly pack: StoryPack,
    readonly view: LengthView,
    readonly client: LLMClient,
    readonly worldSeed = `${pack.identity.id}:${pack.identity.version}`,
  ) {
    this.state = createStoryState(view);
    this.worldLayout = layoutStoryWorld(pack, view);
  }

  get startLocationId(): string {
    return this.view.startLocation;
  }

  // Where a location lies on the compass grid of this story's world.
  getMapCell(locationId: string): LocationCell | undefined {
    return this.worldLayout.get(locationId);
  }

  // Names of the cast members in a visited area that the player has already talked to.
  getPeopleMet(areaId: string): string[] {
    return (this.areas.get(areaId)?.entities ?? [])
      .filter((entity) => entity.kind === "character" && entity.packId !== undefined
        && (this.state.characterMemory[entity.packId]?.visits ?? 0) > 0)
      .map((entity) => entity.name);
  }

  get epilogue(): Epilogue | undefined {
    return this.view.definition.epilogue;
  }

  // True once the ending has played in a story with an epilogue: the player then walks one area and talks freely.
  get inEpilogue(): boolean {
    return this.state.endingReached !== undefined && this.epilogue !== undefined;
  }

  // The people present after the ending that played.
  epilogueCast(): EpilogueCast[] {
    const endingId = this.state.endingReached?.endingId;
    return (this.epilogue?.cast ?? []).filter((entry) => !entry.endings || (endingId !== undefined && entry.endings.includes(endingId)));
  }

  // Records the ending. With an epilogue, builds its area and returns it with the player's starting tile.
  enterEpilogue(ending: EndingScene): StoryTransition | null {
    this.state.endingReached = ending;
    const epilogue = this.epilogue;
    if (!epilogue) return null;
    const area = this.buildArea(epilogue.location);
    markVisited(this.state, area.id);
    return { area, spawn: area.entry };
  }

  // Questions of the final case, for the recap. Unlike getSummation it does not depend on where the player is.
  getRecapSummation(): SummationQuestion[] {
    return pickSummation(this.view.endings.filter((ending) => this.endingFactsMet(ending))) ?? [];
  }

  // True for the places that belong to the lead the player is following right now and still hold
  // evidence or facts (clues and what the characters there can tell) that the player has not found.
  isLeadLocation(locationId: string): boolean {
    if (this.inEpilogue) return false;
    if (!this.currentBeat.locations.includes(locationId)) return false;
    const area = this.areas.get(locationId);
    if (!area || !this.state.visitedAreas.includes(locationId)) return true;
    return (area.entities ?? []).some((entity) => {
      if (this.hasOpenClues(entity)) return true;
      if (entity.kind === "key") return !this.state.collectedEntities.includes(entity.id);
      if (entity.kind !== "character" || !entity.packId) return false;
      const character = this.pack.cast.find((member) => member.id === entity.packId);
      return character?.knowledge.some((item) => !this.state.knowledgeTold.includes(`${character.id}:${item.id}`)) ?? false;
    });
  }

  get currentBeat(): Beat {
    const beat = this.view.beats[this.openBeatCount() - 1];
    if (!beat) throw new Error(`Story "${this.pack.identity.id}" has no current beat.`);
    return beat;
  }

  getArea(areaId: string): Area {
    const area = this.areas.get(areaId);
    if (!area) throw new Error(`Area "${areaId}" has not been visited.`);
    return area;
  }

  getBrief(areaId: string): StoryAreaBrief | undefined {
    return this.briefsByArea.get(areaId);
  }

  // The areas the player has visited, as currently built (collected things already removed).
  getAreas(): Area[] {
    return [...this.areas.values()];
  }

  getAreaIds(): string[] {
    return [...this.areas.keys()];
  }

  restoreSave(save: GameSave): void {
    if (save.packId !== this.pack.identity.id || save.packVersion !== this.pack.identity.version
      || save.length !== this.view.length || save.worldSeed !== this.worldSeed) {
      throw new Error("The save does not match this story session.");
    }
    Object.assign(this.state, save.storyState);
    this.areas.clear();
    this.briefsByArea.clear();
    for (const areaId of save.areaIds) {
      if (!this.view.locations.some((location) => location.id === areaId)) continue;
      this.buildArea(areaId);
    }
  }

  isLocationOpen(locationId: string): boolean {
    const beatIndex = this.view.beats.findIndex((beat) => beat.locations.includes(locationId));
    return beatIndex >= 0 && beatIndex < this.openBeatCount();
  }

  isFinaleLocation(locationId: string): boolean {
    const finale = this.view.beats[this.view.beats.length - 1];
    return finale?.locations.includes(locationId) ?? false;
  }

  getEndingChoices(locationId: string): EndingChoice[] {
    if (this.inEpilogue) return [];
    if (!this.isFinaleLocation(locationId) || !this.state.visitedAreas.includes(locationId)) return [];
    const eligible = this.view.endings.filter((ending) => this.endingFactsMet(ending));
    const options = new Map<string, EndingChoice>();
    for (const ending of eligible) {
      const choices = [...new Set(ending.conditions.choices)].sort();
      const key = choices.join("\u0000");
      if (!options.has(key)) options.set(key, { choices, label: endingChoiceLabel(choices) });
    }
    return [...options.values()];
  }

  // Questions the player must answer before the ending, or null when the ending has no summation.
  getSummation(locationId: string): SummationQuestion[] | null {
    if (this.getEndingChoices(locationId).length === 0) return null;
    return pickSummation(this.view.endings.filter((ending) => this.endingFactsMet(ending)));
  }

  // True when the open beat waits only on truths and at least one of them is an open casebook question.
  currentBeatWaitsOnDeduction(): boolean {
    const need = this.currentBeat.must_find;
    if (!need || isRequirementMet(need, this.state)) return false;
    const itemsAndGoalsMet = isRequirementMet({ items: need.items, goal_states: need.goal_states }, this.state);
    const missing = (need.truths ?? []).filter((id) => !this.state.truthsFound.includes(id));
    return itemsAndGoalsMet && missing.some((id) => this.state.truthsReady.includes(id));
  }

  async finishEnding(choices: readonly string[], finaleLocationId: string): Promise<EndingScene> {
    const selected = [...new Set(choices)].sort();
    const option = this.getEndingChoices(finaleLocationId).find((candidate) =>
      sameStrings(candidate.choices, selected),
    );
    if (!option) throw new Error("That ending choice is not available yet.");
    for (const choice of selected) {
      if (!this.state.choicesMade.includes(choice)) this.state.choicesMade.push(choice);
    }
    const ending = this.view.endings
      .filter((candidate) =>
        this.endingFactsMet(candidate)
        && candidate.conditions.choices.every((choice) => this.state.choicesMade.includes(choice)),
      )
      .sort((a, b) => endingSpecificity(b) - endingSpecificity(a))[0];
    if (!ending) throw new Error("No ending matches the choices and story so far.");
    // A flawed case plays the ending's authored flawed variant, when it has one.
    return writeEnding(this.client, this.pack, ending, endingVariant(ending, caseResult(caseRecordOf(this.state))));
  }

  getAvailableCharacterClues(characterId: string): { id: string; text: string }[] {
    if (this.inEpilogue) return [];
    if (!this.view.definition.cast.includes(characterId)) return [];
    return this.pack.clues
      .filter((clue) => {
        const availableHere = [clue.where, ...clue.alternatives].some(
          (source) => source.type === "character" && source.id === characterId,
        );
        if (!availableHere || this.state.cluesFound.includes(clue.id)) return false;
        // A clue behind one of this character's statements is not offered: it takes a challenge.
        if (statementForClue(this.pack, characterId, clue.id)) return false;
        return isRequirementMet(clue.requirements, this.state);
      })
      .map((clue) => ({ id: clue.id, text: clue.text }));
  }

  // Builds (once) and returns the start area.
  start(): Area {
    const area = this.ensureArea(this.startLocationId);
    this.onEntered(area);
    return area;
  }

  enterDoor(fromAreaId: string, doorId: string): StoryTransition {
    const door = this.getArea(fromAreaId).doors.find((candidate) => candidate.id === doorId);
    if (!door?.targetAreaId) throw new Error(`Area "${fromAreaId}" has no usable door "${doorId}".`);
    if (this.isDoorLocked(fromAreaId, doorId)) {
      throw new Error(this.describeDoorLock(fromAreaId, doorId) ?? "That path is not open yet.");
    }
    const area = this.ensureArea(door.targetAreaId);
    const returnDoor = area.doors.find((candidate) => candidate.targetAreaId === fromAreaId);
    const spawn = returnDoor ? doorSpawn(area, returnDoor) : area.entry;
    this.onEntered(area);
    return { area, spawn };
  }

  // True while the object anchors a clue the player has not found yet.
  hasOpenClues(entity: AreaEntity): boolean {
    return (entity.clueIds ?? []).some((id) => !this.state.cluesFound.includes(id));
  }

  // True when the object anchors clues and the player has found all of them.
  allCluesFound(entity: AreaEntity): boolean {
    return (entity.clueIds?.length ?? 0) > 0 && !this.hasOpenClues(entity);
  }

  // Examining an object records the clues anchored to it whose requirements are met. Returns the clue text to show,
  // or null when the object has no clue left to find (it then reads as plain scenery).
  examineClues(entity: AreaEntity): string | null {
    if (!this.hasOpenClues(entity)) return null;
    const texts: string[] = [];
    for (const id of entity.clueIds ?? []) {
      const clue = this.pack.clues.find((candidate) => candidate.id === id);
      if (!clue || this.state.cluesFound.includes(id) || !isRequirementMet(clue.requirements, this.state)) continue;
      markClueFound(this.state, clue.id);
      texts.push(clue.text);
    }
    if (texts.length === 0) return "This little detail can wait until the story has unfolded a bit more.";
    grantTruthsFromFoundClues(this.pack, this.state);
    return texts.join(" ");
  }

  // The pack core for a character entity, or undefined for a non-cast entity (no core, no dialogue).
  getCharacter(entity: AreaEntity): CastMember | undefined {
    if (entity.kind !== "character" || !entity.packId) return undefined;
    const member = this.pack.cast.find((candidate) => candidate.id === entity.packId);
    return member && this.inEpilogue ? this.epilogueCharacter(member) : member;
  }

  // After the ending there is nothing left to find: no knowledge, statements, needs or secrets, only the
  // character's voice, the authored epilogue greeting and the epilogue's small talk.
  private epilogueCharacter(member: CastMember): CastMember {
    const entry = this.epilogueCast().find((candidate) => candidate.id === member.id);
    return {
      ...member,
      goal: "Talk about how everything turned out.",
      secret: "",
      greetings: entry ? [entry.greeting] : member.greetings,
      knowledge: [],
      statements: [],
      reactions: [],
      goal_states: [],
      goal_hints: { unmet: [], in_progress: [], resolved: [] },
      deflections: this.epilogue?.deflections.length ? this.epilogue.deflections : member.deflections,
    };
  }

  // Picking up a key item. Safe to call again on the same entity: a second pickup never duplicates the item.
  collectItem(entity: AreaEntity): CollectResult | null {
    if (entity.kind !== "key" || !entity.packId) return null;
    const item = this.pack.items.find((candidate) => candidate.id === entity.packId);
    if (!item) return null;
    if (!isRequirementMet(item.found_requires, this.state)) return { item, given: false, blocked: true };
    markCollected(this.state, entity.id);
    for (const [areaId, area] of this.areas) {
      if (!area.entities?.some((candidate) => candidate.id === entity.id)) continue;
      this.areas.set(areaId, {
        ...area,
        entities: area.entities.filter((candidate) => candidate.id !== entity.id),
      });
      break;
    }
    return { item, given: giveItem(this.state, item.id), blocked: false };
  }

  isDoorLocked(areaId: string, doorId: string): boolean {
    if (this.inEpilogue) return true;
    const door = this.getArea(areaId).doors.find((candidate) => candidate.id === doorId);
    if (!door?.targetAreaId) return false;
    return !this.isLocationOpen(door.targetAreaId)
      || !isRequirementMet(findDoorLock(this.pack, areaId, door.targetAreaId), this.state);
  }

  // A short "you need..." message for a locked door, or null if it is not locked.
  describeDoorLock(areaId: string, doorId: string): string | null {
    const door = this.getArea(areaId).doors.find((candidate) => candidate.id === doorId);
    if (!door?.targetAreaId) return null;
    if (this.inEpilogue) return this.epilogue?.door_message ?? "The story has ended.";
    if (!this.isLocationOpen(door.targetAreaId)) {
      return "This path will open once the current part of the story has settled. Keep exploring nearby for another clue or a neighbor who could use a hand.";
    }
    const lock = findDoorLock(this.pack, areaId, door.targetAreaId);
    if (isRequirementMet(lock, this.state)) return null;
    const missing = missingRequirementNames(this.pack, lock, this.state);
    return missing.length > 0 ? `It's locked. You need: ${missing.join(", ")}.` : "It's locked.";
  }

  // The same reason in a few words, for places with little room such as the map. Null when the door is open.
  describeDoorLockBriefly(areaId: string, doorId: string): string | null {
    const door = this.getArea(areaId).doors.find((candidate) => candidate.id === doorId);
    if (!door?.targetAreaId) return null;
    if (this.inEpilogue) return "The story has ended";
    if (!this.isLocationOpen(door.targetAreaId)) return "Opens later in the story";
    const lock = findDoorLock(this.pack, areaId, door.targetAreaId);
    if (isRequirementMet(lock, this.state)) return null;
    const missing = [...new Set(missingRequirementNames(this.pack, lock, this.state))];
    return missing.length > 0 ? `Needs ${missing.join(", ")}` : "Locked";
  }

  // What a sign on a door says: the name of the place behind it once the player has been there, otherwise the
  // door's own label, which is all the player has been told so far.
  describeDoorDestination(areaId: string, doorId: string): string | null {
    const door = this.getArea(areaId).doors.find((candidate) => candidate.id === doorId);
    if (!door?.targetAreaId) return null;
    return this.areas.get(door.targetAreaId)?.name ?? door.label;
  }

  private ensureArea(locationId: string): Area {
    if (!this.isLocationOpen(locationId)) throw new Error(`Location "${locationId}" is not open yet.`);
    return this.areas.get(locationId) ?? this.buildArea(locationId);
  }

  // Builds the area from the pack and leaves out the things the player has already picked up.
  private buildArea(locationId: string): Area {
    const { area: built, brief } = buildPackArea(this.pack, this.view, locationId);
    let area: Area = {
      ...built,
      entities: built.entities?.filter((entity) => !this.state.collectedEntities.includes(entity.id)),
    };
    let areaBrief = brief;
    if (this.inEpilogue && locationId === this.epilogue?.location) ({ area, brief: areaBrief } = this.epilogueArea(area, brief));
    this.areas.set(locationId, area);
    this.briefsByArea.set(locationId, areaBrief);
    return area;
  }

  // The epilogue location with its usual people and items replaced by the people of the ending.
  private epilogueArea(area: Area, brief: StoryAreaBrief): { area: Area; brief: StoryAreaBrief } {
    const present = this.epilogueCast().flatMap((entry) => {
      const member = this.pack.cast.find((candidate) => candidate.id === entry.id);
      return member ? [{ entry, member }] : [];
    });
    const characters: BriefCharacter[] = present.map(({ member }) => ({
      castId: member.id,
      name: member.name,
      species: member.species,
      personality: member.personality,
      goal: member.goal,
      secret: "",
      recipe: recipeFromSprite(member.sprite, member.id),
      sprite: member.sprite,
      required: true,
    }));
    const people: AreaEntity[] = present.map(({ entry, member }, index) => ({
      id: `char:${member.id}`, kind: "character", x: entry.at[0], y: entry.at[1], required: true, packId: member.id,
      name: member.name, description: member.personality, character: characters[index]!.recipe, sprite: member.sprite,
    }));
    const entities = [...(area.entities ?? []).filter((entity) => entity.kind === "object"), ...people];
    return {
      area: { ...area, entities, spawnPoints: entities.map(({ id, kind, x, y }) => ({ id, kind, x, y })) },
      brief: { ...brief, description: this.epilogue?.description ?? brief.description, characters },
    };
  }

  private onEntered(area: Area): void {
    markVisited(this.state, area.id);
    if (summaryDue(this.state) && !this.summaryRunning) {
      this.summaryRunning = true;
      void refreshSummary(this.client, this.pack, this.view, this.state).finally(() => { this.summaryRunning = false; });
    }
  }

  private openBeatCount(): number {
    let open = 1;
    while (open < this.view.beats.length && isRequirementMet(this.view.beats[open - 1]?.must_find, this.state)) open += 1;
    return open;
  }

  private endingFactsMet(ending: Ending): boolean {
    return ending.conditions.truths.every((id) => this.state.truthsFound.includes(id))
      && ending.conditions.goal_states.every((id) => this.state.resolvedGoalStates.includes(id));
  }
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function endingSpecificity(ending: Ending): number {
  return ending.conditions.truths.length + ending.conditions.goal_states.length + ending.conditions.choices.length;
}

import type { LLMClient } from "../llm/client";
import type { Area, AreaEntity, GridPoint } from "../world/types";
import { doorSpawn } from "../world/session";
import { buildStoryArea } from "./briefToMap";
import type { StoryAreaBrief } from "./briefs";
import type { LengthView } from "./loader";
import { BriefService } from "./prefetch";
import { findDoorLock, isRequirementMet, missingRequirementNames } from "./requirements";
import { endingChoiceLabel, writeEnding } from "./ending";
import type { EndingChoice, EndingScene } from "./ending";
import { createStoryState, giveItem, grantTruthsFromFoundClues, markClueFound, markCollected, markVisited, summaryDue } from "./state";
import type { StoryState } from "./state";
import { refreshSummary } from "./summary";
import type { CastMember, Ending, Item, StoryPack } from "./types";
import type { GameSave, SavedArea } from "../save/types";

export interface CollectResult {
  item: Item;
  given: boolean; // false when the item was already held (a repeat pickup changes nothing)
  blocked: boolean;
}

export interface StoryTransition {
  area: Area;
  spawn: GridPoint;
  arrivedFromFog: boolean; // the brief was not ready, so the player waited in the fog
}

// Runtime glue: pack + length + LLM client -> areas the player can walk through.
export class StorySession {
  readonly state: StoryState;
  readonly briefs: BriefService;
  private readonly areas = new Map<string, Area>();
  private readonly briefsByArea = new Map<string, StoryAreaBrief>();
  private summaryRunning = false;

  constructor(
    readonly pack: StoryPack,
    readonly view: LengthView,
    readonly client: LLMClient,
    prefetchCap?: number,
    readonly worldSeed = `${pack.identity.id}:${pack.identity.version}`,
  ) {
    this.state = createStoryState(view);
    this.briefs = new BriefService(client, pack, view, this.state, prefetchCap);
  }

  get startLocationId(): string {
    return this.view.startLocation;
  }

  getArea(areaId: string): Area {
    const area = this.areas.get(areaId);
    if (!area) throw new Error(`Area "${areaId}" has not been visited.`);
    return area;
  }

  getBrief(areaId: string): StoryAreaBrief | undefined {
    return this.briefsByArea.get(areaId);
  }

  getSavedAreas(): SavedArea[] {
    return [...this.areas].map(([areaId, area]) => {
      const brief = this.briefsByArea.get(areaId);
      if (!brief) throw new Error(`Area "${areaId}" has no story brief to save.`);
      return { area, brief };
    });
  }

  restoreSave(save: GameSave): void {
    if (save.packId !== this.pack.identity.id || save.packVersion !== this.pack.identity.version
      || save.length !== this.view.length || save.worldSeed !== this.worldSeed) {
      throw new Error("The save does not match this story session.");
    }
    Object.assign(this.state, save.storyState);
    this.areas.clear();
    this.briefsByArea.clear();
    for (const savedArea of save.areas) {
      this.areas.set(savedArea.area.id, savedArea.area);
      if (savedArea.brief) this.briefsByArea.set(savedArea.area.id, savedArea.brief);
    }
  }

  isReady(locationId: string): boolean {
    return this.isLocationOpen(locationId) && (this.areas.has(locationId) || this.briefs.isReady(locationId));
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
    return writeEnding(this.client, this.pack, ending);
  }

  getAvailableCharacterClues(characterId: string): { id: string; text: string }[] {
    if (!this.view.definition.cast.includes(characterId)) return [];
    return this.pack.clues
      .filter((clue) => {
        const availableHere = [clue.where, ...clue.alternatives].some(
          (source) => source.type === "character" && source.id === characterId,
        );
        if (!availableHere || this.state.cluesFound.includes(clue.id)) return false;
        return isRequirementMet(clue.requirements, this.state);
      })
      .map((clue) => ({ id: clue.id, text: clue.text }));
  }

  // Builds (once) and returns the start area.
  async start(): Promise<Area> {
    const area = await this.ensureArea(this.startLocationId);
    this.onEntered(area);
    return area;
  }

  async enterDoor(fromAreaId: string, doorId: string): Promise<StoryTransition> {
    const door = this.getArea(fromAreaId).doors.find((candidate) => candidate.id === doorId);
    if (!door?.targetAreaId) throw new Error(`Area "${fromAreaId}" has no usable door "${doorId}".`);
    if (this.isDoorLocked(fromAreaId, doorId)) {
      throw new Error(this.describeDoorLock(fromAreaId, doorId) ?? "That path is not open yet.");
    }
    const wasReady = this.isReady(door.targetAreaId);
    const area = await this.ensureArea(door.targetAreaId);
    const returnDoor = area.doors.find((candidate) => candidate.targetAreaId === fromAreaId);
    const spawn = returnDoor ? doorSpawn(area, returnDoor) : area.entry;
    this.onEntered(area);
    return { area, spawn, arrivedFromFog: !wasReady };
  }

  // Examining a clue spot records its truth. Returns the clue text, or null if the entity is not a clue.
  examineClue(entity: AreaEntity): string | null {
    if (entity.kind !== "clue") return null;
    const clue = this.pack.clues.find((candidate) => candidate.id === entity.packId);
    if (clue) {
      if (!isRequirementMet(clue.requirements, this.state)) {
        return "This little detail can wait until the story has unfolded a bit more.";
      }
      markClueFound(this.state, clue.id);
      grantTruthsFromFoundClues(this.pack, this.state);
    }
    return entity.description;
  }

  // The pack core for a character entity, or undefined for a minor LLM-invented extra (no core, no dialogue).
  getCharacter(entity: AreaEntity): CastMember | undefined {
    if (entity.kind !== "character" || !entity.packId) return undefined;
    return this.pack.cast.find((member) => member.id === entity.packId);
  }

  // Picking up a key item. Safe to call again on the same entity: a second pickup never duplicates the item.
  collectItem(entity: AreaEntity): CollectResult | null {
    if (entity.kind !== "key" || !entity.packId) return null;
    const item = this.pack.items.find((candidate) => candidate.id === entity.packId);
    if (!item) return null;
    if (!isRequirementMet(item.found_requires, this.state)) return { item, given: false, blocked: true };
    markCollected(this.state, entity.id);
    return { item, given: giveItem(this.state, item.id), blocked: false };
  }

  isDoorLocked(areaId: string, doorId: string): boolean {
    const door = this.getArea(areaId).doors.find((candidate) => candidate.id === doorId);
    if (!door?.targetAreaId) return false;
    return !this.isLocationOpen(door.targetAreaId)
      || !isRequirementMet(findDoorLock(this.pack, areaId, door.targetAreaId), this.state);
  }

  // A short "you need..." message for a locked door, or null if it is not locked.
  describeDoorLock(areaId: string, doorId: string): string | null {
    const door = this.getArea(areaId).doors.find((candidate) => candidate.id === doorId);
    if (!door?.targetAreaId) return null;
    if (!this.isLocationOpen(door.targetAreaId)) {
      return "This path will open once the current part of the story has settled. Keep exploring nearby for another clue or a neighbor who could use a hand.";
    }
    const lock = findDoorLock(this.pack, areaId, door.targetAreaId);
    if (isRequirementMet(lock, this.state)) return null;
    const missing = missingRequirementNames(this.pack, lock, this.state);
    return missing.length > 0 ? `It's locked. You need: ${missing.join(", ")}.` : "It's locked.";
  }

  private async ensureArea(locationId: string): Promise<Area> {
    if (!this.isLocationOpen(locationId)) throw new Error(`Location "${locationId}" is not open yet.`);
    const existing = this.areas.get(locationId);
    if (existing) return existing;
    const brief = await this.briefs.request(locationId);
    const area = buildStoryArea(brief, this.worldSeed);
    this.areas.set(locationId, area);
    this.briefsByArea.set(locationId, brief);
    return area;
  }

  private onEntered(area: Area): void {
    markVisited(this.state, area.id);
    const neighbours = area.doors.map((door) => door.targetAreaId).filter((id): id is string => id !== undefined);
    this.briefs.prefetch(neighbours.filter((id) => this.isLocationOpen(id) && !this.areas.has(id)));
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

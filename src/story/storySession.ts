import type { LLMClient } from "../llm/client";
import type { Area, AreaEntity, GridPoint } from "../world/types";
import { buildPackArea, doorSpawn, type BriefCharacter, type StoryAreaBrief } from "./packArea";
import type { LengthView } from "./loader";
import { findDoorLock, isRequirementMet } from "./requirements";
import { beatLockKey, clueLockKey, derivedUnlockLine, describeMissing, doorLockKey, lockKeyBody, lockKeyKind, lockNotesFor } from "./locks";
import { endingChoiceLabel, writeEnding } from "./ending";
import { pickSummation, type SummationQuestion } from "./deduction";
import type { EndingChoice, EndingScene } from "./ending";
import { caseRecordOf, createStoryState, giveItem, grantTruthsFromFoundClues, leadsOf, markClueFound, markCollected, markVisited, rememberLead, summaryDue } from "./state";
import type { StoryState } from "./state";
import { refreshSummary } from "./summary";
import { statementForClue } from "./statements";
import { caseResult, endingVariant } from "./caseRecord";
import { layoutStoryWorld, type LocationCell, type StoryWorldLayout } from "./worldLayout";
import type { Beat, CastMember, Clue, DoorLock, Ending, Epilogue, EpilogueCast, Item, StoryPack } from "./types";
import { recipeFromSprite } from "./recipes";
import type { GameSave } from "../save/types";

export interface CollectResult {
  item: Item;
  given: boolean; // false when the item was already held (a repeat pickup changes nothing)
  blocked: boolean;
}

// What the journal's Leads section shows for one lock the player has run into (the journal draws it).
export interface JournalLead {
  title: string;
  reason: string;
  lead?: string;
  resolved?: string; // what opened it, once it is open
}

export interface StoryUnlock {
  key: string; // the lock key (src/story/locks.ts)
  text: string;
  newArea?: string; // name of a place the player has not been to that this opened
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
  // Lock keys that were shut when last looked at; whatever is no longer shut has just opened (takeUnlocks).
  private lockedSnapshot = new Set<string>();
  // The place the player was trying to reach when they ran into a door lock (doors only), so "the way into X" names
  // the right side of a door that works both ways. Not saved: after a reload it is rebuilt from the places not yet
  // visited. Beat gates never use it; their target is derived (beatTarget), so it is the same after a reload.
  private readonly lockTargets = new Map<string, string>();

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
    delete this.state.leadsSeen; // a save without leads must not keep the ones from before
    Object.assign(this.state, save.storyState);
    this.lockTargets.clear();
    this.areas.clear();
    this.briefsByArea.clear();
    for (const areaId of save.areaIds) {
      if (!this.view.locations.some((location) => location.id === areaId)) continue;
      this.buildArea(areaId);
    }
    this.lockedSnapshot = this.currentLocked();
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
    this.lockedSnapshot = this.currentLocked();
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

  // Examining an object records the clues anchored to it whose requirements are met and returns their text. When
  // only gated clues are left it returns a glimpse that says why they are out of reach (and notes the lead). Null
  // when the object has no clue left to find (it then reads as plain scenery).
  examineClues(entity: AreaEntity): { kind: "found" | "glimpse"; text: string } | null {
    if (!this.hasOpenClues(entity)) return null;
    const texts: string[] = [];
    let gated: Clue | undefined;
    for (const id of entity.clueIds ?? []) {
      const clue = this.pack.clues.find((candidate) => candidate.id === id);
      if (!clue || this.state.cluesFound.includes(id)) continue;
      if (!isRequirementMet(clue.requirements, this.state)) {
        gated ??= clue;
        continue;
      }
      markClueFound(this.state, clue.id);
      texts.push(clue.text);
    }
    if (texts.length === 0) {
      if (!gated) return null;
      this.noteLead(clueLockKey(gated.id));
      const text = gated.locked_glimpse
        ?? `${entity.name}. ${describeMissing(this.pack, this.state, gated.requirements).line}`;
      return { kind: "glimpse", text };
    }
    grantTruthsFromFoundClues(this.pack, this.state);
    return { kind: "found", text: texts.join(" ") };
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

  // Why a door is shut, in the story's own words, or null if it is not locked.
  describeDoorLock(areaId: string, doorId: string): string | null {
    const door = this.getArea(areaId).doors.find((candidate) => candidate.id === doorId);
    if (!door?.targetAreaId) return null;
    if (this.inEpilogue) return this.epilogue?.door_message ?? "The story has ended.";
    if (!this.isLocationOpen(door.targetAreaId)) return this.describeBeatGate(door.targetAreaId);
    const lock = findDoorLock(this.pack, areaId, door.targetAreaId);
    if (isRequirementMet(lock, this.state)) return null;
    return lock?.reason ?? `Locked. ${describeMissing(this.pack, this.state, lock).line}`;
  }

  // The same reason in a few words, for places with little room such as the map. Null when the door is open.
  describeDoorLockBriefly(areaId: string, doorId: string): string | null {
    const door = this.getArea(areaId).doors.find((candidate) => candidate.id === doorId);
    if (!door?.targetAreaId) return null;
    if (this.inEpilogue) return "The story has ended";
    if (!this.isLocationOpen(door.targetAreaId)) return describeMissing(this.pack, this.state, this.currentBeat.must_find).brief;
    const lock = findDoorLock(this.pack, areaId, door.targetAreaId);
    if (isRequirementMet(lock, this.state)) return null;
    return describeMissing(this.pack, this.state, lock).brief;
  }

  // Why a place stays shut before its beat opens: the beat's own gate_reason, else the open beat's objective.
  private describeBeatGate(locationId: string): string {
    const gated = this.view.beats.find((beat) => beat.locations.includes(locationId));
    if (gated?.gate_reason) return gated.gate_reason;
    const current = this.currentBeat;
    const missing = describeMissing(this.pack, this.state, current.must_find);
    return `Not yet. ${current.objective ?? current.title}${missing.vague ? "" : ` ${missing.line}`}`;
  }

  // Notes that this door is locked, so the journal's Leads can list it. Safe to call repeatedly.
  recordDoorLead(areaId: string, doorId: string, fromMap = false): void {
    if (this.inEpilogue) return;
    const door = this.areas.get(areaId)?.doors.find((candidate) => candidate.id === doorId);
    if (!door?.targetAreaId) return;
    const key = this.lockKeyForDoor(areaId, door.targetAreaId);
    if (!key) return;
    this.noteLead(key);
    // Bumping into the door says which side the player wants; the map does not, so it never overrides.
    if (lockKeyKind(key) === "door" && (!fromMap || !this.lockTargets.has(key))) this.lockTargets.set(key, door.targetAreaId);
  }

  // Opening the map notes every locked exit of the places the player has been to.
  recordMapLeads(): void {
    for (const area of this.areas.values()) {
      if (!this.state.visitedAreas.includes(area.id)) continue;
      for (const door of area.doors) this.recordDoorLead(area.id, door.id, true);
    }
  }

  // The locks the player has run into, open ones first and opened ones (with what opened them) after.
  leads(): JournalLead[] {
    const open: JournalLead[] = [];
    const resolved: JournalLead[] = [];
    for (const key of leadsOf(this.state)) {
      const lead = this.leadFor(key);
      if (lead) (lead.resolved === undefined ? open : resolved).push(lead);
    }
    return [...open, ...resolved];
  }

  // Announcements for locks that opened since the last call. Each opening is announced once.
  takeUnlocks(): StoryUnlock[] {
    const current = this.currentLocked();
    const opened = [...this.lockedSnapshot].filter((key) => !current.has(key));
    this.lockedSnapshot = current;
    if (this.inEpilogue) return [];
    return opened.flatMap((key) => {
      const unlock = this.unlockFor(key);
      return unlock ? [unlock] : [];
    });
  }

  lockNotesFor(characterId: string): string[] {
    return lockNotesFor(this.pack, this.view, this.state, characterId, (id) => this.isLocationOpen(id));
  }

  // Why the player cannot take an item yet.
  describeItemBlock(item: Item): string {
    const missing = describeMissing(this.pack, this.state, item.found_requires);
    return `You cannot take the ${item.name} yet. ${missing.line}`;
  }

  // Remembers a lock for the journal and starts watching it, so its opening is announced even if it happens at once.
  private noteLead(key: string): void {
    rememberLead(this.state, key);
    this.lockedSnapshot.add(key);
  }

  // The lock key that currently shuts this door: its beat, else its own lock. Null when it is open.
  private lockKeyForDoor(areaId: string, targetId: string): string | null {
    if (!this.isLocationOpen(targetId)) {
      const beat = this.view.beats.find((candidate) => candidate.locations.includes(targetId));
      return beat ? beatLockKey(beat.id) : null;
    }
    const lock = findDoorLock(this.pack, areaId, targetId);
    return lock && !isRequirementMet(lock, this.state) ? doorLockKey(areaId, targetId) : null;
  }

  private isKeyLocked(key: string): boolean {
    if (lockKeyKind(key) === "beat") {
      const index = this.view.beats.findIndex((beat) => beat.id === lockKeyBody(key));
      return index >= this.openBeatCount();
    }
    if (lockKeyKind(key) === "clue") {
      const clue = this.pack.clues.find((candidate) => candidate.id === lockKeyBody(key));
      return clue !== undefined && !this.state.cluesFound.includes(clue.id) && !isRequirementMet(clue.requirements, this.state);
    }
    const [a, b] = lockKeyBody(key).split("|");
    return a !== undefined && b !== undefined && !isRequirementMet(findDoorLock(this.pack, a, b), this.state);
  }

  // Keys of what is shut right now and worth watching: exits of visited places, locks the player ran into, and
  // spoken clues of people already met.
  private currentLocked(): Set<string> {
    const locked = new Set<string>();
    if (this.inEpilogue) return locked;
    for (const area of this.areas.values()) {
      if (!this.state.visitedAreas.includes(area.id)) continue;
      for (const door of area.doors) {
        if (!door.targetAreaId) continue;
        const key = this.lockKeyForDoor(area.id, door.targetAreaId);
        if (!key) continue;
        locked.add(key);
        if (lockKeyKind(key) === "door" && !this.lockTargets.has(key) && !this.state.visitedAreas.includes(door.targetAreaId)) {
          this.lockTargets.set(key, door.targetAreaId);
        }
      }
    }
    for (const key of leadsOf(this.state)) {
      if (this.isKeyLocked(key)) locked.add(key);
    }
    for (const clue of this.pack.clues) {
      if (clue.kind !== "spoken" || clue.where.type !== "character") continue;
      if ((this.state.characterMemory[clue.where.id]?.visits ?? 0) === 0) continue;
      const key = clueLockKey(clue.id);
      if (this.isKeyLocked(key)) locked.add(key);
    }
    return locked;
  }

  private placeNames(ids: readonly string[]): string[] {
    return ids.map((id) => this.pack.locations.find((location) => location.id === id)?.name ?? id);
  }

  private objectOf(clue: Clue): { name: string } | undefined {
    return this.pack.locations.flatMap((location) => location.objects).find((candidate) => candidate.id === clue.object_id);
  }

  private unlockFor(key: string): StoryUnlock | null {
    if (lockKeyKind(key) === "beat") {
      const beat = this.view.beats.find((candidate) => candidate.id === lockKeyBody(key));
      if (!beat) return null;
      return { key, text: beat.unlock_text ?? `New places are open: ${this.placeNames(beat.locations).join(", ")}.` };
    }
    if (lockKeyKind(key) === "clue") {
      const clue = this.pack.clues.find((candidate) => candidate.id === lockKeyBody(key));
      if (!clue) return null;
      return { key, text: clue.reveal_text ?? this.derivedClueReveal(clue) };
    }
    const [a, b] = lockKeyBody(key).split("|");
    if (a === undefined || b === undefined) return null;
    const found = this.lockedDoor(key, a, b);
    if (!found) return null;
    const [targetName] = this.placeNames([found.target]);
    const text = found.lock.unlock_text ?? derivedUnlockLine(this.pack, found.lock, targetName ?? found.target);
    const unvisited = [a, b].find((id) => !this.state.visitedAreas.includes(id));
    return { key, text, ...(unvisited ? { newArea: this.placeNames([unvisited])[0] ?? unvisited } : {}) };
  }

  private derivedClueReveal(clue: Clue): string {
    const object = this.objectOf(clue);
    if (object) return `Something new to look at: ${object.name}.`;
    const speaker = clue.where.type === "character" ? this.pack.cast.find((member) => member.id === clue.where.id) : undefined;
    return speaker ? `${speaker.name} may have something new to tell you.` : "Something new is worth a look.";
  }

  // The lock between two locations and the side the player is trying to reach: the one they bumped into, else the
  // one they have not visited, else the door's own target.
  private lockedDoor(key: string, a: string, b: string): { lock: DoorLock; target: string } | undefined {
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const lock = this.pack.locations.find((location) => location.id === from)?.doors.find((door) => door.to === to)?.lock;
      if (!lock) continue;
      const remembered = this.lockTargets.get(key);
      if (remembered === a || remembered === b) return { lock, target: remembered };
      const unvisited = [a, b].filter((id) => !this.state.visitedAreas.includes(id));
      return { lock, target: unvisited.length === 1 ? unvisited[0]! : to };
    }
    return undefined;
  }

  private leadFor(key: string): JournalLead | null {
    const unlock = this.unlockFor(key);
    if (!unlock) return null;
    const resolved = this.isKeyLocked(key) ? {} : { resolved: unlock.text };
    if (lockKeyKind(key) === "beat") {
      const beat = this.view.beats.find((candidate) => candidate.id === lockKeyBody(key));
      if (!beat) return null;
      // Named after the first place behind the gate that the player can see a door to; neutral, so it still reads
      // right once the way is open. Derived from visited places only, so it survives a reload unchanged.
      const target = this.beatTarget(beat);
      const name = target === undefined ? "somewhere new" : this.placeNames([target])[0];
      return { title: `The way into ${name}`, reason: beat.gate_reason ?? this.beatReason(beat), ...resolved };
    }
    if (lockKeyKind(key) === "clue") {
      const clue = this.pack.clues.find((candidate) => candidate.id === lockKeyBody(key));
      if (!clue) return null;
      const object = this.objectOf(clue);
      const reason = clue.locked_glimpse
        ?? `${object ? `${object.name}. ` : ""}${describeMissing(this.pack, this.state, clue.requirements).line}`;
      return { title: object?.name ?? "Something out of reach", reason, ...resolved };
    }
    const [a, b] = lockKeyBody(key).split("|");
    const found = a !== undefined && b !== undefined ? this.lockedDoor(key, a, b) : undefined;
    if (!found) return null;
    return {
      title: `The way into ${this.placeNames([found.target])[0] ?? found.target}`,
      reason: found.lock.reason ?? `Locked. ${describeMissing(this.pack, this.state, found.lock).line}`,
      ...(found.lock.lead ? { lead: found.lock.lead } : {}),
      ...resolved,
    };
  }

  // The place of a gated beat to name: the first (in beat order) that a visited area has a door to.
  private beatTarget(beat: Beat): string | undefined {
    const seen = new Set<string>();
    for (const area of this.areas.values()) {
      if (!this.state.visitedAreas.includes(area.id)) continue;
      for (const door of area.doors) if (door.targetAreaId) seen.add(door.targetAreaId);
    }
    return beat.locations.find((id) => seen.has(id)) ?? beat.locations[0];
  }

  private beatReason(beat: Beat): string {
    const previous = this.view.beats[this.view.beats.indexOf(beat) - 1];
    if (!previous) return "Not yet.";
    const missing = describeMissing(this.pack, this.state, previous.must_find);
    return `Not yet. ${previous.objective ?? previous.title}${missing.vague ? "" : ` ${missing.line}`}`;
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
    // New exits start being watched; locks that opened but were not announced yet stay in the snapshot.
    for (const key of this.currentLocked()) this.lockedSnapshot.add(key);
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

import { LENGTH_IDS } from "../story/types";
import type { LengthId } from "../story/types";
import type { GameSave, SaveMetadata } from "./types";
import { SAVE_FORMAT_VERSION } from "./types";

const DATABASE_NAME = "cozy-mystery-saves";
const STORE_NAME = "saves";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCharacterMemory(value: unknown): boolean {
  return isRecord(value) && Number.isInteger(value.visits) && Number(value.visits) >= 0 && isStringArray(value.askedAbout);
}

function isStoryState(value: unknown): value is JsonRecord & {
  packId: string;
  packVersion: number;
  length: LengthId;
} {
  if (!isRecord(value)) return false;
  const arrays = [
    value.visitedAreas, value.truthsFound, value.cluesFound, value.resolvedGoalStates,
    value.choicesMade, value.itemsHeld, value.knowledgeTold, value.collectedEntities,
    value.truthsReady, value.herringsRuledOut, value.twistsSeen,
  ];
  return typeof value.packId === "string" && Number.isInteger(value.packVersion)
    && LENGTH_IDS.includes(value.length as (typeof LENGTH_IDS)[number])
    && arrays.every(isStringArray)
    && Array.isArray(value.needsRecorded)
    && value.needsRecorded.every((need) => isRecord(need)
      && typeof need.characterId === "string" && typeof need.itemId === "string")
    && typeof value.summary === "string"
    && isRecord(value.characterMemory)
    && Object.values(value.characterMemory).every(isCharacterMemory)
    && Number.isInteger(value.areasSinceSummary)
    && isStringArray(value.statementsHeard)
    && isCaseRecord(value.caseRecord)
    // The progress log arrived after version 6 and is optional, so older saves load without it.
    && (value.progressLog === undefined || (Array.isArray(value.progressLog) && value.progressLog.every((entry) =>
      isRecord(entry) && typeof entry.id === "string" && ["clue", "truth", "item"].includes(String(entry.kind))
      && Number.isFinite(entry.at))))
    // Leads (explained locks) arrived later too and are optional.
    && (value.leadsSeen === undefined || isStringArray(value.leadsSeen));
}

function isEvidence(value: unknown): boolean {
  return isRecord(value) && (value.type === "item" || value.type === "clue") && typeof value.id === "string";
}

// The case record as saved in format 7: every final answer and challenge, without outcomes or evidence.
function isCaseRecordV7(value: unknown): boolean {
  return isRecord(value)
    && Array.isArray(value.deductions) && value.deductions.every((entry) => isRecord(entry)
      && typeof entry.truthId === "string" && typeof entry.answer === "string" && typeof entry.correct === "boolean")
    && Array.isArray(value.summation) && value.summation.every((entry) => isRecord(entry)
      && typeof entry.truthId === "string" && typeof entry.answerId === "string" && typeof entry.correct === "boolean")
    && Array.isArray(value.challenges) && value.challenges.every((entry) => isRecord(entry)
      && typeof entry.statementId === "string" && isEvidence(entry.evidence) && typeof entry.fits === "boolean")
    && typeof value.assisted === "boolean";
}

const ANSWER_OUTCOMES = ["proven", "unproven", "misread", "wrong"];

function hasOutcomeAndEvidence(entry: unknown): boolean {
  return isRecord(entry) && ANSWER_OUTCOMES.includes(String(entry.outcome))
    && Array.isArray(entry.evidence) && entry.evidence.every(isEvidence);
}

// The case record (format 8): every final answer with how it turned out and what was shown, and every challenge.
function isCaseRecord(value: unknown): boolean {
  return isCaseRecordV7(value) && isRecord(value)
    && (value.deductions as unknown[]).every(hasOutcomeAndEvidence)
    && (value.summation as unknown[]).every(hasOutcomeAndEvidence);
}

function isSaveMetadata(value: unknown): value is SaveMetadata {
  return isRecord(value) && typeof value.storyTitle === "string"
    && LENGTH_IDS.includes(value.length as (typeof LENGTH_IDS)[number])
    && Number.isFinite(value.timePlayedMs) && Number(value.timePlayedMs) >= 0
    && typeof value.lastSaved === "string";
}

function isValidSave(value: unknown): value is GameSave {
  if (!isRecord(value)) return false;
  const player = value.player;
  const state = value.storyState;
  const areaIds = value.areaIds;
  if (value.formatVersion !== SAVE_FORMAT_VERSION
    || typeof value.slotId !== "string" || value.slotId.length === 0
    || !isSaveMetadata(value.metadata) || typeof value.worldSeed !== "string"
    || typeof value.packId !== "string" || !Number.isInteger(value.packVersion)
    || !LENGTH_IDS.includes(value.length as (typeof LENGTH_IDS)[number])
    || !isStoryState(state) || !isStringArray(areaIds)
    || !isRecord(player) || typeof player.areaId !== "string"
    || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return false;
  return areaIds.includes(player.areaId)
    && state.packId === value.packId
    && state.packVersion === value.packVersion
    && state.length === value.length
    && value.metadata.length === value.length;
}

function migrateV1(value: JsonRecord): JsonRecord {
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  return {
    ...value,
    formatVersion: 2,
    metadata: {
      ...metadata,
      timePlayedMs: Number.isFinite(metadata.timePlayedMs) ? metadata.timePlayedMs : 0,
    },
  };
}

function migrateV2(value: JsonRecord): JsonRecord {
  const storyState = isRecord(value.storyState) ? value.storyState : {};
  return {
    ...value,
    formatVersion: 3,
    storyState: {
      ...storyState,
      needsRecorded: Array.isArray(storyState.needsRecorded) ? storyState.needsRecorded : [],
      knowledgeTold: isStringArray(storyState.knowledgeTold) ? storyState.knowledgeTold : [],
    },
  };
}

function migrateV3(value: JsonRecord): JsonRecord {
  const storyState = isRecord(value.storyState) ? value.storyState : {};
  return {
    ...value,
    formatVersion: 4,
    storyState: {
      ...storyState,
      truthsReady: isStringArray(storyState.truthsReady) ? storyState.truthsReady : [],
      herringsRuledOut: isStringArray(storyState.herringsRuledOut) ? storyState.herringsRuledOut : [],
      twistsSeen: isStringArray(storyState.twistsSeen) ? storyState.twistsSeen : [],
    },
  };
}

function migrateV4(value: JsonRecord): JsonRecord {
  const storyState = isRecord(value.storyState) ? value.storyState : {};
  // Characters the player already talked to count as met, with one visit and no topics.
  const memory: Record<string, unknown> = {};
  const told = isStringArray(storyState.knowledgeTold) ? storyState.knowledgeTold.map((key) => key.split(":")[0] ?? "") : [];
  const needs = Array.isArray(storyState.needsRecorded)
    ? storyState.needsRecorded.flatMap((need) => (isRecord(need) && typeof need.characterId === "string" ? [need.characterId] : []))
    : [];
  for (const characterId of [...told, ...needs]) {
    if (characterId) memory[characterId] = { visits: 1, askedAbout: [] };
  }
  return {
    ...value,
    formatVersion: 5,
    storyState: {
      ...storyState,
      characterMemory: isRecord(storyState.characterMemory) ? storyState.characterMemory : memory,
    },
  };
}

// Areas are rebuilt from the story pack now, so only which areas were visited is kept. Saved tiles and briefs are dropped.
function migrateV5(value: JsonRecord): JsonRecord {
  const { areas, ...rest } = value;
  const areaIds = Array.isArray(areas)
    ? areas.flatMap((entry) => {
      const area = isRecord(entry) && isRecord(entry.area) ? entry.area : undefined;
      return typeof area?.id === "string" ? [area.id] : [];
    })
    : [];
  return { ...rest, formatVersion: 6, areaIds };
}

// Statements and the case record arrive: older saves start with nothing heard and an empty record.
function migrateV6(value: JsonRecord): JsonRecord {
  const storyState = isRecord(value.storyState) ? value.storyState : {};
  return {
    ...value,
    formatVersion: 7,
    storyState: {
      ...storyState,
      statementsHeard: isStringArray(storyState.statementsHeard) ? storyState.statementsHeard : [],
      caseRecord: isCaseRecordV7(storyState.caseRecord)
        ? storyState.caseRecord
        : { deductions: [], summation: [], challenges: [], assisted: false },
    },
  };
}

// Answers get an outcome and the evidence shown: an old right answer counts as proven, with nothing shown.
function migrateV7(value: JsonRecord): JsonRecord {
  const storyState = isRecord(value.storyState) ? value.storyState : {};
  const upgrade = (entries: unknown): unknown => Array.isArray(entries)
    ? entries.map((entry) => (isRecord(entry) ? { ...entry, evidence: [], outcome: entry.correct === true ? "proven" : "wrong" } : entry))
    : entries;
  const record = isRecord(storyState.caseRecord) ? storyState.caseRecord : undefined;
  return {
    ...value,
    formatVersion: 8,
    storyState: record
      ? { ...storyState, caseRecord: { ...record, deductions: upgrade(record.deductions), summation: upgrade(record.summation) } }
      : storyState,
  };
}

export function normalizeSave(value: unknown): GameSave {
  if (!isRecord(value) || !Number.isInteger(value.formatVersion)) {
    throw new Error("This file is not a valid game save.");
  }
  let migrated: JsonRecord = value;
  if (migrated.formatVersion === 1) migrated = migrateV1(migrated);
  if (migrated.formatVersion === 2) migrated = migrateV2(migrated);
  if (migrated.formatVersion === 3) migrated = migrateV3(migrated);
  if (migrated.formatVersion === 4) migrated = migrateV4(migrated);
  if (migrated.formatVersion === 5) migrated = migrateV5(migrated);
  if (migrated.formatVersion === 6) migrated = migrateV6(migrated);
  if (migrated.formatVersion === 7) migrated = migrateV7(migrated);
  if (migrated.formatVersion !== SAVE_FORMAT_VERSION) {
    throw new Error(`Save format version ${String(value.formatVersion)} is not supported.`);
  }
  if (!isValidSave(migrated)) throw new Error("This file is not a valid game save or is missing required game data.");
  return migrated;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

export class SaveRepository {
  private database: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly databaseName = DATABASE_NAME,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: "slotId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open save storage."));
      request.onblocked = () => reject(new Error("Save storage is blocked by another open game tab."));
    });
    return this.database;
  }

  async list(): Promise<GameSave[]> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const records = await requestResult<unknown[]>(transaction.objectStore(STORE_NAME).getAll());
    await done;
    return records.map(normalizeSave).sort((a, b) => b.metadata.lastSaved.localeCompare(a.metadata.lastSaved));
  }

  async get(slotId: string): Promise<GameSave | undefined> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const record = await requestResult<unknown>(transaction.objectStore(STORE_NAME).get(slotId));
    await done;
    return record === undefined ? undefined : normalizeSave(record);
  }

  async save(value: unknown): Promise<GameSave> {
    const save = normalizeSave(value);
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    await requestResult(transaction.objectStore(STORE_NAME).put(save));
    await done;
    return save;
  }

  async remove(slotId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    await requestResult(transaction.objectStore(STORE_NAME).delete(slotId));
    await done;
  }

  async exportJson(slotId: string): Promise<string> {
    const save = await this.get(slotId);
    if (!save) throw new Error("That save slot no longer exists.");
    return JSON.stringify(save, null, 2);
  }

  async importJson(json: string): Promise<GameSave> {
    let value: unknown;
    try {
      value = JSON.parse(json) as unknown;
    } catch {
      throw new Error("The selected file is not valid JSON.");
    }
    return this.save(normalizeSave(value));
  }

  close(): void {
    void this.database?.then((database) => database.close());
    this.database = null;
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

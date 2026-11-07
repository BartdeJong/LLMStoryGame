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

function isTileLayer(value: unknown): value is number[][] {
  return Array.isArray(value) && value.every((row) =>
    Array.isArray(row) && row.every((tile) => Number.isInteger(tile) && tile >= 0 && tile <= 9));
}

function isBrief(value: unknown): value is JsonRecord & { locationId: string } {
  if (!isRecord(value) || typeof value.locationId !== "string" || typeof value.name !== "string"
    || typeof value.biome !== "string" || typeof value.mood !== "string"
    || typeof value.palette !== "string" || typeof value.description !== "string"
    || !Array.isArray(value.characters) || !Array.isArray(value.objects)
    || !Array.isArray(value.clues) || !Array.isArray(value.doors)
    || (value.source !== "llm" && value.source !== "fallback")) return false;
  return value.characters.every((character) => isRecord(character)
    && (character.castId === null || typeof character.castId === "string")
    && typeof character.name === "string" && typeof character.species === "string"
    && typeof character.personality === "string" && typeof character.goal === "string"
    && typeof character.secret === "string" && isRecord(character.recipe)
    && typeof character.required === "boolean")
    && value.objects.every((object) => isRecord(object)
      && (object.packId === null || typeof object.packId === "string")
      && typeof object.kind === "string" && typeof object.name === "string"
      && typeof object.description === "string" && isRecord(object.icon)
      && isStringArray(object.contents) && typeof object.required === "boolean"
      && typeof object.keyItem === "boolean")
    && value.clues.every((clue) => isRecord(clue) && typeof clue.id === "string"
      && (clue.truthId === null || typeof clue.truthId === "string")
      && typeof clue.where === "string" && typeof clue.text === "string")
    && value.doors.every((door) => isRecord(door) && typeof door.to === "string"
      && typeof door.label === "string" && typeof door.hint === "string");
}

function isArea(value: unknown): value is JsonRecord & { id: string } {
  const entry = isRecord(value) ? value.entry : undefined;
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string"
    || !("seed" in value) || typeof value.biome !== "string" || typeof value.mood !== "string"
    || typeof value.palette !== "string" || !Number.isInteger(value.width) || Number(value.width) <= 0
    || !Number.isInteger(value.height) || Number(value.height) <= 0
    || !isRecord(value.layers) || !isTileLayer(value.layers.ground) || !isTileLayer(value.layers.feature)
    || !isRecord(entry) || !Number.isFinite(entry.x) || !Number.isFinite(entry.y)
    || !Array.isArray(value.doors) || !Array.isArray(value.spawnPoints) || !Array.isArray(value.entities)) return false;
  const width = Number(value.width);
  const height = Number(value.height);
  const entryX = Number(entry.x);
  const entryY = Number(entry.y);
  return value.layers.ground.length === height && value.layers.feature.length === height
    && value.layers.ground.every((row) => row.length === width)
    && value.layers.feature.every((row) => row.length === width)
    && Number.isInteger(entryX) && Number.isInteger(entryY)
    && entryX >= 0 && entryX < width && entryY >= 0 && entryY < height
    && value.doors.every((door) => isRecord(door) && typeof door.id === "string"
      && typeof door.label === "string" && Number.isFinite(door.x) && Number.isFinite(door.y)
      && (door.targetAreaId === undefined || typeof door.targetAreaId === "string"))
    && value.spawnPoints.every((point) => isRecord(point) && typeof point.id === "string"
      && typeof point.kind === "string" && Number.isFinite(point.x) && Number.isFinite(point.y))
    && value.entities.every((entity) => isRecord(entity) && typeof entity.id === "string"
      && ["character", "object", "clue", "key"].includes(String(entity.kind)) && typeof entity.name === "string"
      && typeof entity.description === "string" && typeof entity.required === "boolean"
      && Number.isFinite(entity.x) && Number.isFinite(entity.y));
}

function isStoryState(value: unknown): value is JsonRecord & {
  packId: string;
  packVersion: number;
  length: LengthId;
} {
  if (!isRecord(value)) return false;
  const arrays = [
    value.visitedAreas, value.truthsFound, value.cluesFound, value.resolvedGoalStates,
    value.choicesMade, value.itemsHeld, value.collectedEntities,
  ];
  return typeof value.packId === "string" && Number.isInteger(value.packVersion)
    && LENGTH_IDS.includes(value.length as (typeof LENGTH_IDS)[number])
    && arrays.every(isStringArray) && typeof value.summary === "string"
    && Number.isInteger(value.areasSinceSummary);
}

type SavedAreaRecord = JsonRecord & {
  area: JsonRecord & { id: string };
  brief: JsonRecord & { locationId: string };
};

function isSavedArea(value: unknown): value is SavedAreaRecord {
  return isRecord(value) && isArea(value.area) && isBrief(value.brief)
    && typeof value.brief.locationId === "string"
    && value.area.id === value.brief.locationId;
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
  const areas = value.areas;
  if (value.formatVersion !== SAVE_FORMAT_VERSION
    || typeof value.slotId !== "string" || value.slotId.length === 0
    || !isSaveMetadata(value.metadata) || typeof value.worldSeed !== "string"
    || typeof value.packId !== "string" || !Number.isInteger(value.packVersion)
    || !LENGTH_IDS.includes(value.length as (typeof LENGTH_IDS)[number])
    || !isStoryState(state) || !Array.isArray(areas)
    || !isRecord(player) || typeof player.areaId !== "string"
    || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return false;
  if (!areas.every(isSavedArea)) return false;
  return areas.some((entry) => entry.area.id === player.areaId)
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

export function normalizeSave(value: unknown): GameSave {
  if (!isRecord(value) || !Number.isInteger(value.formatVersion)) {
    throw new Error("This file is not a valid game save.");
  }
  let migrated: JsonRecord = value;
  if (value.formatVersion === 1) migrated = migrateV1(value);
  else if (value.formatVersion !== SAVE_FORMAT_VERSION) {
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

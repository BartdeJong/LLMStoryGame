import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import { getLengthView } from "../story/loader";
import { storyMockRespond } from "../story/mockResponder";
import { StorySession } from "../story/storySession";
import { loadPackForSave, SavePackError } from "./pack";
import { normalizeSave, SaveRepository } from "./repository";
import type { GameSave } from "./types";
import { validateStoryPack } from "../story/validate";

const repositories: SaveRepository[] = [];

function makeSave(): GameSave {
  const storyState: GameSave["storyState"] = {
    packId: "test-story",
    packVersion: 3,
    length: "short",
    visitedAreas: ["start"],
    truthsFound: ["truth"],
    cluesFound: ["clue"],
    resolvedGoalStates: ["goal"],
    choicesMade: ["choice"],
    itemsHeld: ["key"],
    needsRecorded: [{ characterId: "c_oswin", itemId: "i_overdue_book" }],
    knowledgeTold: ["c_oswin:k_oswin_log"],
    collectedEntities: ["item:key"],
    summary: "A saved story.",
    areasSinceSummary: 1,
  };
  return {
    formatVersion: 3,
    slotId: "slot-test",
    metadata: {
      storyTitle: "Test story",
      length: "short",
      timePlayedMs: 120_000,
      lastSaved: "2026-01-02T03:04:05.000Z",
    },
    worldSeed: "test-story:3",
    packId: "test-story",
    packVersion: 3,
    length: "short",
    storyState,
    areas: [{
      area: {
        id: "start",
        seed: 12,
        name: "Meadow",
        biome: "meadow",
        mood: "calm",
        palette: "meadow",
        width: 1,
        height: 1,
        layers: { ground: [[0]], feature: [[0]] },
        entry: { x: 0, y: 0 },
        spawnPoints: [],
        doors: [],
        entities: [{
          id: "item:key",
          kind: "key",
          x: 0,
          y: 0,
          name: "Old key",
          description: "A small brass key.",
          required: true,
          packId: "key",
        }],
      },
      brief: {
        locationId: "start",
        name: "Meadow",
        biome: "meadow",
        mood: "calm",
        palette: "meadow",
        description: "The path begins here.",
        characters: [],
        objects: [],
        clues: [],
        doors: [],
        source: "fallback",
      },
    }],
    player: { areaId: "start", x: 18, y: 21 },
  };
}

function createRepository(): SaveRepository {
  const repository = new SaveRepository(indexedDB, `save-test-${crypto.randomUUID()}`);
  repositories.push(repository);
  return repository;
}

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
});

describe("save persistence", () => {
  it("saves and reloads the full game state unchanged", async () => {
    const repository = createRepository();
    const save = makeSave();
    await repository.save(save);

    await expect(repository.get(save.slotId)).resolves.toEqual(save);
  });

  it("exports a save to JSON and imports it into another repository", async () => {
    const source = createRepository();
    const destination = createRepository();
    const save = makeSave();
    await source.save(save);

    await destination.importJson(await source.exportJson(save.slotId));

    await expect(destination.get(save.slotId)).resolves.toEqual(save);
  });

  it("restores saved areas, briefs, progress, and player location into a story session", () => {
    const report = validateStoryPack(example);
    if (!report.pack) throw new Error("The example story fixture is invalid.");
    const pack = report.pack;
    const view = getLengthView(pack, "short");
    const original = makeSave();
    const areaId = view.startLocation;
    const save: GameSave = {
      ...original,
      worldSeed: "resume-seed",
      packId: pack.identity.id,
      packVersion: pack.identity.version,
      areas: original.areas.map(({ area, brief }) => ({
        area: { ...area, id: areaId },
        brief: { ...brief, locationId: areaId },
      })),
      storyState: {
        ...original.storyState,
        packId: pack.identity.id,
        packVersion: pack.identity.version,
        visitedAreas: [areaId],
      },
      player: { ...original.player, areaId },
    };
    const client = new LLMClient(new MockBackend({ respond: storyMockRespond }));
    const story = new StorySession(pack, view, client, undefined, save.worldSeed);

    story.restoreSave(save);

    expect(story.state).toEqual(save.storyState);
    expect(story.getSavedAreas()[0]?.area.entities).toEqual([]);
    expect(story.getArea(areaId).entities).toEqual([]);
    expect(story.getBrief(areaId)).toEqual(save.areas[0]?.brief);
  });

  it("migrates version 1 saves to the current format", async () => {
    const legacy = JSON.parse(JSON.stringify(makeSave())) as {
      formatVersion: number;
      metadata: Record<string, unknown>;
    };
    legacy.formatVersion = 1;
    delete legacy.metadata.timePlayedMs;

    const migrated = normalizeSave(legacy);

    expect(migrated.formatVersion).toBe(3);
    expect(migrated.metadata.timePlayedMs).toBe(0);
  });

  it("migrates version 2 saves with empty journal history", () => {
    const legacy = JSON.parse(JSON.stringify(makeSave())) as {
      formatVersion: number;
      storyState: Record<string, unknown>;
    };
    legacy.formatVersion = 2;
    delete legacy.storyState.needsRecorded;
    delete legacy.storyState.knowledgeTold;

    const migrated = normalizeSave(legacy);

    expect(migrated.formatVersion).toBe(3);
    expect(migrated.storyState.needsRecorded).toEqual([]);
    expect(migrated.storyState.knowledgeTold).toEqual([]);
  });

  it("rejects invalid imported files before storing them", async () => {
    const repository = createRepository();

    await expect(repository.importJson('{"formatVersion":2}')).rejects.toThrow("not a valid game save");
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("explains when a save's story pack is missing or changed", async () => {
    const save = makeSave();
    const report = validateStoryPack(example);
    if (!report.pack) throw new Error("The example story fixture is invalid.");
    const pack = report.pack;
    await expect(loadPackForSave(save, async () => {
      throw new Error("story file was not found");
    })).rejects.toThrow(SavePackError);
    await expect(loadPackForSave(save, async () => ({
      ...pack,
      identity: { ...pack.identity, version: 4 },
    }))).rejects.toThrow("version 4 is available");
  });
});

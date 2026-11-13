import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import { getLengthView } from "../story/loader";
import { bakeSimple } from "../story/fixtures/bakeSimple";
import { storyMockRespond } from "../story/mockResponder";
import { buildPackArea } from "../story/packArea";
import { StorySession } from "../story/storySession";
import { loadPackForSave, SavePackError } from "./pack";
import { normalizeSave, SaveRepository } from "./repository";
import { SAVE_FORMAT_VERSION, type GameSave } from "./types";
import type { StoryPack } from "../story/types";

const repositories: SaveRepository[] = [];

function makeSave(): GameSave {
  const storyState: GameSave["storyState"] = {
    packId: "test-story",
    packVersion: 3,
    length: "short",
    visitedAreas: ["start"],
    truthsFound: ["truth"],
    truthsReady: ["ready"],
    herringsRuledOut: ["herring"],
    twistsSeen: ["twist"],
    cluesFound: ["clue"],
    resolvedGoalStates: ["goal"],
    choicesMade: ["choice"],
    itemsHeld: ["key"],
    needsRecorded: [{ characterId: "c_oswin", itemId: "i_overdue_book" }],
    knowledgeTold: ["c_oswin:k_oswin_log"],
    characterMemory: {},
    collectedEntities: ["item:key"],
    summary: "A saved story.",
    areasSinceSummary: 1,
    statementsHeard: ["st_heard"],
    caseRecord: {
      deductions: [{ truthId: "truth", answer: "A guess", correct: false, outcome: "wrong", evidence: [] }],
      summation: [{ truthId: "truth", answerId: "truth", correct: true, outcome: "proven", evidence: [{ type: "clue", id: "clue" }] }],
      challenges: [{ statementId: "st_heard", evidence: { type: "item", id: "key" }, fits: false }],
      assisted: false,
    },
  };
  return {
    formatVersion: 8,
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
    areaIds: ["start"],
    player: { areaId: "start", x: 18, y: 21 },
  };
}

// What a version 5 save held for each visited area: the whole built area and its brief.
function legacyAreas(): unknown[] {
  return [{
    area: {
      id: "start", seed: 12, name: "Meadow", biome: "meadow", mood: "calm", palette: "meadow", width: 1, height: 1,
      layers: { ground: [[0]], feature: [[0]] }, entry: { x: 0, y: 0 }, spawnPoints: [], doors: [], entities: [],
    },
    brief: { locationId: "start", name: "Meadow", source: "fallback" },
  }];
}

function withLegacyAreas(save: object): void {
  const record = save as Record<string, unknown>;
  delete record.areaIds;
  record.areas = legacyAreas();
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

  it("rebuilds the visited areas from the pack and leaves out what was collected", () => {
    const pack = bakeSimple(example) as StoryPack;
    const view = getLengthView(pack, "short");
    const original = makeSave();
    const areaId = view.startLocation;
    const collected = "obj:o_notice_board";
    const save: GameSave = {
      ...original,
      worldSeed: "resume-seed",
      packId: pack.identity.id,
      packVersion: pack.identity.version,
      areaIds: [areaId, "l_bakery", "not_in_this_story"],
      storyState: {
        ...original.storyState,
        packId: pack.identity.id,
        packVersion: pack.identity.version,
        visitedAreas: [areaId],
        collectedEntities: [collected],
      },
      player: { ...original.player, areaId },
    };
    const client = new LLMClient(new MockBackend({ respond: storyMockRespond }));
    const story = new StorySession(pack, view, client, save.worldSeed);

    story.restoreSave(save);

    expect(story.state).toEqual(save.storyState);
    expect(story.getAreaIds()).toEqual([areaId, "l_bakery"]);
    // the notice board was collected, so the object that anchors the clue is gone too
    expect(story.getArea(areaId).entities?.map((entity) => entity.id)).toEqual([]);
    expect(story.getArea(areaId).layers).toEqual(buildPackArea(pack, view, areaId).area.layers);
    expect(story.getBrief(areaId)?.description).toBe(pack.locations[0]!.area!.description);
    expect(story.getArea("l_bakery").entities?.length).toBeGreaterThan(0);
  });

  it("migrates version 6 saves with nothing heard and an empty case record", () => {
    const legacy = JSON.parse(JSON.stringify(makeSave())) as { formatVersion: number; storyState: Record<string, unknown> };
    legacy.formatVersion = 6;
    delete legacy.storyState.statementsHeard;
    delete legacy.storyState.caseRecord;

    const migrated = normalizeSave(legacy);

    expect(migrated.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(migrated.storyState.statementsHeard).toEqual([]);
    expect(migrated.storyState.caseRecord).toEqual({ deductions: [], summation: [], challenges: [], assisted: false });
  });

  it("migrates version 7 saves: a right answer counts as proven, a wrong one as wrong, nothing shown", () => {
    const legacy = JSON.parse(JSON.stringify(makeSave())) as { formatVersion: number; storyState: { caseRecord: Record<string, unknown> } };
    legacy.formatVersion = 7;
    legacy.storyState.caseRecord = {
      deductions: [
        { truthId: "t_a", answer: "A", correct: true },
        { truthId: "t_b", answer: "B", correct: false },
      ],
      summation: [{ truthId: "t_c", answerId: "t_c", correct: true }],
      challenges: [{ statementId: "st_heard", evidence: { type: "item", id: "key" }, fits: true }],
      assisted: false,
    };

    const migrated = normalizeSave(legacy);

    expect(migrated.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(migrated.storyState.caseRecord).toEqual({
      deductions: [
        { truthId: "t_a", answer: "A", correct: true, outcome: "proven", evidence: [] },
        { truthId: "t_b", answer: "B", correct: false, outcome: "wrong", evidence: [] },
      ],
      summation: [{ truthId: "t_c", answerId: "t_c", correct: true, outcome: "proven", evidence: [] }],
      challenges: [{ statementId: "st_heard", evidence: { type: "item", id: "key" }, fits: true }],
      assisted: false,
    });
  });

  it("migrates version 6 saves with answers all the way to the current format", () => {
    const legacy = JSON.parse(JSON.stringify(makeSave())) as { formatVersion: number; storyState: { caseRecord: Record<string, unknown> } };
    legacy.formatVersion = 6;
    legacy.storyState.caseRecord = {
      deductions: [{ truthId: "t_a", answer: "A", correct: true }],
      summation: [],
      challenges: [],
      assisted: false,
    };
    const migrated = normalizeSave(legacy);
    expect(migrated.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(migrated.storyState.caseRecord?.deductions).toEqual([{ truthId: "t_a", answer: "A", correct: true, outcome: "proven", evidence: [] }]);
  });

  it("rejects a current save whose answers have a malformed outcome or evidence", () => {
    const bad = (patch: (record: { deductions: Record<string, unknown>[] }) => void): void => {
      const save = JSON.parse(JSON.stringify(makeSave())) as { storyState: { caseRecord: { deductions: Record<string, unknown>[] } } };
      patch(save.storyState.caseRecord);
      expect(() => normalizeSave(save)).toThrow("not a valid game save");
    };
    bad((record) => { record.deductions[0]!.outcome = "lucky"; });
    bad((record) => { delete record.deductions[0]!.outcome; });
    bad((record) => { record.deductions[0]!.evidence = [{ type: "person", id: "x" }]; });
    bad((record) => { delete record.deductions[0]!.evidence; });
  });

  it("rejects a current save whose case record is malformed", () => {
    const save = JSON.parse(JSON.stringify(makeSave())) as { storyState: Record<string, unknown> };
    save.storyState.caseRecord = { deductions: "nope" };
    expect(() => normalizeSave(save)).toThrow("not a valid game save");
  });

  it("migrates version 5 saves, keeping only which areas were visited", () => {
    const legacy = JSON.parse(JSON.stringify(makeSave())) as Record<string, unknown>;
    legacy.formatVersion = 5;
    delete legacy.areaIds;
    legacy.areas = legacyAreas();

    const migrated = normalizeSave(legacy);

    expect(migrated.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(migrated.areaIds).toEqual(["start"]);
    expect("areas" in migrated).toBe(false);
  });

  it("migrates version 1 saves to the current format", async () => {
    const legacy = JSON.parse(JSON.stringify(makeSave())) as {
      formatVersion: number;
      metadata: Record<string, unknown>;
    };
    legacy.formatVersion = 1;
    withLegacyAreas(legacy);
    delete legacy.metadata.timePlayedMs;

    const migrated = normalizeSave(legacy);

    expect(migrated.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(migrated.metadata.timePlayedMs).toBe(0);
  });

  it("migrates version 2 saves with empty journal history", () => {
    const legacy = JSON.parse(JSON.stringify(makeSave())) as {
      formatVersion: number;
      storyState: Record<string, unknown>;
    };
    legacy.formatVersion = 2;
    withLegacyAreas(legacy);
    delete legacy.storyState.needsRecorded;
    delete legacy.storyState.knowledgeTold;

    const migrated = normalizeSave(legacy);

    expect(migrated.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(migrated.storyState.needsRecorded).toEqual([]);
    expect(migrated.storyState.knowledgeTold).toEqual([]);
  });

  it("migrates version 3 saves with empty deduction history", () => {
    const legacy = JSON.parse(JSON.stringify(makeSave())) as {
      formatVersion: number;
      storyState: Record<string, unknown>;
    };
    legacy.formatVersion = 3;
    withLegacyAreas(legacy);
    delete legacy.storyState.truthsReady;
    delete legacy.storyState.herringsRuledOut;
    delete legacy.storyState.twistsSeen;

    const migrated = normalizeSave(legacy);

    expect(migrated.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(migrated.storyState.truthsFound).toEqual(["truth"]);
    expect(migrated.storyState.truthsReady).toEqual([]);
    expect(migrated.storyState.herringsRuledOut).toEqual([]);
    expect(migrated.storyState.twistsSeen).toEqual([]);
  });

  it("migrates version 4 saves, treating characters already talked to as met", () => {
    const legacy = JSON.parse(JSON.stringify(makeSave())) as {
      formatVersion: number;
      storyState: Record<string, unknown>;
    };
    legacy.formatVersion = 4;
    withLegacyAreas(legacy);
    delete legacy.storyState.characterMemory;

    const migrated = normalizeSave(legacy);

    expect(migrated.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(migrated.storyState.characterMemory).toEqual({ c_oswin: { visits: 1, askedAbout: [] } });
  });

  it("keeps character memory through a save and load round trip", () => {
    const save = makeSave();
    save.storyState.characterMemory = { c_oswin: { visits: 2, askedAbout: ["cast:c_hollis", "item:i_overdue_book"] } };
    const loaded = normalizeSave(JSON.parse(JSON.stringify(save)));
    expect(loaded.storyState.characterMemory).toEqual(save.storyState.characterMemory);
    expect(() => normalizeSave({ ...save, storyState: { ...save.storyState, characterMemory: { c_oswin: { visits: "x" } } } })).toThrow();
  });

  it("loads saves without a progress log and keeps one when present", () => {
    const save = makeSave();
    expect(save.storyState.progressLog).toBeUndefined();
    expect(normalizeSave(JSON.parse(JSON.stringify(save))).storyState.progressLog).toBeUndefined();
    save.storyState.progressLog = [{ kind: "clue", id: "clue", at: 5 }];
    expect(normalizeSave(JSON.parse(JSON.stringify(save))).storyState.progressLog).toEqual(save.storyState.progressLog);
    expect(() => normalizeSave({ ...save, storyState: { ...save.storyState, progressLog: [{ kind: "x" }] } })).toThrow();
  });

  it("rejects invalid imported files before storing them", async () => {
    const repository = createRepository();

    await expect(repository.importJson('{"formatVersion":2}')).rejects.toThrow("not a valid game save");
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("explains when a save's story pack is missing or changed", async () => {
    const save = makeSave();
    const pack = bakeSimple(example) as StoryPack;
    await expect(loadPackForSave(save, async () => {
      throw new Error("story file was not found");
    })).rejects.toThrow(SavePackError);
    await expect(loadPackForSave(save, async () => ({
      ...pack,
      identity: { ...pack.identity, version: 4 },
    }))).rejects.toThrow("version 4 is available");
  });
});

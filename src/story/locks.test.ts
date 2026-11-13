import { describe, expect, it } from "vitest";
import authoredExample from "../../public/stories/example.json";
import { stripLockText } from "./fixtures/stripLockText";
import paddington from "../../public/stories/paddingtonhat.json";
import schema from "../../tools/story-forge/schema/story-pack.schema.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import type { GameSave } from "../save/types";
import { checkSchema } from "./jsonSchema";
import { getLengthView } from "./loader";
import { beatLockKey, clueLockKey, derivedUnlockLine, describeMissing, doorLockKey, lockNotesFor } from "./locks";
import { storyMockRespond } from "./mockResponder";
import { createStoryState, giveItem } from "./state";
import { StorySession } from "./storySession";
import type { StoryPack } from "./types";
import { validateStoryPack } from "./validate";

const example = stripLockText(authoredExample);

function loadPack(data: unknown): StoryPack {
  const report = validateStoryPack(structuredClone(data));
  if (!report.pack) throw new Error(report.errors.map((issue) => issue.message).join("; "));
  return report.pack;
}

async function makeClient(): Promise<LLMClient> {
  const client = new LLMClient(new MockBackend({ respond: storyMockRespond }), { pauseWhenHidden: false });
  await client.load();
  return client;
}

async function newSession(pack: StoryPack): Promise<StorySession> {
  return new StorySession(pack, getLengthView(pack), await makeClient());
}

interface Progress {
  visited?: string[];
  truths?: string[];
  goalStates?: string[];
  items?: string[];
}

// A session that has already been to some places and has some progress, as a loaded save would give.
async function sessionWith(pack: StoryPack, progress: Progress): Promise<StorySession> {
  const first = await newSession(pack);
  first.start();
  const state = structuredClone(first.state);
  const visited = [...new Set([...state.visitedAreas, ...(progress.visited ?? [])])];
  Object.assign(state, {
    visitedAreas: visited,
    truthsFound: progress.truths ?? [],
    resolvedGoalStates: progress.goalStates ?? [],
    itemsHeld: progress.items ?? [],
  });
  const save = {
    packId: pack.identity.id,
    packVersion: pack.identity.version,
    length: first.view.length,
    worldSeed: first.worldSeed,
    storyState: state,
    areaIds: visited,
  } as GameSave;
  const loaded = await newSession(pack);
  loaded.restoreSave(save);
  return loaded;
}

describe("describeMissing", () => {
  const pack = loadPack(example);
  const state = () => createStoryState(getLengthView(pack));

  it("names the character who owns a missing goal state", () => {
    const found = describeMissing(loadPack(paddington), createStoryState(getLengthView(loadPack(paddington))), { goal_states: ["gs_gruber_cocoa"] });
    expect(found).toMatchObject({
      line: "Mr Gruber seems to be the one who can open this.",
      brief: "Ask Mr Gruber",
      vague: false,
      sources: ["Mr Gruber"],
    });
  });

  it("traces an item to the goal state that gives it", () => {
    const found = describeMissing(pack, state(), { items: ["i_tower_key"] });
    expect(found.line).toBe("Oswin seems to be the one who holds the Tower key.");
    expect(found.brief).toBe("Needs Tower key");
    expect(found.vague).toBe(false);
  });

  it("traces an item to the character it is found at", () => {
    const changed = structuredClone(pack);
    for (const member of changed.cast) member.goal_states.forEach((goal) => delete goal.gives_items);
    changed.items.find((item) => item.id === "i_tower_key")!.found_at = { type: "character", id: "c_mira" };
    expect(describeMissing(changed, state(), { items: ["i_tower_key"] }).line).toBe("Mira seems to have the Tower key.");
  });

  it("traces an item to the location it is found at", () => {
    const found = describeMissing(pack, state(), { items: ["i_glass_shard"] });
    expect(found.line).toBe("You will need the Glass shard. It may be somewhere around Herb Garden.");
    expect(found.sources).toEqual(["Herb Garden"]);
  });

  it("is vague when an item has no source", () => {
    const found = describeMissing(pack, state(), { items: ["i_tower_key"] });
    const changed = structuredClone(pack);
    for (const member of changed.cast) member.goal_states.forEach((goal) => delete goal.gives_items);
    const lost = describeMissing(changed, state(), { items: ["i_tower_key"] });
    expect(found.vague).toBe(false);
    expect(lost).toMatchObject({ line: "You will need the Tower key.", vague: true, sources: [] });
  });

  it("sends the player to the journal for a truth waiting on its question", () => {
    const withReady = { ...state(), truthsReady: ["t_night"] };
    const found = describeMissing(pack, withReady, { truths: ["t_night"] });
    expect(found.line).toBe(`Answer the question in your journal first: ${pack.truths.find((truth) => truth.id === "t_night")!.deduction!.question}`);
    expect(found.vague).toBe(false);
  });

  it("traces a truth to the character or place that reveals it", () => {
    expect(describeMissing(pack, state(), { truths: ["t_missing"] })).toMatchObject({
      line: "Mira may know something that explains this.",
      brief: "Ask Mira",
    });
    const changed = structuredClone(pack);
    changed.truths.find((truth) => truth.id === "t_missing")!.revealed_by = ["cl_notice_board"];
    expect(describeMissing(changed, state(), { truths: ["t_missing"] })).toMatchObject({
      line: "Something in Pebblebrook Square may explain this.",
      brief: "Look in Pebblebrook Square",
    });
  });

  it("falls back to a generic line and flags it vague when nothing can be traced", () => {
    const found = describeMissing(pack, state(), { goal_states: ["gs_nobody"] });
    expect(found).toMatchObject({ line: "Locked. Something here still needs working out first.", vague: true, sources: [] });
    expect(describeMissing(pack, state(), undefined).vague).toBe(true);
  });
});

describe("lock keys and unlock lines", () => {
  it("sorts door pairs so both directions share a key", () => {
    expect(doorLockKey("l_b", "l_a")).toBe("door:l_a|l_b");
    expect(doorLockKey("l_a", "l_b")).toBe(doorLockKey("l_b", "l_a"));
    expect(beatLockKey("b_out")).toBe("beat:b_out");
    expect(clueLockKey("cl_x")).toBe("clue:cl_x");
  });

  it("derives an unlock line from the cause", () => {
    const pack = loadPack(paddington);
    expect(derivedUnlockLine(pack, { goal_states: ["gs_gruber_cocoa"] }, "the Back Room")).toBe("Thanks to Mr Gruber, the way to the Back Room is open now.");
    expect(derivedUnlockLine(pack, { items: ["i_currant_buns"] }, "the Back Room")).toBe("With the Bag of currant buns, the way to the Back Room opens.");
    expect(derivedUnlockLine(pack, { truths: ["t_secret"] }, "the Back Room")).toBe("What you worked out opens the way to the Back Room.");
  });
});

describe("lockNotesFor", () => {
  const pack = loadPack(example);
  const view = getLengthView(pack);

  it("tells the character who holds the key about the lock, then stops once it is met", () => {
    const state = createStoryState(view);
    expect(lockNotesFor(pack, view, state, "c_oswin")).toEqual([]); // the player has not been to the library yet
    state.visitedAreas.push("l_library");
    const notes = lockNotesFor(pack, view, state, "c_oswin");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("The way into Clock Tower stays shut until: Oswin gets his overdue book back.");
    expect(notes[0]).not.toContain("hand it over"); // the shared instruction lives in the prompt
    expect(lockNotesFor(pack, view, state, "c_mira")).toEqual([]);
    giveItem(state, "i_tower_key");
    expect(lockNotesFor(pack, view, state, "c_oswin")).toEqual([]);
  });

  it("finds a lock written on the other side of the door", () => {
    const flipped = structuredClone(pack);
    const library = flipped.locations.find((location) => location.id === "l_library")!;
    const tower = flipped.locations.find((location) => location.id === "l_clocktower")!;
    const door = library.doors.find((candidate) => candidate.to === "l_clocktower")!;
    tower.doors.push({ id: "d_tower_library", to: "l_library", lock: door.lock });
    delete door.lock;
    const state = createStoryState(view);
    state.visitedAreas.push("l_library");
    expect(lockNotesFor(flipped, view, state, "c_oswin")[0]).toContain("The way into Clock Tower stays shut");
  });

  it("leaves out locks behind a place that is not open yet", () => {
    const state = createStoryState(view);
    state.visitedAreas.push("l_library");
    expect(lockNotesFor(pack, view, state, "c_oswin", () => false)).toEqual([]);
    expect(lockNotesFor(pack, view, state, "c_oswin", (id) => id === "l_clocktower")).toHaveLength(1);
  });
});

describe("explained locks in a story session (Paddington)", () => {
  const pack = loadPack(paddington);
  const beatOneTruths = ["t_hat_missing", "t_secret"];

  it("explains the back-room door in the story's words, notes a lead and announces it once when it opens", async () => {
    const story = await sessionWith(pack, { visited: ["l_gruber_shop"], truths: beatOneTruths });
    const shop = story.getArea("l_gruber_shop");
    const door = shop.doors.find((candidate) => candidate.targetAreaId === "l_gruber_backroom")!;
    const lock = pack.locations.find((location) => location.id === "l_gruber_shop")!.doors[0]!.lock!;

    expect(story.describeDoorLock(shop.id, door.id)).toBe(lock.reason);
    expect(story.leads()).toEqual([]);
    story.recordDoorLead(shop.id, door.id);
    story.recordDoorLead(shop.id, door.id);
    expect(story.state.leadsSeen).toEqual(["door:l_gruber_backroom|l_gruber_shop"]);
    expect(story.leads()).toEqual([{ title: expect.stringContaining("The way into"), reason: lock.reason, lead: lock.lead }]);
    expect(story.takeUnlocks()).toEqual([]);
    expect(story.lockNotesFor("c_mr_gruber")[0]).toContain("Paddington brings currant buns");

    story.state.resolvedGoalStates.push("gs_gruber_cocoa");
    const unlocks = story.takeUnlocks();
    expect(unlocks.map((unlock) => unlock.text)).toEqual([lock.unlock_text]);
    expect(story.takeUnlocks()).toEqual([]);
    expect(story.leads()).toEqual([expect.objectContaining({ resolved: lock.unlock_text })]);
  });

  it("explains the shut front door with the beat's gate reason and announces when the street opens", async () => {
    const story = await sessionWith(pack, { visited: ["l_hall"] });
    const hall = story.getArea("l_hall");
    const door = hall.doors.find((candidate) => candidate.targetAreaId === "l_windsor_gardens")!;
    const beat = story.view.beats.find((candidate) => candidate.id === "b_out")!;

    expect(story.describeDoorLock(hall.id, door.id)).toBe(beat.gate_reason);
    expect(story.describeDoorLockBriefly(hall.id, door.id)).toMatch(/^(Ask|Look in|Needs|Check)/);
    story.recordMapLeads();
    expect(story.state.leadsSeen).toContain("beat:b_out");
    // Titled after the door that was tried, not the whole list of places behind it, and neutral once open.
    const title = story.leads()[0]!.title;
    expect(title).toBe("The way into Windsor Gardens");
    expect(title).not.toContain(",");
    expect(story.takeUnlocks()).toEqual([]);

    story.state.truthsFound.push(...beatOneTruths);
    expect(story.describeDoorLock(hall.id, door.id)).toBeNull();
    expect(story.takeUnlocks().map((unlock) => unlock.text)).toEqual([beat.unlock_text]);
    expect(story.takeUnlocks()).toEqual([]);
    expect(story.leads()).toEqual([{ title, reason: beat.gate_reason, resolved: beat.unlock_text }]);
  });

  it("shows a glimpse for a gated object and announces its reveal", async () => {
    const story = await sessionWith(pack, { visited: ["l_judy_room"] });
    const notebook = story.getArea("l_judy_room").entities!.find((entity) => entity.clueIds?.includes("cl_judy_sketch"))!;
    const clue = pack.clues.find((candidate) => candidate.id === "cl_judy_sketch")!;

    expect(story.examineClues(notebook)).toEqual({ kind: "glimpse", text: clue.locked_glimpse });
    expect(story.state.cluesFound).not.toContain("cl_judy_sketch");
    expect(story.leads()).toEqual([expect.objectContaining({ reason: clue.locked_glimpse })]);

    story.state.truthsFound.push("t_hat_at_gruber");
    expect(story.takeUnlocks().map((unlock) => unlock.text)).toContain(clue.reveal_text);
    expect(story.examineClues(notebook)?.kind).toBe("found");
    expect(story.leads()[0]!.resolved).toBe(clue.reveal_text);
  });

  it("announces a spoken clue only once the character has been met", async () => {
    const story = await sessionWith(pack, { visited: ["l_gruber_shop"] });
    const clue = pack.clues.find((candidate) => candidate.id === "cl_gruber_explains")!;
    story.state.truthsFound.push("t_hat_at_gruber");
    expect(story.takeUnlocks().map((unlock) => unlock.text)).not.toContain(clue.reveal_text);

    const met = await sessionWith(pack, { visited: ["l_gruber_shop"] });
    met.state.characterMemory.c_mr_gruber = { visits: 1, askedAbout: [] };
    met.takeUnlocks();
    met.state.truthsFound.push("t_hat_at_gruber");
    // The snapshot only tracks the clue after the first look at a met character.
    expect(met.takeUnlocks().map((unlock) => unlock.text)).toContain(clue.reveal_text);
  });

  it("names the side the player is trying to reach, from either end of the door", async () => {
    const story = await sessionWith(pack, { visited: ["l_gruber_shop", "l_gruber_backroom"], truths: beatOneTruths });
    const backroom = story.getArea("l_gruber_backroom");
    const toShop = backroom.doors.find((candidate) => candidate.targetAreaId === "l_gruber_shop")!;
    story.recordDoorLead(backroom.id, toShop.id);
    expect(story.leads()[0]!.title).toBe("The way into Mr Gruber's Shop");
    story.state.resolvedGoalStates.push("gs_gruber_cocoa");
    expect(story.takeUnlocks()[0]!.text).toBe(pack.locations.find((location) => location.id === "l_gruber_shop")!.doors[0]!.lock!.unlock_text);
  });

  it("titles a beat lead after a place the player can see a door to, the same after a reload", async () => {
    const example2 = loadPack(example);
    // The beat lists the clock tower first, but only the library has a door from the square.
    const beat = example2.lengths.short!.beats[1]!;
    beat.locations = ["l_clocktower", "l_library"];
    const story = await sessionWith(example2, { visited: ["l_square"] });
    const square = story.getArea("l_square");
    const toLibrary = square.doors.find((door) => door.targetAreaId === "l_library")!;
    story.recordDoorLead(square.id, toLibrary.id);
    expect(story.state.leadsSeen).toEqual(["beat:b_tower"]);
    const title = story.leads()[0]!.title;
    expect(title).toBe("The way into Owl Library");

    const reloaded = await newSession(example2);
    reloaded.restoreSave({
      packId: example2.identity.id, packVersion: example2.identity.version, length: story.view.length,
      worldSeed: story.worldSeed, storyState: structuredClone(story.state), areaIds: story.getAreaIds(),
    } as GameSave);
    expect(reloaded.leads()[0]!.title).toBe(title);
  });

  it("falls back to the beat's first place, or 'somewhere new' when it has none", async () => {
    const pack2 = loadPack(example);
    const story = await sessionWith(pack2, { visited: ["l_garden"] });
    story.state.leadsSeen = ["beat:b_tower"];
    expect(story.leads()[0]!.title).toBe("The way into Owl Library");
    story.view.beats[1]!.locations = [];
    expect(story.leads()[0]!.title).toBe("The way into somewhere new");
  });

  it("ignores a remembered door target that is not part of the door", async () => {
    const pack2 = loadPack(example);
    const story = await sessionWith(pack2, { visited: ["l_library"], truths: ["t_missing"] });
    const library = story.getArea("l_library");
    story.recordDoorLead(library.id, library.doors.find((door) => door.targetAreaId === "l_clocktower")!.id);
    (story as unknown as { lockTargets: Map<string, string> }).lockTargets.set("door:l_clocktower|l_library", "l_nowhere");
    expect(story.leads()[0]!.title).toBe("The way into Clock Tower");
  });

  it("does not keep leads from before when a save has none", async () => {
    const story = await sessionWith(pack, { visited: ["l_gruber_shop"], truths: beatOneTruths });
    story.recordDoorLead("l_gruber_shop", story.getArea("l_gruber_shop").doors.find((door) => door.targetAreaId === "l_gruber_backroom")!.id);
    expect(story.leads()).toHaveLength(1);
    const state = structuredClone(story.state);
    delete state.leadsSeen;
    story.restoreSave({
      packId: pack.identity.id, packVersion: pack.identity.version, length: story.view.length,
      worldSeed: story.worldSeed, storyState: state, areaIds: story.getAreaIds(),
    } as GameSave);
    expect(story.leads()).toEqual([]);
  });

  it("does not leak a later beat's goal into lock notes", async () => {
    const story = await sessionWith(pack, { visited: ["l_gruber_shop"] });
    expect(story.lockNotesFor("c_mr_gruber")).toEqual([]); // the shop is in a beat that is not open yet
    const open = await sessionWith(pack, { visited: ["l_gruber_shop"], truths: beatOneTruths });
    expect(open.lockNotesFor("c_mr_gruber")[0]).toContain("The way into");
  });

  it("keeps leads through a save and announces nothing for locks that were already open", async () => {
    const story = await sessionWith(pack, { visited: ["l_gruber_shop"], truths: beatOneTruths });
    story.recordDoorLead("l_gruber_shop", story.getArea("l_gruber_shop").doors.find((door) => door.targetAreaId === "l_gruber_backroom")!.id);
    const reloaded = await newSession(pack);
    reloaded.restoreSave({
      packId: pack.identity.id,
      packVersion: pack.identity.version,
      length: story.view.length,
      worldSeed: story.worldSeed,
      storyState: structuredClone(story.state),
      areaIds: story.getAreaIds(),
    } as GameSave);
    expect(reloaded.leads()).toHaveLength(1);
    expect(reloaded.takeUnlocks()).toEqual([]);
  });
});

describe("derived lock text on the example pack", () => {
  it("names a source and never says 'more of the story' or 'can wait'", async () => {
    const pack = loadPack(example);
    const early = await sessionWith(pack, { visited: ["l_square"] });
    const square = early.getArea("l_square");
    const toLibrary = square.doors.find((door) => door.targetAreaId === "l_library")!;
    expect(early.describeDoorLock(square.id, toLibrary.id)).toMatch(/^Not yet\..*Mira/);
    expect(early.describeDoorLockBriefly(square.id, toLibrary.id)).toBe("Ask Mira");

    const story = await sessionWith(pack, { visited: ["l_library"], truths: ["t_missing"] });
    const library = story.getArea("l_library");
    const tower = library.doors.find((door) => door.targetAreaId === "l_clocktower")!;
    expect(story.describeDoorLock(library.id, tower.id)).toBe("Locked. Oswin seems to be the one who holds the Tower key.");
    expect(story.describeDoorLockBriefly(library.id, tower.id)).toBe("Needs Tower key");

    const messages = [
      early.describeDoorLock(square.id, toLibrary.id)!,
      story.describeDoorLock(library.id, tower.id)!,
      story.describeItemBlock({ ...pack.items[0]!, found_requires: { items: ["i_tower_key"] } }),
    ];
    for (const message of messages) {
      expect(message).not.toContain("more of the story");
      expect(message).not.toContain("can wait");
      expect(message).not.toContain("someone's help");
    }
  });

  it("derives the unlock line when nothing is authored", async () => {
    const pack = loadPack(example);
    const story = await sessionWith(pack, { visited: ["l_library"], truths: ["t_missing"] });
    const library = story.getArea("l_library");
    story.recordDoorLead(library.id, library.doors.find((door) => door.targetAreaId === "l_clocktower")!.id);
    expect(story.takeUnlocks()).toEqual([]);
    giveItem(story.state, "i_tower_key");
    const unlocks = story.takeUnlocks();
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0]!.text).toBe("With the Tower key, the way to Clock Tower opens.");
    expect(unlocks[0]!.newArea).toBe("Clock Tower");
  });
});

describe("lock text validator warnings and schema", () => {
  const codes = (pack: unknown): string[] => validateStoryPack(pack).warnings.map((issue) => issue.code);

  it("raises nothing for the Paddington pack", () => {
    expect(codes(paddington).filter((code) => code.startsWith("LOCK_") || code.startsWith("BEAT_GATE"))).toEqual([]);
  });

  it("warns when a beat after the first has no gate reason", () => {
    expect(codes(example)).toContain("BEAT_GATE_NO_REASON");
    const pack = structuredClone(example) as unknown as StoryPack;
    pack.lengths.short!.beats[1]!.gate_reason = "Not yet.";
    expect(codes(pack)).not.toContain("BEAT_GATE_NO_REASON");
  });

  // A truth no clue reveals cannot be traced to anyone, so a lock or clue gated on it explains nothing by itself.
  // The pack is not otherwise valid then, but the warnings are still reported.
  function untraceable(): StoryPack {
    const pack = structuredClone(example) as unknown as StoryPack;
    pack.truths.push({ id: "t_extra", text: "Something extra.", depends_on: [], importance: "side", revealed_by: [] });
    pack.locations.find((location) => location.id === "l_library")!.doors[0]!.lock = { truths: ["t_extra"] };
    pack.clues.find((clue) => clue.id === "cl_workbench")!.requirements = { truths: ["t_extra"] };
    return pack;
  }
  const lockWarnings = (pack: unknown, pathStart: string): number =>
    validateStoryPack(pack).warnings.filter((issue) => issue.code === "LOCK_NO_REASON" && issue.path.startsWith(pathStart)).length;

  it("does not warn about a lock whose source can be traced", () => {
    expect(codes(example)).not.toContain("LOCK_NO_REASON");
  });

  it("warns when a lock has no reason and its source cannot be traced", () => {
    const pack = untraceable();
    expect(lockWarnings(pack, "locations[")).toBe(1);
    pack.locations.find((location) => location.id === "l_library")!.doors[0]!.lock!.reason = "The tower door is bolted.";
    expect(lockWarnings(pack, "locations[")).toBe(0);
  });

  it("warns about a gated, object-anchored clue without a glimpse when its source cannot be traced", () => {
    const pack = untraceable();
    expect(lockWarnings(pack, "clues[")).toBe(1);
    pack.clues.find((clue) => clue.id === "cl_workbench")!.locked_glimpse = "The workbench is covered with a cloth.";
    expect(lockWarnings(pack, "clues[")).toBe(0);
  });

  it("warns when nobody mentions what opens a door, unless the lock has a lead", () => {
    const pack = structuredClone(example) as unknown as StoryPack;
    expect(codes(pack)).not.toContain("LOCK_NO_LEAD");
    pack.items.find((item) => item.id === "i_tower_key")!.name = "Zorblax qwerty";
    expect(codes(pack)).toContain("LOCK_NO_LEAD");
    pack.locations.find((location) => location.id === "l_library")!.doors[0]!.lock!.lead = "Oswin may have it.";
    expect(codes(pack)).not.toContain("LOCK_NO_LEAD");
  });

  it("matches the lead terms as whole words only", () => {
    const pack = structuredClone(example) as unknown as StoryPack;
    pack.items.find((item) => item.id === "i_tower_key")!.name = "Ink";
    // "ink" appears inside other words ("think", "drinking") in the pack's text but not as a word of its own.
    pack.cast[0]!.knowledge[0]!.text = "I think we were drinking tea.";
    expect(codes(pack)).toContain("LOCK_NO_LEAD");
    pack.cast[0]!.knowledge[0]!.text = "Bring the Ink, quickly.";
    expect(codes(pack)).not.toContain("LOCK_NO_LEAD");
  });

  it("accepts the new fields in the schema and rejects unknown ones", () => {
    const pack = structuredClone(example) as unknown as StoryPack;
    const lock = pack.locations.find((location) => location.id === "l_library")!.doors[0]!.lock!;
    Object.assign(lock, { reason: "Bolted.", lead: "Ask Oswin.", unlock_text: "Click." });
    pack.clues[0]!.locked_glimpse = "Not yet.";
    pack.clues[0]!.reveal_text = "Now.";
    Object.assign(pack.lengths.short!.beats[1]!, { gate_reason: "Not yet.", unlock_text: "Open." });
    expect(checkSchema(pack, schema as Record<string, unknown>)).toEqual([]);
    Object.assign(lock, { nonsense: true });
    expect(checkSchema(pack, schema as Record<string, unknown>)).not.toEqual([]);
  });

  it("rejects lock text over its length limit", () => {
    const pack = structuredClone(example) as unknown as StoryPack;
    pack.locations.find((location) => location.id === "l_library")!.doors[0]!.lock!.reason = "x".repeat(161);
    expect(validateStoryPack(pack).errors.map((issue) => issue.code)).toContain("TEXT_TOO_LONG");
  });
});

describe("authored lock text in the shipped example pack", () => {
  it("has a reason, lead and unlock line on the tower door and a gate reason on the tower beat", () => {
    const pack = loadPack(authoredExample);
    const lock = pack.locations.find((location) => location.id === "l_library")!.doors.find((door) => door.id === "d_library_tower")!.lock!;
    expect(lock.reason).toBeTruthy();
    expect(lock.lead).toBeTruthy();
    expect(lock.unlock_text).toBeTruthy();
    const beat = pack.lengths.short!.beats.find((candidate) => candidate.id === "b_tower")!;
    expect(beat.gate_reason).toBeTruthy();
    expect(beat.unlock_text).toBeTruthy();
  });
});

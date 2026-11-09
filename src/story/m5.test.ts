import { describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import lanterntide from "../../public/stories/lanterntide.json";
import { LLMClient } from "../llm/client";
import type { AreaBriefOutput } from "../llm/shapes";
import { MockBackend, type MockOptions } from "../llm/mock";
import { allPointsReachable, reachableTiles } from "../world/connectivity";
import { buildBriefPrompt } from "./briefPrompt";
import { buildStoryArea } from "./briefToMap";
import { buildGuard, fallbackBrief, findViolations, generateAreaBrief } from "./briefs";
import { getLengthView, type LengthView } from "./loader";
import { storyMockRespond, mockAreaBrief } from "./mockResponder";
import { BriefService } from "./prefetch";
import { buildLocationSlice, locationDoorTargets } from "./slice";
import { createStoryState } from "./state";
import { giveItem } from "./state";
import { StorySession } from "./storySession";
import type { LengthId, StoryPack } from "./types";
import { validateStoryPack } from "./validate";

function loadPack(id: string): StoryPack {
  const report = validateStoryPack(id === "example" ? example : lanterntide);
  if (!report.pack) throw new Error(`pack ${id} is invalid`);
  return report.pack;
}

async function makeClient(options: MockOptions = { respond: storyMockRespond }): Promise<LLMClient> {
  const client = new LLMClient(new MockBackend(options), { pauseWhenHidden: false });
  await client.load();
  return client;
}

const CASES: [string, LengthId][] = [["example", "short"], ["lanterntide", "short"], ["lanterntide", "medium"], ["lanterntide", "long"]];

function expectedIds(pack: StoryPack, view: LengthView, locationId: string): string[] {
  const slice = buildLocationSlice(pack, view, locationId);
  return [
    ...slice.characters.map((c) => `char:${c.id}`),
    ...slice.objects.map((o) => `${o.kind === "key_item" ? "item" : "obj"}:${o.id}`),
    ...slice.clues.map((c) => `clue:${c.id}`),
  ];
}

describe("location slice and prompt", () => {
  it("contains only this location's slice", () => {
    const pack = loadPack("lanterntide");
    const view = getLengthView(pack, "long");
    for (const location of view.locations) {
      const slice = buildLocationSlice(pack, view, location.id);
      const prompt = buildBriefPrompt(slice);
      const sliceText = JSON.stringify(slice);
      const present = new Set(slice.characters.map((c) => c.name));
      for (const member of pack.cast) {
        if (!present.has(member.name)) expect(prompt).not.toContain(member.name);
      }
      const allowedNames = new Set([slice.name, ...slice.doors.map((d) => d.to_name)]);
      for (const other of pack.locations) {
        if (!allowedNames.has(other.name) && !sliceText.includes(other.name)) expect(prompt).not.toContain(other.name);
      }
      for (const truth of pack.truths) expect(prompt).not.toContain(truth.text);
      expect(prompt).not.toContain(pack.identity.logline);
      expect(prompt.length).toBeLessThan(4000);
    }
  });

  it("includes role, mood, characters, objects, clues and door labels' destinations", () => {
    const pack = loadPack("example");
    const view = getLengthView(pack, "short");
    const slice = buildLocationSlice(pack, view, "l_library");
    const prompt = buildBriefPrompt(slice);
    expect(prompt).toContain(slice.role);
    expect(prompt).toContain(slice.mood);
    expect(prompt).toContain("Oswin");
    expect(prompt).toContain(slice.clues[0]!.text);
    expect(slice.doors.map((d) => d.to).sort()).toEqual(["l_clocktower", "l_square"]);
  });
});

describe("brief validation against the pack", () => {
  const pack = loadPack("example");
  const view = getLengthView(pack, "short");
  const guard = buildGuard(pack);
  const slice = buildLocationSlice(pack, view, "l_library");
  const good = (): AreaBriefOutput => mockAreaBrief(slice);

  it("accepts consistent output", () => {
    expect(findViolations(good(), slice, guard)).toEqual([]);
  });

  it("rejects a required character with a changed species", () => {
    const output = good();
    output.characters[0]!.species = "dragon";
    expect(findViolations(output, slice, guard)).not.toEqual([]);
  });

  it("rejects extras that impersonate cast members or hold story items", () => {
    const impersonator = good();
    impersonator.characters.push({ ...impersonator.characters[0]!, name: "Mira" });
    expect(findViolations(impersonator, slice, guard)).not.toEqual([]);
    const thief = good();
    thief.objects.push({ ...thief.objects[0]!, name: "Spare Crate", contents: ["the Tower Key"] });
    expect(findViolations(thief, slice, guard)).not.toEqual([]);
  });

  it("rejects a clue that points at the wrong truth or appears where the pack has none", () => {
    const wrong = good();
    wrong.clue = { truth_id: "t_taker", where: "here", text: "x" };
    expect(findViolations(wrong, slice, guard)).not.toEqual([]);
    const bakery = buildLocationSlice(pack, view, "l_bakery");
    const invented = mockAreaBrief(bakery);
    invented.clue = { truth_id: "t_missing", where: "here", text: "x" };
    expect(findViolations(invented, { ...bakery, clues: [] }, guard)).not.toEqual([]);
  });

  it("regenerates once, then falls back to pack facts when output keeps contradicting the pack", async () => {
    const bad = (): string => JSON.stringify({ ...good(), characters: [{ ...good().characters[0]!, species: "dragon" }] });
    const always = new MockBackend({ respond: bad });
    const client = new LLMClient(always, { pauseWhenHidden: false });
    await client.load();
    const outcome = await generateAreaBrief(client, slice, guard);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") return;
    expect(outcome.brief.source).toBe("fallback");
    expect(always.calls).toBeGreaterThanOrEqual(2);
    expect(outcome.brief.characters.map((c) => c.species)).toEqual(["small brown owl".length ? slice.characters[0]!.species : ""]);
    expect(outcome.brief.clues.map((c) => c.id)).toEqual(slice.clues.map((c) => c.id));
  });

  it("uses a regenerated valid reply", async () => {
    let call = 0;
    const backend = new MockBackend({
      respond: () => JSON.stringify(call++ === 0 ? { ...good(), clue: { truth_id: "nope", where: "x", text: "x" } } : good()),
    });
    const client = new LLMClient(backend, { pauseWhenHidden: false });
    await client.load();
    const outcome = await generateAreaBrief(client, slice, guard);
    expect(outcome.status === "ready" && outcome.brief.source).toBe("llm");
    expect(backend.calls).toBe(2);
  });

  it("never crashes when the backend throws or returns garbage", async () => {
    for (const respond of [() => "not json", () => { throw new Error("boom"); }]) {
      const client = await makeClient({ respond });
      const outcome = await generateAreaBrief(client, slice, guard);
      expect(outcome.status === "ready" && outcome.brief.source).toBe("fallback");
    }
  });
});

describe("brief-to-map placement", () => {
  it("adds furnishings to Lantern Tide interiors and draws the ink shelf as a shelf", () => {
    const pack = loadPack("lanterntide");
    const view = getLengthView(pack, "long");
    const guard = buildGuard(pack);
    const bakery = buildLocationSlice(pack, view, "l_bakery");
    const oilPress = buildLocationSlice(pack, view, "l_oil_press");
    const bakeryBrief = fallbackBrief(bakery, guard);
    const oilPressBrief = fallbackBrief(oilPress, guard);
    const inkShelf = oilPressBrief.objects.find((object) => object.packId === "o_ink_shelf");

    expect(bakery.objects.length).toBeGreaterThan(1);
    expect(inkShelf?.icon.shape).toBe("shelf");
    expect(buildStoryArea(bakeryBrief, "lanterntide:1").entities?.length).toBeGreaterThan(3);
  });

  for (const [id, length] of CASES) {
    it(`places every required entity on a reachable tile: ${id} (${length}), mock and fallback`, async () => {
      const pack = loadPack(id);
      const view = getLengthView(pack, length);
      for (const respond of [storyMockRespond, () => "garbage"]) {
        const client = await makeClient({ respond });
        const service = new BriefService(client, pack, view, createStoryState(view));
        for (const location of view.locations) {
          const brief = await service.request(location.id);
          const area = buildStoryArea(brief, `${id}:1`);
          const ids = new Set((area.entities ?? []).map((entity) => entity.id));
          for (const expected of expectedIds(pack, view, location.id)) expect(ids.has(expected), `${location.id} ${expected}`).toBe(true);
          expect(allPointsReachable(area)).toBe(true);
          const reachable = reachableTiles(area);
          const spots = new Set<string>();
          for (const entity of area.entities ?? []) {
            expect(reachable.has(`${entity.x},${entity.y}`)).toBe(true);
            spots.add(`${entity.x},${entity.y}`);
          }
          expect(spots.size).toBe(area.entities?.length);
          expect(area.doors.map((d) => d.targetAreaId).sort()).toEqual(locationDoorTargets(pack, view, location.id).sort());
        }
      }
    });
  }
});

describe("prefetch", () => {
  it("never queues more than the cap and does not store cancelled work", async () => {
    const pack = loadPack("lanterntide");
    const view = getLengthView(pack, "long");
    const client = await makeClient({ delayMs: 5, respond: storyMockRespond });
    const service = new BriefService(client, pack, view, createStoryState(view), 3);
    service.prefetch(view.locations.slice(0, 10).map((l) => l.id));
    expect(service.pendingPrefetchCount).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(service.pendingPrefetchCount).toBe(0);
    expect(view.locations.filter((l) => service.isReady(l.id))).toHaveLength(3);
    service.prefetch(view.locations.slice(0, 10).map((l) => l.id));
    expect(service.pendingPrefetchCount).toBe(3);
  });

  it("answers a request for a location that is still queued as a prefetch", async () => {
    const pack = loadPack("example");
    const view = getLengthView(pack, "short");
    const client = await makeClient({ delayMs: 5, respond: storyMockRespond });
    const service = new BriefService(client, pack, view, createStoryState(view));
    service.prefetch(["l_bakery", "l_garden", "l_library"]);
    const brief = await service.request("l_library");
    expect(brief.locationId).toBe("l_library");
    expect(brief.source).toBe("llm");
  });
});

describe("story session", () => {
  it("walks several locations, tracks state and regenerates the summary", async () => {
    const pack = loadPack("example");
    const view = getLengthView(pack, "short");
    const client = await makeClient({ delayMs: 1, respond: storyMockRespond });
    const story = new StorySession(pack, view, client);
    let area = await story.start();
    expect(area.id).toBe("l_square");
    const libraryDoor = area.doors.find((door) => door.targetAreaId === "l_library")!;
    expect(story.isDoorLocked(area.id, libraryDoor.id)).toBe(true);
    expect(story.describeDoorLock(area.id, libraryDoor.id)).toContain("Keep exploring nearby");
    await expect(story.enterDoor(area.id, libraryDoor.id)).rejects.toThrow("Keep exploring nearby");
    const openingClue = area.entities?.find((entity) => entity.kind === "clue" && entity.packId === "cl_notice_board");
    expect(openingClue).toBeDefined();
    story.examineClue(openingClue!);
    expect(story.isLocationOpen("l_library")).toBe(true);
    expect(story.isDoorLocked(area.id, libraryDoor.id)).toBe(false);
    giveItem(story.state, "i_tower_key");
    for (const target of ["l_bakery", "l_square", "l_library", "l_clocktower"]) {
      const door = area.doors.find((candidate) => candidate.targetAreaId === target);
      expect(door, `door to ${target}`).toBeDefined();
      const transition = await story.enterDoor(area.id, door!.id);
      area = transition.area;
      expect(area.id).toBe(target);
    }
    const clue = area.entities?.find((entity) => entity.kind === "clue");
    expect(clue).toBeDefined();
    expect(story.examineClue(clue!)).toBeTruthy();
    expect(story.state.truthsFound.length).toBe(1);
    expect(story.state.visitedAreas).toEqual(["l_square", "l_bakery", "l_library", "l_clocktower"]);
    expect(story.state).toMatchObject({ packId: "example", length: "short" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(story.state.summary).not.toBe("");
  });
});

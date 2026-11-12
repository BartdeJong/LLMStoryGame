import { describe, expect, it } from "vitest";
import example from "../../public/stories/example.json";
import { bakeSimple } from "./fixtures/bakeSimple";
import { getLengthView } from "./loader";
import { buildRecap, caseProgress, formatPlayTime } from "./progress";
import { createStoryState, grantTruthsFromFoundClues, giveItem, markClueFound, progressLogOf } from "./state";
import { validateStoryPack } from "./validate";

function loadExample() {
  const report = validateStoryPack(bakeSimple(example));
  if (!report.pack) throw new Error("example pack is invalid");
  return report.pack;
}

describe("case progress", () => {
  const pack = loadExample();
  const view = getLengthView(pack, "short");

  it("counts only the core truths of the chosen length", () => {
    const state = createStoryState(view);
    expect(caseProgress(view, state)).toEqual({ truthsFound: 0, truthsTotal: view.coreTruths.length });
    const core = view.coreTruths[0]!;
    state.truthsFound.push(core.id, "t_not_in_this_length");
    expect(caseProgress(view, state).truthsFound).toBe(1);
  });

  it("logs clues, truths and items in the order they happen", () => {
    const state = createStoryState(view);
    const clue = pack.clues.find((candidate) => candidate.truth_id && view.coreTruths.some((t) => t.id === candidate.truth_id))!;
    markClueFound(state, clue.id);
    markClueFound(state, clue.id);
    giveItem(state, pack.items[0]!.id);
    grantTruthsFromFoundClues(pack, state);
    const kinds = progressLogOf(state).map((entry) => entry.kind);
    expect(kinds[0]).toBe("clue");
    expect(kinds.filter((kind) => kind === "clue")).toHaveLength(1);
    expect(kinds).toContain("item");
  });

  it("builds a recap in confirmation order with the revealing clue", () => {
    const state = createStoryState(view);
    const [first, second] = view.coreTruths;
    const clueFor = (truthId: string) => pack.clues.find((clue) => clue.truth_id === truthId)!;
    // Confirm the second truth first: the recap must follow the log, not the pack order.
    state.truthsFound.push(second!.id);
    state.cluesFound.push(clueFor(second!.id).id);
    state.progressLog = [
      { kind: "clue", id: clueFor(second!.id).id, at: 10 },
      { kind: "truth", id: second!.id, at: 11 },
      { kind: "clue", id: clueFor(first!.id).id, at: 20 },
      { kind: "truth", id: first!.id, at: 21 },
    ];
    state.truthsFound.push(first!.id);
    state.cluesFound.push(clueFor(first!.id).id);
    const recap = buildRecap(pack, view, state);
    expect(recap.truths.map((truth) => truth.text)).toEqual([second!.text, first!.text]);
    expect(recap.truths[0]!.clue).toBe(clueFor(second!.id).text);
  });

  it("still builds a recap for an old save without a progress log", () => {
    const state = createStoryState(view);
    delete state.progressLog;
    state.truthsFound.push(view.coreTruths[0]!.id);
    state.itemsHeld.push(pack.items[0]!.id);
    const recap = buildRecap(pack, view, state);
    expect(recap.truths).toHaveLength(1);
    expect(recap.items).toEqual([pack.items[0]!.name]);
    expect(recap.optionalCluesFound).toBeLessThanOrEqual(recap.optionalCluesTotal);
  });

  it("formats play time", () => {
    expect(formatPlayTime(20_000)).toBe("1 min");
    expect(formatPlayTime(95 * 60_000)).toBe("1 h 35 min");
  });
});

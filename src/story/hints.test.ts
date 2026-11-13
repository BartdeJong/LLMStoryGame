import { describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import { hintFor, progressMark } from "./hints";
import { getLengthView } from "./loader";
import { caseRecordOf, createStoryState, hintsOf, markClueFound, markVisited, rememberHint, rememberLead } from "./state";
import type { StoryPack } from "./types";

const pack = (): StoryPack => structuredClone(fixture) as unknown as StoryPack;
const setup = () => {
  const p = pack();
  const view = getLengthView(p);
  return { p, view, state: createStoryState(view) };
};

describe("progress mark", () => {
  it("changes with a clue, a visit, a lead and a beat", () => {
    const { state } = setup();
    const marks = new Set([progressMark(state, 0)]);
    markClueFound(state, "cl_pip_saw");
    marks.add(progressMark(state, 0));
    markVisited(state, "l_square");
    marks.add(progressMark(state, 0));
    rememberLead(state, "beat:b_tower");
    marks.add(progressMark(state, 0));
    marks.add(progressMark(state, 1));
    expect(marks.size).toBe(5);
  });

  it("changes when a question is answered or a challenge is made", () => {
    const { state } = setup();
    const before = progressMark(state, 0);
    caseRecordOf(state).deductions.push({ truthId: "t_night", answer: "x", correct: false, outcome: "wrong", evidence: [] });
    const answered = progressMark(state, 0);
    caseRecordOf(state).challenges.push({ statementId: "s", evidence: { type: "clue", id: "c" }, fits: false });
    expect(new Set([before, answered, progressMark(state, 0)]).size).toBe(3);
  });
});

describe("hints", () => {
  const openFirst = (id: string): boolean => ["l_square", "l_bakery", "l_garden"].includes(id);

  it("points at an open deduction first", () => {
    const { p, view, state } = setup();
    state.truthsReady.push("t_night");
    const hint = hintFor(p, view, state, 0, openFirst);
    expect(hint?.key).toBe("question:t_night");
    expect(hint?.clear).toContain(p.truths.find((truth) => truth.id === "t_night")!.deduction!.question);
  });

  it("names an unfound source in an open place for a missing truth, never one behind a closed beat", () => {
    const { p, view, state } = setup();
    const hint = hintFor(p, view, state, 0, openFirst)!;
    expect(hint.key).toBe("b_square:truth:t_missing");
    expect(hint.vague.length).toBeGreaterThan(0);
    expect(hint.clear).toMatch(/Mira|notice board/i);
    expect(hint.clear).not.toMatch(/Hollis|tower|workbench/i);
    markClueFound(state, "cl_mira_talk");
    const next = hintFor(p, view, state, 0, openFirst)!;
    expect(next.clear).toMatch(/notice board/i);
  });

  it("points at the finale when the last beat is complete", () => {
    const { p, view, state } = setup();
    const hint = hintFor(p, view, state, view.beats.length - 1, () => true)!;
    expect(hint.key).toBe("finale");
    expect(hint.clear).toMatch(/^Go to .+ and present your case\.$/);
  });

  it("remembers a hint once", () => {
    const { state } = setup();
    expect(rememberHint(state, "finale#1")).toBe(true);
    expect(rememberHint(state, "finale#1")).toBe(false);
    expect(hintsOf(state)).toEqual(["finale#1"]);
  });
});

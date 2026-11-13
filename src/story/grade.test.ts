import { describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import { GRADE } from "./config";
import { buildGrade, lengthClues } from "./grade";
import { getLengthView } from "./loader";
import { caseRecordOf, createStoryState, markClueFound, rememberHint } from "./state";
import type { StoryPack } from "./types";

const pack = (): StoryPack => structuredClone(fixture) as unknown as StoryPack;

const setup = () => {
  const p = pack();
  const view = getLengthView(p);
  return { p, view, state: createStoryState(view) };
};

describe("case grade", () => {
  it("counts clues and deductions of the length", () => {
    const { p, view, state } = setup();
    const grade = buildGrade(p, view, state);
    expect(grade.cluesTotal).toBe(lengthClues(p, view).length);
    expect(grade.cluesFound).toBe(0);
    const asked = [...view.coreTruths, ...view.sideTruths].filter((truth) => truth.deduction).length;
    expect(grade.deductionsTotal).toBe(asked);
    markClueFound(state, "cl_pip_saw");
    caseRecordOf(state).deductions.push({ truthId: "t_night", answer: "x", correct: true, outcome: "proven", evidence: [] });
    caseRecordOf(state).deductions.push({ truthId: "t_taker", answer: "y", correct: false, outcome: "wrong", evidence: [] });
    const next = buildGrade(p, view, state);
    expect(next.cluesFound).toBe(1);
    expect(next.deductionsAnswered).toBe(2);
    expect(next.deductionsRight).toBe(1);
  });

  it("counts wrong and misread answers and missed challenges", () => {
    const { p, view, state } = setup();
    const record = caseRecordOf(state);
    record.deductions.push({ truthId: "t_night", answer: "x", correct: false, outcome: "misread", evidence: [] });
    record.summation.push({ truthId: "t_taker", answerId: "t_night", correct: false, outcome: "wrong", evidence: [] });
    record.summation.push({ truthId: "t_motive", answerId: "t_motive", correct: true, outcome: "unproven", evidence: [] });
    record.challenges.push({ statementId: "s", evidence: { type: "clue", id: "c" }, fits: false });
    const grade = buildGrade(p, view, state);
    expect(grade.wrongAnswers).toBe(2);
    expect(grade.missedChallenges).toBe(1);
  });

  it("names up to three missed things with the clue text and where to find it", () => {
    const { p, view, state } = setup();
    const grade = buildGrade(p, view, state);
    expect(grade.missed.length).toBeGreaterThan(0);
    expect(grade.missed.length).toBeLessThanOrEqual(3);
    const first = grade.missed[0]!;
    expect(first).toMatch(/^You never found: ".+" \(.+\)$/);
    expect(p.clues.some((clue) => first.includes(clue.text.slice(0, 40)))).toBe(true);
  });

  it("misses nothing when everything is found and nothing stands", () => {
    const { p, view, state } = setup();
    for (const clue of p.clues) markClueFound(state, clue.id);
    expect(buildGrade(p, view, state).missed).toEqual([]);
  });

  it("maps the score to tiers", () => {
    const { p, view, state } = setup();
    // Nothing found, nothing answered: only the answer share counts (it is 1 without answers).
    expect(buildGrade(p, view, state).score).toBe(Math.round(100 * GRADE.answerWeight));
    for (const clue of p.clues) markClueFound(state, clue.id);
    const top = buildGrade(p, view, state);
    expect(top.score).toBe(100);
    expect(top.title).toBe("Master Detective");
    caseRecordOf(state).deductions.push({ truthId: "t_night", answer: "x", correct: false, outcome: "wrong", evidence: [] });
    caseRecordOf(state).deductions.push({ truthId: "t_taker", answer: "x", correct: false, outcome: "wrong", evidence: [] });
    const low = buildGrade(p, view, state);
    expect(low.score).toBe(40);
    expect(low.title).toBe("Promising Apprentice");
    const record = caseRecordOf(state);
    record.deductions.length = 1;
    record.deductions[0]!.outcome = "unproven";
    record.deductions[0]!.correct = true;
    const mid = buildGrade(p, view, state); // 40 + 60 * 0.5 = 70
    expect(mid.score).toBe(70);
    expect(mid.title).toBe("Sharp Investigator");
  });

  it("is an assisted case without stakes", () => {
    const { p, view, state } = setup();
    caseRecordOf(state).assisted = true;
    const grade = buildGrade(p, view, state);
    expect(grade.assisted).toBe(true);
    expect(grade.title).toBe("Assisted case");
    expect(grade.score).toBe(0);
  });

  it("takes a capped penalty for hints", () => {
    const { p, view, state } = setup();
    for (const clue of p.clues) markClueFound(state, clue.id);
    rememberHint(state, "a#1");
    expect(buildGrade(p, view, state).score).toBe(100 - GRADE.hintPenalty);
    for (let index = 0; index < 10; index += 1) rememberHint(state, `k${index}#1`);
    const grade = buildGrade(p, view, state);
    expect(grade.hintsUsed).toBe(11);
    expect(grade.score).toBe(100 - GRADE.maxHintPenalty);
  });
});

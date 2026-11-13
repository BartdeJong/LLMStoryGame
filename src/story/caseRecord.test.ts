import { afterEach, describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import { setAssistedDeductions } from "./assist";
import { answerSummation, caseResult, endingVariant, judgeSummation, nextSummationIndex, recapAnswers, summationComplete } from "./caseRecord";
import { buildEndingPrompt, writeEnding } from "./ending";
import { getLengthView } from "./loader";
import { buildRecap } from "./progress";
import { caseRecordOf, createStoryState, emptyCaseRecord, grantTruthsFromFoundClues, markClueFound } from "./state";
import type { AnswerOutcome, CaseRecord } from "./state";
import type { Ending, StoryPack } from "./types";
import { validateStoryPack } from "./validate";

const pack = (): StoryPack => structuredClone(fixture) as unknown as StoryPack;
const thresholds = { flawedShare: 0.4, challengeWeight: 0.5, unprovenWeight: 0.5 };

function record(parts: Partial<CaseRecord>): CaseRecord {
  return { ...emptyCaseRecord(), ...parts };
}
const answer = (outcome: AnswerOutcome | boolean) => {
  const kind: AnswerOutcome = typeof outcome === "boolean" ? (outcome ? "proven" : "wrong") : outcome;
  return { truthId: "t", answer: "a", correct: kind === "proven" || kind === "unproven", outcome: kind, evidence: [] };
};
const summed = (outcome: AnswerOutcome | boolean) => {
  const kind: AnswerOutcome = typeof outcome === "boolean" ? (outcome ? "proven" : "wrong") : outcome;
  return { truthId: "t", answerId: "a", correct: kind === "proven" || kind === "unproven", outcome: kind, evidence: [] };
};
const challenge = (fits: boolean) => ({ statementId: "s", evidence: { type: "item" as const, id: "i" }, fits });

afterEach(() => setAssistedDeductions(false));

describe("case result thresholds", () => {
  it("is clean with no mistakes, even with nothing answered", () => {
    expect(caseResult(record({}), thresholds).kind).toBe("clean");
    expect(caseResult(record({ deductions: [answer(true), answer(true)], challenges: [challenge(true)] }), thresholds).kind).toBe("clean");
  });

  it("is a solve with mistakes below the flawed share", () => {
    // 1 wrong of 4 answers = 0.25
    const result = caseResult(record({ deductions: [answer(true), answer(true), answer(true)], summation: [summed(false)] }), thresholds);
    expect(result.kind).toBe("mistakes");
    expect(result.share).toBeCloseTo(0.25);
  });

  it("is flawed at or above the flawed share", () => {
    // 2 wrong of 5 answers = 0.4
    expect(caseResult(record({ deductions: [answer(false), answer(false), answer(true), answer(true)], summation: [summed(true)] }), thresholds).kind).toBe("flawed");
  });

  it("weighs failed challenges by challengeWeight", () => {
    // answers: 3 right; challenges: 2 missed, 1 fit -> 1 / (3 + 1.5) = 0.22
    const result = caseResult(record({ deductions: [answer(true), answer(true), answer(true)], challenges: [challenge(false), challenge(false), challenge(true)] }), thresholds);
    expect(result.kind).toBe("mistakes");
    expect(result.mistakes).toBe(2);
    expect(result.share).toBeCloseTo(1 / 4.5);
    expect(caseResult(record({ challenges: [challenge(false)] }), { flawedShare: 0.4, challengeWeight: 1, unprovenWeight: 0.5 }).kind).toBe("flawed");
  });

  it("counts an unproven answer as a mistake that weighs unprovenWeight", () => {
    // 1 unproven of 4 answers = 0.5 / 4 = 0.125: solved with mistakes, never clean
    const result = caseResult(record({ deductions: [answer(true), answer(true), answer("unproven")], summation: [summed(true)] }), thresholds);
    expect(result.kind).toBe("mistakes");
    expect(result.mistakes).toBe(1);
    expect(result.share).toBeCloseTo(0.125);
    // two unproven of five = 0.2; a full-weight unproven (1) of 2 answers reaches the flawed share
    expect(caseResult(record({ deductions: [answer("unproven"), answer(true)] }), { ...thresholds, unprovenWeight: 1 }).kind).toBe("flawed");
    expect(caseResult(record({ deductions: [answer("unproven"), answer(true)] }), thresholds).share).toBeCloseTo(0.25);
  });

  it("scores a misread answer like a wrong one", () => {
    expect(caseResult(record({ deductions: [answer("misread"), answer(true)] }), thresholds).share).toBeCloseTo(0.5);
    expect(caseResult(record({ deductions: [answer("misread"), answer(true)] }), thresholds).kind).toBe("flawed");
  });

  it("reports an assisted case whatever the record says", () => {
    expect(caseResult(record({ assisted: true, deductions: [answer(false)] }), thresholds).kind).toBe("assisted");
  });

  it("marks the record assisted when assisted deductions confirm a truth", () => {
    const data = pack();
    const state = createStoryState(getLengthView(data, "short"));
    setAssistedDeductions(true);
    markClueFound(state, "cl_mira_talk");
    markClueFound(state, "cl_pip_saw");
    grantTruthsFromFoundClues(data, state);
    expect(state.truthsFound).toContain("t_night");
    expect(caseRecordOf(state).assisted).toBe(true);
    expect(caseRecordOf(state).deductions).toEqual([]);
  });
});

describe("one-pass finale", () => {
  const questions = [
    { question: "Who took it?", truthId: "t_taker" },
    { question: "Why?", truthId: "t_motive" },
  ];

  it("records one answer per question and resumes at the first unanswered one", () => {
    const state = createStoryState(getLengthView(pack(), "short"));
    expect(nextSummationIndex(state, questions)).toBe(0);
    expect(answerSummation(state, questions[0]!, "t_night")).toBe("wrong");
    expect(answerSummation(state, questions[0]!, "t_taker")).toBeNull(); // ignored: already answered
    expect(caseRecordOf(state).summation).toEqual([{ truthId: "t_taker", answerId: "t_night", correct: false, outcome: "wrong", evidence: [] }]);
    expect(nextSummationIndex(state, questions)).toBe(1);
    expect(summationComplete(state, questions)).toBe(false);
    expect(answerSummation(state, questions[1]!, "t_motive")).toBe("proven");
    expect(summationComplete(state, questions)).toBe(true);
  });

  it("judges a summation answer against its proof and records what was shown", () => {
    const state = createStoryState(getLengthView(pack(), "short"));
    markClueFound(state, "cl_oswin_ledger");
    const question = { question: "Who took it?", truthId: "t_taker", proof: { clues: ["cl_oswin_ledger", "cl_shard_match"], required: 2 } };
    const shown = [
      { type: "clue" as const, id: "cl_oswin_ledger" },
      { type: "clue" as const, id: "cl_oswin_ledger" }, // duplicate counts once
      { type: "clue" as const, id: "cl_shard_match" }, // not held: dropped
    ];
    expect(judgeSummation(state, question, "t_taker", shown)).toBe("unproven");
    expect(caseRecordOf(state).summation).toEqual([]); // judging records nothing
    markClueFound(state, "cl_shard_match");
    expect(judgeSummation(state, question, "t_taker", shown)).toBe("proven");
    expect(judgeSummation(state, question, "t_night", shown)).toBe("misread");
    expect(judgeSummation(state, question, "t_night", [])).toBe("wrong");
    expect(answerSummation(state, question, "t_taker", shown)).toBe("proven");
    expect(caseRecordOf(state).summation).toEqual([{
      truthId: "t_taker", answerId: "t_taker", correct: true, outcome: "proven",
      evidence: [{ type: "clue", id: "cl_oswin_ledger" }, { type: "clue", id: "cl_shard_match" }],
    }]);
  });
});

describe("flawed ending variant", () => {
  const flawed = { scene_outline: "The lantern is lit, but the village still whispers about the wrong person.", tone: "wistful", epilogue_notes: "Someone else must set the record straight." };

  it("plays only when the case is flawed and the ending has one", () => {
    const ending = { ...pack().endings[0]!, flawed } as Ending;
    expect(endingVariant(ending, { kind: "flawed", mistakes: 3, share: 0.6 })).toBe(flawed);
    expect(endingVariant(ending, { kind: "mistakes", mistakes: 1, share: 0.2 })).toBeNull();
    expect(endingVariant({ ...ending, flawed: undefined }, { kind: "flawed", mistakes: 3, share: 0.6 })).toBeNull();
  });

  it("goes into the prompt and the fallback instead of the normal outline", async () => {
    const data = pack();
    const ending = { ...data.endings[0]!, flawed } as Ending;
    expect(buildEndingPrompt(data, ending, flawed)).toContain(flawed.scene_outline);
    expect(buildEndingPrompt(data, ending, flawed)).not.toContain(ending.scene_outline);
    const client = new LLMClient(new MockBackend({ respond: () => "not json" }), { pauseWhenHidden: false });
    await client.load();
    const scene = await writeEnding(client, data, ending, flawed);
    expect(scene.scene).toBe(flawed.scene_outline);
    expect(scene.epilogue).toBe(flawed.epilogue_notes);
    expect(scene.flawed).toBe(true);
  });

  it("is valid pack data", () => {
    const data = pack();
    data.endings[0] = { ...data.endings[0]!, flawed };
    expect(validateStoryPack(data).errors).toEqual([]);
  });
});

describe("recap", () => {
  it("lists each answer with whether it was right, and the statements", () => {
    const data = pack();
    const view = getLengthView(data, "short");
    const state = createStoryState(view);
    const wrong = data.truths[1]!.deduction!.wrong_answers[0]!;
    markClueFound(state, "cl_oswin_ledger");
    caseRecordOf(state).deductions.push({ truthId: "t_night", answer: wrong, correct: false, outcome: "wrong", evidence: [] });
    caseRecordOf(state).summation.push({
      truthId: "t_taker", answerId: "t_taker", correct: true, outcome: "proven", evidence: [{ type: "clue", id: "cl_oswin_ledger" }],
    });
    const recap = buildRecap(data, view, state, [{ question: "Who took it?", truthId: "t_taker" }]);
    expect(recap.result.kind).toBe("flawed"); // 1 wrong of 2 answers
    expect(recap.answers).toEqual([
      { question: data.truths[1]!.deduction!.question, answer: wrong, correctAnswer: data.truths[1]!.deduction!.answer, correct: false, outcome: "wrong", shown: [], hadProof: true, kind: "deduction" },
      { question: "Who took it?", answer: data.truths[2]!.text, correctAnswer: data.truths[2]!.text, correct: true, outcome: "proven", shown: [data.clues.find((clue) => clue.id === "cl_oswin_ledger")!.text], hadProof: false, kind: "summation" },
    ]);
    expect(recap.statements).toEqual({ broken: 0, standing: 0, heardStanding: 0, missedChallenges: 0 });
  });

  it("flags whether each answered question had an authored proof", () => {
    const data = pack();
    const view = getLengthView(data, "short");
    const state = createStoryState(view);
    caseRecordOf(state).summation.push({ truthId: "t_taker", answerId: "t_taker", correct: true, outcome: "proven", evidence: [] });
    const withProof = recapAnswers(data, state, [{ question: "Who took it?", truthId: "t_taker", proof: { clues: ["cl_oswin_ledger"] } }]);
    expect(withProof.map((answer) => answer.hadProof)).toEqual([true]);
    expect(recapAnswers(data, state, [{ question: "Who took it?", truthId: "t_taker" }]).map((answer) => answer.hadProof)).toEqual([false]);
    delete data.truths[1]!.deduction!.proof;
    caseRecordOf(state).deductions.push({ truthId: "t_night", answer: data.truths[1]!.deduction!.answer, correct: true, outcome: "proven", evidence: [] });
    expect(recapAnswers(data, state)[0]!.hadProof).toBe(false);
  });
});

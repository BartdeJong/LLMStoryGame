import { afterEach, describe, expect, it } from "vitest";
import fixture from "../../public/stories/example.json";
import { LLMClient } from "../llm/client";
import { MockBackend } from "../llm/mock";
import { setAssistedDeductions } from "./assist";
import { answerDeduction, collectTwistReveals, deductionOptions, openDeductions, pickSummation } from "./deduction";
import { getLengthView } from "./loader";
import { storyMockRespond } from "./mockResponder";
import { caseRecordOf, createStoryState, grantTruthsFromFoundClues, markClueFound } from "./state";
import { StorySession } from "./storySession";
import type { StoryPack } from "./types";
import { validateStoryPack } from "./validate";

const fresh = (): StoryPack => structuredClone(fixture) as unknown as StoryPack;
const codes = (data: unknown): string[] => validateStoryPack(data).errors.map((e) => e.code);

function setup(pack = fresh()) {
  const view = getLengthView(pack, "short");
  const state = createStoryState(view);
  const find = (...clueIds: string[]): void => {
    for (const id of clueIds) markClueFound(state, id);
    grantTruthsFromFoundClues(pack, state);
  };
  return { pack, view, state, find };
}

afterEach(() => setAssistedDeductions(false));

describe("deductions", () => {
  it("confirms a truth without a deduction as soon as its clue is found", () => {
    const { state, find } = setup();
    find("cl_mira_talk");
    expect(state.truthsFound).toEqual(["t_missing"]);
    expect(state.truthsReady).toEqual([]);
  });

  it("makes a deduction truth ready, not found, until it is answered", () => {
    const { pack, state, find } = setup();
    find("cl_mira_talk", "cl_pip_saw");
    expect(state.truthsFound).toEqual(["t_missing"]);
    expect(state.truthsReady).toEqual(["t_night"]);
    expect(openDeductions(pack, state).map((truth) => truth.id)).toEqual(["t_night"]);

    const right = answerDeduction(pack, state, "t_night", pack.truths[1].deduction!.answer);
    expect(right.correct).toBe(true);
    expect(state.truthsFound).toContain("t_night");
    expect(state.truthsReady).toEqual([]);
    expect(caseRecordOf(state).deductions).toEqual([{ truthId: "t_night", answer: pack.truths[1].deduction!.answer, correct: true }]);
  });

  it("takes one final answer: a wrong one still confirms the truth and is recorded", () => {
    const { pack, state, find } = setup();
    find("cl_mira_talk", "cl_pip_saw");
    const wrongAnswer = pack.truths[1].deduction!.wrong_answers[0]!;
    const wrong = answerDeduction(pack, state, "t_night", wrongAnswer);
    expect(wrong.accepted).toBe(true);
    expect(wrong.correct).toBe(false);
    expect(wrong.truth?.id).toBe("t_night");
    expect(state.truthsFound).toContain("t_night"); // the story goes on
    expect(openDeductions(pack, state)).toEqual([]);
    expect(caseRecordOf(state).deductions).toEqual([{ truthId: "t_night", answer: wrongAnswer, correct: false }]);

    // No second try.
    const again = answerDeduction(pack, state, "t_night", pack.truths[1].deduction!.answer);
    expect(again.accepted).toBe(false);
    expect(caseRecordOf(state).deductions).toHaveLength(1);
  });

  it("never offers fewer options after a miss", () => {
    const { pack } = setup();
    const truth = pack.truths[1];
    expect(deductionOptions(truth)).toHaveLength(1 + truth.deduction!.wrong_answers.length);
  });

  it("waits for depends_on truths to be confirmed before a truth becomes ready", () => {
    const { pack, state, find } = setup();
    find("cl_mira_talk", "cl_pip_saw", "cl_library_log", "cl_shard_match");
    expect(state.truthsReady).toEqual(["t_night"]);

    answerDeduction(pack, state, "t_night", pack.truths[1].deduction!.answer);
    expect(state.truthsReady).toEqual(["t_taker"]);
  });

  it("ignores answers for truths that are not ready", () => {
    const { pack, state, find } = setup();
    find("cl_mira_talk");
    expect(answerDeduction(pack, state, "t_taker", pack.truths[2].deduction!.answer).correct).toBe(false);
    expect(state.truthsFound).toEqual(["t_missing"]);
  });

  it("rules out red herrings when the right answer is given", () => {
    const { pack, state, find } = setup();
    find("cl_mira_talk", "cl_pip_saw", "cl_shard_match");
    answerDeduction(pack, state, "t_night", pack.truths[1].deduction!.answer);
    expect(state.herringsRuledOut).toEqual([]);

    const result = answerDeduction(pack, state, "t_taker", pack.truths[2].deduction!.answer);
    expect(result.ruledOut.map((herring) => herring.id)).toEqual(["rh_flour_prints"]);
    expect(state.herringsRuledOut).toEqual(["rh_flour_prints"]);
  });

  it("shuffles the answer options but keeps all of them", () => {
    const truth = fresh().truths[2];
    const options = deductionOptions(truth);
    expect(options).toEqual(deductionOptions(truth));
    expect([...options].sort()).toEqual([truth.deduction!.answer, ...truth.deduction!.wrong_answers].sort());
  });

  it("confirms everything automatically in assisted mode", () => {
    setAssistedDeductions(true);
    const { state, find } = setup();
    find("cl_mira_talk", "cl_pip_saw", "cl_shard_match");
    expect(state.truthsFound).toEqual(["t_missing", "t_night", "t_taker"]);
    expect(state.truthsReady).toEqual([]);
    expect(state.herringsRuledOut).toEqual(["rh_flour_prints"]);
  });

  it("reveals a twist once, when its payoff first becomes true", () => {
    const { pack, view, state, find } = setup();
    expect(collectTwistReveals(pack, view, state)).toEqual([]);
    find("cl_mira_talk", "cl_pip_saw", "cl_shard_match", "cl_workbench");
    for (const id of ["t_night", "t_taker"]) {
      answerDeduction(pack, state, id, pack.truths.find((truth) => truth.id === id)!.deduction!.answer);
    }
    expect(collectTwistReveals(pack, view, state)).toEqual([]);

    answerDeduction(pack, state, "t_motive", pack.truths[3].deduction!.answer);
    expect(collectTwistReveals(pack, view, state).map((twist) => twist.id)).toEqual(["tw_gentle_taker"]);
    expect(state.twistsSeen).toEqual(["tw_gentle_taker"]);
    expect(collectTwistReveals(pack, view, state)).toEqual([]);
  });
});

describe("story session deduction rules", () => {
  const session = (pack: StoryPack): StorySession => new StorySession(
    pack,
    getLengthView(pack, "short"),
    new LLMClient(new MockBackend({ respond: storyMockRespond })),
  );

  it("says the beat waits on a deduction only when an open question blocks it", () => {
    const pack = fresh();
    pack.truths[0].deduction = { question: "What happened?", answer: "It vanished.", wrong_answers: ["Nothing.", "A joke."] };
    const story = session(pack);
    expect(story.currentBeatWaitsOnDeduction()).toBe(false);

    markClueFound(story.state, "cl_mira_talk");
    grantTruthsFromFoundClues(pack, story.state);
    expect(story.state.truthsReady).toEqual(["t_missing"]);
    expect(story.currentBeatWaitsOnDeduction()).toBe(true);

    answerDeduction(pack, story.state, "t_missing", "It vanished.");
    expect(story.currentBeatWaitsOnDeduction()).toBe(false);
    expect(story.currentBeat.id).toBe("b_tower");
  });

  it("offers a summation at the finale only once the ending facts are met", () => {
    const pack = fresh();
    const story = session(pack);
    story.state.visitedAreas.push("l_clocktower");
    expect(story.getSummation("l_clocktower")).toBeNull();

    story.state.truthsFound.push("t_missing", "t_night", "t_taker", "t_motive");
    story.state.resolvedGoalStates.push("gs_hollis_forgiven");
    expect(story.getSummation("l_clocktower")?.map((entry) => entry.truthId)).toEqual(["t_night", "t_taker", "t_motive"]);
  });

  it("has no summation for endings that define none", () => {
    const pack = fresh();
    delete pack.endings[0].summation;
    expect(pickSummation(pack.endings)).toBeNull();
  });
});

describe("validator rejects bad deduction data", () => {
  it("answer repeated among the wrong answers", () => {
    const pack = fresh();
    pack.truths[2].deduction!.wrong_answers[0] = pack.truths[2].deduction!.answer.toUpperCase();
    expect(codes(pack)).toContain("DEDUCTION_DUPLICATE_ANSWER");
  });

  it("too few or too many wrong answers", () => {
    const few = fresh();
    few.truths[2].deduction!.wrong_answers = ["Only one."];
    expect(codes(few)).toContain("SCHEMA");
    const many = fresh();
    many.truths[2].deduction!.wrong_answers = ["a1", "a2", "a3", "a4"];
    expect(codes(many)).toContain("SCHEMA");
  });

  it("rules_out naming an unknown red herring", () => {
    const pack = fresh();
    pack.truths[2].deduction!.rules_out = ["rh_nope"];
    const report = validateStoryPack(pack);
    expect(report.errors.some((e) => e.code === "REF_UNKNOWN" && e.message.includes("rh_nope"))).toBe(true);
  });

  it("summation truth that is not in the ending conditions", () => {
    const pack = fresh();
    pack.endings[0].summation![0].truth_id = "t_missing";
    expect(codes(pack)).toContain("SUMMATION_TRUTH_NOT_IN_ENDING");
  });

  it("summation with the same truth twice, or too few entries", () => {
    const duplicate = fresh();
    duplicate.endings[0].summation![1].truth_id = "t_night";
    expect(codes(duplicate)).toContain("SUMMATION_DUPLICATE_TRUTH");
    const short = fresh();
    short.endings[0].summation = [short.endings[0].summation![0]];
    expect(codes(short)).toContain("SCHEMA");
  });
});

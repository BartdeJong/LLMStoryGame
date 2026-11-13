import type { LLMClient } from "../llm/client";
import type { CharacterLineOutput } from "../llm/shapes";
import type { JSONResult } from "../llm/types";
import { rememberAskedAbout, rememberKnowledge, rememberNeed, recordVisit } from "../story/state";
import {
  challengeStatement,
  challengeableStatements,
  evidenceFits,
  findStatement,
  holdsEvidence,
  isStatementBroken,
  markStatementHeard,
  statementIdOfFact,
} from "../story/statements";
import type { EvidenceRef } from "../story/statements";
import type { StoryState } from "../story/state";
import type { CastMember, KnowledgeItem, StoryPack, SubjectRef } from "../story/types";
import { askOptions, isAskable, resolveAsk, returnVisitFor, subjectLabel } from "./askAbout";
import type { AskOptions } from "./askAbout";
import {
  NO_EFFECTS,
  giveItemToCharacter,
  giveOptions,
  handoverEffects,
  handoverPromptLines,
  resolveReadyGoal,
  revealClueFromTalk,
} from "./effects";
import type { AppliedEffects, GiveOption, Handover } from "./effects";
import { availableKnowledge, buildQuickReplies, goalHintLine, QUICK_GOODBYE, QUICK_NEED, retrieveKnowledge } from "./knowledge";
import type { RetrievedFact } from "./knowledge";
import { cleanCharacterLine } from "./lineCleanup";
import { buildDialoguePrompt, buildLineRequest } from "./prompt";
import type { DialogueContext } from "./prompt";
import { isUsableCharacterLine, pickDeflection, repeatsCharacterLine } from "./quality";
import { BASE_TEMPERATURE, generateGreeting } from "./speculation";
import type { GreetingPrefetcher, GreetingResult, LineJob } from "./speculation";
import { Priority } from "../llm/types";
import type { ConversationTurn } from "./types";

export interface DialogueTurn {
  line: string;
  mode: "choices" | "free";
  choices: string[]; // quick replies built by code
  gives: GiveOption[]; // "Give <item>" buttons for items the character's goal needs
  effects: AppliedEffects;
  quality: "generated" | "repaired" | "fallback";
  notice?: string;
}

export interface PlayerReply {
  text: string;
  kind?: "intent";
}

export interface ControllerOptions {
  random?: () => number;
  // Pre-generate likely replies while the player reads. Off unless asked for (the dialogue lab keeps it off).
  speculate?: boolean;
  greetings?: GreetingPrefetcher;
}

export const MAX_RESAMPLES = 2;
export const SPECULATED_TOPICS = 2;
const TEMPERATURE_STEP = 0.1;

// Everything a reply needs, computed without touching state, so it can be generated ahead of time.
interface LineInput {
  facts: readonly RetrievedFact[];
  requestedItems: readonly string[];
  goalHint: string;
  handoverLines: ReturnType<typeof handoverPromptLines>;
  turns: readonly ConversationTurn[];
  ask?: AskedAbout;
  holdStatement: boolean; // a standing statement is among the facts
  admittedTo?: string; // label of the evidence that just broke a statement
  fallbackLine?: string; // authored words to use when the model fails (a statement or an admission)
  key: string;
}

export interface ChallengeOptions {
  statements: { id: string; topic: string; text: string }[];
  evidence: { subject: EvidenceRef; label: string }[];
  locked: boolean; // a challenge already missed in this conversation
}

// The subject of an "Ask about..." turn, kept so the commit step can record it and reveal a reaction's clue.
interface AskedAbout {
  subject: SubjectRef;
  label: string;
  reactionClueId?: string;
}

interface GeneratedLine {
  line: string;
  quality: DialogueTurn["quality"];
  notice?: string;
  cancelled: boolean;
}

interface Speculation {
  key: string;
  job: LineJob;
  abort: AbortController;
  promise: Promise<GeneratedLine | null>;
}

// What the player says when they challenge a statement.
export function challengeLine(topic: string, evidence: string): string {
  return `What you said about "${topic}" does not fit this: ${evidence}`;
}

function asksWhatIsNeeded(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  return normalized === "what do you need"
    || normalized === "what do you need from me"
    || normalized === "what would you need";
}

function reminderFor(character: CastMember, attempt: number): string | undefined {
  if (attempt === 0) return undefined;
  const base = `Reminder: you are ${character.name}, a person. Reply in the first person with spoken words only. Do not start with your name, do not say "welcome to", and do not describe the room or actions.`;
  return attempt === 1 ? base : `${base} Answer the player's last message in one or two plain sentences.`;
}

function failureNotice(result: JSONResult<CharacterLineOutput>, what: string): string | undefined {
  if (result.status === "failed") return `${what} failed: ${result.error ?? "the model did not return a response."}`;
  if (result.status === "cancelled") return `${what} was cancelled.`;
  return undefined;
}

// Runs one conversation with one character. Turns live only in this instance and are never persisted;
// only ids (visits and subjects asked about) go into the story state as the character's memory.
export class ConversationController {
  private readonly turns: ConversationTurn[] = [];
  private readonly discussed = new Set<string>();
  private pendingHandovers: Handover[] = [];
  private lastDeflection: string | undefined;
  private hintTurn = 0;
  private readonly random: () => number;
  private readonly speculationEnabled: boolean;
  private readonly greetings: GreetingPrefetcher | undefined;
  private readonly speculations = new Map<string, Speculation>();
  private speculationCounter = 0;
  private closed = false;
  private challengeLocked = false;

  constructor(
    private readonly client: LLMClient,
    private readonly pack: StoryPack,
    private readonly state: StoryState,
    private readonly character: CastMember,
    private readonly context: DialogueContext,
    options: ControllerOptions = {},
  ) {
    this.random = options.random ?? Math.random;
    this.speculationEnabled = options.speculate === true && client.supportsSpeculation;
    this.greetings = options.greetings;
  }

  getTurns(): readonly ConversationTurn[] {
    return this.turns;
  }

  // Ends the conversation: nothing speculative may keep running or start afterwards.
  close(): void {
    this.closed = true;
    this.cancelSpeculation();
  }

  fallbackTurn(): DialogueTurn {
    this.cancelSpeculation();
    const line = this.deflection();
    this.turns.push({ speaker: "character", text: line });
    return this.makeTurn(line, "fallback", NO_EFFECTS, "The model could not produce a reliable reply; this is an authored fallback.");
  }

  async start(): Promise<DialogueTurn> {
    const effects = this.applyReadyGoal(NO_EFFECTS);
    // Read the memory before this visit is counted, so a first visit is greeted as a stranger.
    const context: DialogueContext = { ...this.context, returnVisit: returnVisitFor(this.pack, this.state, this.character) };
    recordVisit(this.state, this.character.id);
    const prefetched = this.greetings?.take(this.character, context);
    let result: GreetingResult | null = prefetched ? await prefetched : null;
    if (!result) {
      const greetings = this.character.greetings;
      const greeting = greetings[Math.floor(this.random() * greetings.length)] ?? "";
      result = await generateGreeting(
        this.client,
        this.character,
        context,
        greeting,
        { priority: Priority.Dialogue, jobId: "" },
        `greet-${this.character.id}-live`,
      );
    }
    const usable = result?.line != null;
    const line = result?.line ?? result?.greeting ?? "";
    this.turns.push({ speaker: "character", text: line });
    const notice = result === null
      ? "Dialogue generation was cancelled."
      : result.status === "failed" ? `Dialogue generation failed: ${result.error}` : undefined;
    return this.commitTurn(this.makeTurn(line, usable ? "generated" : "fallback", effects, notice));
  }

  reply(reply: string | PlayerReply): Promise<DialogueTurn> {
    const text = typeof reply === "string" ? reply : reply.text;
    const input = this.buildReplyInput(text);
    const adopted = this.adoptSpeculation(text, input.key);
    this.cancelSpeculation();
    this.turns.push({ speaker: "player", text });
    return this.advance(input, NO_EFFECTS, adopted);
  }

  // The player hands over an item. Code applies the pack's goal transition before the model speaks.
  give(itemId: string): Promise<DialogueTurn> {
    const handover = giveItemToCharacter(this.pack, this.state, this.character, itemId);
    if (!handover) throw new Error("The character has no use for that item right now.");
    this.cancelSpeculation();
    const name = this.pack.items.find((item) => item.id === itemId)?.name ?? itemId;
    const playerTurn: ConversationTurn = { speaker: "player", text: `Here, take the ${name}.` };
    this.pendingHandovers.push(handover);
    const input = this.buildInput([], [], [...this.turns, playerTurn]);
    this.turns.push(playerTurn);
    return this.advance(input, handoverEffects(handover));
  }

  // The player asks about a person, an item or a clue. Code picks what may be said (askAbout.ts);
  // a deflection is answered without calling the model.
  askAbout(subject: SubjectRef): Promise<DialogueTurn> {
    if (!isAskable(this.pack, this.state, subject)) throw new Error("The player cannot ask about that.");
    this.cancelSpeculation();
    const resolution = resolveAsk(this.pack, this.state, this.character, subject);
    const playerTurn: ConversationTurn = { speaker: "player", text: `What can you tell me about ${resolution.label}?` };
    if (resolution.source === "deflection") {
      this.turns.push(playerTurn);
      rememberAskedAbout(this.state, this.character.id, subject);
      this.hintTurn += 1;
      const line = this.deflection();
      this.turns.push({ speaker: "character", text: line });
      return Promise.resolve(this.commitTurn(this.makeTurn(line, "fallback", NO_EFFECTS)));
    }
    const input = this.buildInput(resolution.facts, resolution.requestedItems, [...this.turns, playerTurn], {
      subject,
      label: resolution.label,
      ...(resolution.reactionClueId ? { reactionClueId: resolution.reactionClueId } : {}),
    });
    this.turns.push(playerTurn);
    return this.advance(input, NO_EFFECTS);
  }

  askOptions(): AskOptions {
    return askOptions(this.pack, this.state, this.character);
  }

  // Heard, still-standing statements of this character, and everything the player could hold against them.
  challengeOptions(): ChallengeOptions {
    const ask = askOptions(this.pack, this.state, this.character);
    return {
      statements: challengeableStatements(this.state, this.character)
        .map((statement) => ({ id: statement.id, topic: statement.topic, text: statement.text })),
      evidence: [...ask.items, ...ask.evidence].flatMap((entry) =>
        entry.subject.type === "cast" ? [] : [{ subject: entry.subject as EvidenceRef, label: entry.label }]),
      locked: this.challengeLocked,
    };
  }

  // True while Challenge can be used: a heard statement stands and no challenge was missed in this conversation.
  canChallenge(): boolean {
    return !this.challengeLocked && challengeableStatements(this.state, this.character).length > 0;
  }

  // The player holds evidence against a statement. Code decides whether it fits: if so the statement breaks,
  // its clue is found and the model phrases the admission; if not the character brushes it off with an
  // authored line and hears no more challenges in this conversation.
  challenge(statementId: string, evidence: EvidenceRef): Promise<DialogueTurn> {
    if (this.challengeLocked) throw new Error(`${this.character.name} will not hear another challenge right now.`);
    const statement = challengeableStatements(this.state, this.character).find((candidate) => candidate.id === statementId);
    if (!statement) throw new Error("There is no standing statement of this character to challenge.");
    if (!holdsEvidence(this.state, evidence)) throw new Error("The player does not have that evidence.");
    this.cancelSpeculation();
    const label = subjectLabel(this.pack, evidence) ?? evidence.id;
    this.turns.push({ speaker: "player", text: challengeLine(statement.topic, label) });
    const applied = (fits: boolean, revealedClue: string | null): AppliedEffects => ({
      ...NO_EFFECTS,
      revealedClue,
      challenge: { statementId, fits },
    });
    if (!evidenceFits(statement, evidence)) {
      const result = challengeStatement(this.pack, this.state, this.character, statementId, evidence);
      this.challengeLocked = true;
      this.hintTurn += 1;
      const line = statement.rebuff ?? this.deflection();
      this.turns.push({ speaker: "character", text: line });
      return Promise.resolve(this.commitTurn(this.makeTurn(line, "fallback", applied(false, result.revealedClue))));
    }
    const admission: RetrievedFact = {
      item: { id: `statement:${statementId}`, topic: statement.topic, ask: "", text: statement.admission, keywords: [] },
      score: 1,
      explicit: false,
    };
    const input = this.buildInput([admission], [], [...this.turns], undefined, { admittedTo: label, fallbackLine: statement.admission });
    // The admission is worded first; the break is applied with it, so the clue arrives with the words. A
    // cancelled line still breaks the statement (the authored admission is used).
    return this.generateLine(input, { priority: Priority.Dialogue, jobId: "" }, "dialogue").then((generated) => {
      const result = challengeStatement(this.pack, this.state, this.character, statementId, evidence);
      return this.commit(generated, input, applied(true, result.revealedClue));
    });
  }

  private buildReplyInput(text: string): LineInput {
    const facts = retrieveKnowledge(availableKnowledge(this.pack, this.state, this.character), text);
    const requestedItems = asksWhatIsNeeded(text)
      ? (this.character.goal_states.find((goal) => !this.state.resolvedGoalStates.includes(goal.id))?.requires.items ?? [])
        .filter((itemId) => !this.state.itemsHeld.includes(itemId))
      : [];
    return this.buildInput(facts, requestedItems, [...this.turns, { speaker: "player", text }]);
  }

  // Reads state but never changes it.
  private buildInput(
    facts: readonly RetrievedFact[],
    requestedItems: readonly string[],
    turns: readonly ConversationTurn[],
    ask?: AskedAbout,
    challenge?: { admittedTo: string; fallbackLine: string },
  ): LineInput {
    const standingText = (fact: RetrievedFact | undefined): string | undefined => {
      const id = fact ? statementIdOfFact(fact.item.id) : undefined;
      return id && !isStatementBroken(this.state, id) ? findStatement(this.pack, id)?.statement.text : undefined;
    };
    const holdStatement = !challenge && facts.some((fact) => standingText(fact) !== undefined);
    const fallbackLine = challenge?.fallbackLine ?? standingText(facts[0]);
    const goalHint = requestedItems.length > 0
      ? `The player asked what you need. Tell them you need ${requestedItems
        .map((itemId) => this.pack.items.find((item) => item.id === itemId)?.name ?? itemId)
        .join(" and ")}. Do not invent where to find it.`
      : goalHintLine(this.character, this.state, this.hintTurn);
    const handoverLines = handoverPromptLines(this.pack, this.state, this.character, this.pendingHandovers);
    const key = JSON.stringify({
      facts: facts.map((fact) => fact.item.id), requestedItems, goalHint, handoverLines, turns, ask: ask?.label, admitted: challenge?.admittedTo,
    });
    return {
      facts,
      requestedItems,
      goalHint,
      handoverLines,
      turns,
      ...(ask ? { ask } : {}),
      holdStatement,
      ...(challenge ? { admittedTo: challenge.admittedTo } : {}),
      ...(fallbackLine ? { fallbackLine } : {}),
      key,
    };
  }

  // Generates and validates a line for the given input. Changes no conversation or story state.
  private async generateLine(input: LineInput, job: LineJob, idPrefix: string): Promise<GeneratedLine> {
    const promptFacts: KnowledgeItem[] = input.facts.map((fact) => fact.item);
    const previousLines = input.turns.filter((turn) => turn.speaker === "character").map((turn) => turn.text);
    let notice: string | undefined;
    for (let attempt = 0; attempt <= MAX_RESAMPLES; attempt += 1) {
      const prompt = buildDialoguePrompt({
        character: this.character,
        context: this.context,
        turns: input.turns,
        facts: promptFacts,
        goalHint: input.goalHint,
        handoverLines: input.handoverLines,
        askedAbout: input.ask?.label,
        holdStatement: input.holdStatement,
        admittedTo: input.admittedTo,
        reminder: reminderFor(this.character, attempt),
        style: this.client.dialoguePromptStyle,
      });
      job.jobId = `${idPrefix}-${attempt}`;
      const result = await this.client.generateJSON({
        ...buildLineRequest(prompt, { temperature: BASE_TEMPERATURE + TEMPERATURE_STEP * attempt, priority: job.priority, signal: job.signal }),
        id: job.jobId,
      });
      notice ??= failureNotice(result, "Dialogue generation");
      if (result.status === "cancelled") return { line: "", quality: "fallback", notice, cancelled: true };
      if (result.status === "failed") break;
      const candidate = cleanCharacterLine(result.value.line, this.character.name);
      if (isUsableCharacterLine(candidate, this.character.name) && !repeatsCharacterLine(candidate, previousLines)) {
        return { line: candidate, quality: attempt === 0 ? "generated" : "repaired", cancelled: false };
      }
    }
    return { line: "", quality: "fallback", notice, cancelled: false };
  }

  private adoptSpeculation(text: string, key: string): Promise<GeneratedLine | null> | undefined {
    const speculation = this.speculations.get(text);
    if (!speculation || speculation.key !== key) return undefined;
    this.speculations.delete(text);
    speculation.job.priority = Priority.Dialogue;
    this.client.promote(speculation.job.jobId, Priority.Dialogue);
    return speculation.promise;
  }

  private cancelSpeculation(): void {
    for (const speculation of this.speculations.values()) speculation.abort.abort();
    this.speculations.clear();
  }

  // Starts generating the replies the player is most likely to pick next.
  private speculate(choices: readonly string[]): void {
    if (!this.speculationEnabled || this.closed) return;
    const topics = choices.filter((choice) => choice !== QUICK_NEED && choice !== QUICK_GOODBYE).slice(0, SPECULATED_TOPICS);
    for (const text of [...topics, QUICK_NEED]) {
      if (this.speculations.has(text)) continue;
      const input = this.buildReplyInput(text);
      const abort = new AbortController();
      const job: LineJob = { priority: Priority.Speculative, jobId: "", signal: abort.signal };
      const promise = this.generateLine(input, job, `spec-${++this.speculationCounter}`)
        .then((generated) => (generated.cancelled || generated.quality === "fallback" ? null : generated))
        .catch(() => null);
      this.speculations.set(text, { key: input.key, job, abort, promise });
    }
  }

  private commitTurn(turn: DialogueTurn): DialogueTurn {
    this.speculate(turn.choices);
    return turn;
  }

  private deflection(): string {
    const line = pickDeflection(this.character, this.lastDeflection, this.random);
    this.lastDeflection = line;
    return line;
  }

  private applyReadyGoal(effects: AppliedEffects): AppliedEffects {
    const handover = resolveReadyGoal(this.pack, this.state, this.character);
    if (!handover) return effects;
    this.pendingHandovers.push(handover);
    return {
      ...effects,
      resolvedGoal: handover.goalId,
      givenItem: handover.receivedItemId ?? effects.givenItem,
    };
  }

  // Commit step: waits for the line (stored, in flight or fresh), then applies every effect.
  private async advance(
    input: LineInput,
    earlyEffects: AppliedEffects,
    speculated?: Promise<GeneratedLine | null>,
  ): Promise<DialogueTurn> {
    let generated = speculated ? await speculated : null;
    generated ??= await this.generateLine(input, { priority: Priority.Dialogue, jobId: "" }, "dialogue");
    return this.commit(generated, input, earlyEffects);
  }

  private commit(generated: GeneratedLine, input: LineInput, earlyEffects: AppliedEffects): DialogueTurn {
    this.hintTurn += 1;
    let line = generated.line;
    const quality = generated.quality;
    let notice = generated.notice;
    let effects = earlyEffects;
    if (quality === "fallback" && input.fallbackLine) {
      // The authored words are spoken as they are, so a statement or an admission still lands.
      line = input.fallbackLine;
      notice ??= "The model could not produce a reliable reply; these are the character's authored words.";
      effects = this.hearStatements(input.facts.slice(0, 1), effects);
    } else if (quality === "fallback") {
      line = this.deflection();
      notice ??= "The model could not produce a reliable reply; this is an authored fallback.";
    } else {
      effects = this.hearStatements(input.facts, effects);
      this.pendingHandovers = [];
      for (const fact of input.facts) this.discussed.add(fact.item.id);
      for (const fact of input.facts) {
        if (fact.explicit) rememberKnowledge(this.state, this.character.id, fact.item.id);
        if (!fact.explicit || !fact.item.clue_id) continue;
        const revealed = revealClueFromTalk(this.pack, this.state, this.character, fact.item.clue_id);
        if (revealed) effects = { ...effects, revealedClue: revealed };
      }
      for (const itemId of input.requestedItems) rememberNeed(this.state, this.character.id, itemId);
      if (input.ask) {
        rememberAskedAbout(this.state, this.character.id, input.ask.subject);
        if (input.ask.reactionClueId) {
          const revealed = revealClueFromTalk(this.pack, this.state, this.character, input.ask.reactionClueId);
          if (revealed) effects = { ...effects, revealedClue: revealed };
        }
      }
    }
    effects = this.applyReadyGoal(effects);
    this.turns.push({ speaker: "character", text: line });
    return this.commitTurn(this.makeTurn(line, quality, effects, notice));
  }

  // Standing statements among the spoken facts are now heard (journal, Challenge).
  private hearStatements(facts: readonly RetrievedFact[], effects: AppliedEffects): AppliedEffects {
    let result = effects;
    for (const fact of facts) {
      const id = statementIdOfFact(fact.item.id);
      if (!id || isStatementBroken(this.state, id)) continue;
      if (markStatementHeard(this.state, id)) result = { ...result, heardStatement: id };
    }
    return result;
  }

  private knownText(): string {
    const toldFacts = this.pack.cast.flatMap((member) =>
      member.knowledge
        .filter((item) => this.state.knowledgeTold.includes(`${member.id}:${item.id}`))
        .map((item) => item.text),
    );
    const discoveredFacts = [
      ...this.pack.truths.filter((truth) => this.state.truthsFound.includes(truth.id)).map((truth) => truth.text),
      ...this.pack.clues.filter((clue) => this.state.cluesFound.includes(clue.id)).map((clue) => clue.text),
    ];
    return [
      this.context.locationName,
      this.context.storySummary,
      ...(this.context.knownFacts ?? []).map((fact) => fact.text),
      ...(this.context.inventory ?? []).map((item) => item.name),
      this.character.name,
      ...this.turns.map((turn) => turn.text),
      ...toldFacts,
      ...discoveredFacts,
      ...(this.context.knownTerms ?? []),
    ].join(" ");
  }

  // A character with no goal states and no goal hints wants nothing (the epilogue), so "What do you need?" is not offered.
  private hasNeeds(): boolean {
    const hints = this.character.goal_hints;
    return this.character.goal_states.length > 0 || hints.unmet.length + hints.in_progress.length + hints.resolved.length > 0;
  }

  private makeTurn(line: string, quality: DialogueTurn["quality"], effects: AppliedEffects, notice?: string): DialogueTurn {
    const available = availableKnowledge(this.pack, this.state, this.character);
    return {
      line,
      mode: "choices",
      choices: buildQuickReplies(available, this.discussed, this.state, this.knownText(), this.hasNeeds()),
      gives: giveOptions(this.pack, this.state, this.character),
      effects,
      quality,
      ...(notice ? { notice } : {}),
    };
  }
}

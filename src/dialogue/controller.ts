import type { LLMClient } from "../llm/client";
import type { CharacterLineOutput } from "../llm/shapes";
import type { JSONResult } from "../llm/types";
import type { StoryState } from "../story/state";
import type { CastMember, KnowledgeItem, StoryPack } from "../story/types";
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
import { availableKnowledge, buildQuickReplies, goalHintLine, retrieveKnowledge } from "./knowledge";
import type { RetrievedFact } from "./knowledge";
import { cleanCharacterLine } from "./lineCleanup";
import { buildDialoguePrompt, buildGreetingPrompt, buildLineRequest } from "./prompt";
import type { DialogueContext } from "./prompt";
import { isUsableCharacterLine, pickDeflection, repeatsCharacterLine } from "./quality";
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
}

export const MAX_RESAMPLES = 2;
const TEMPERATURE_STEP = 0.1;
const BASE_TEMPERATURE = 0.8;

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

// Runs one conversation with one character. Turns live only in this instance: nothing about a
// conversation is written back to the character or persisted once the player walks away.
export class ConversationController {
  private readonly turns: ConversationTurn[] = [];
  private readonly discussed = new Set<string>();
  private pendingHandovers: Handover[] = [];
  private lastDeflection: string | undefined;
  private hintTurn = 0;
  private readonly random: () => number;

  constructor(
    private readonly client: LLMClient,
    private readonly pack: StoryPack,
    private readonly state: StoryState,
    private readonly character: CastMember,
    private readonly context: DialogueContext,
    options: ControllerOptions = {},
  ) {
    this.random = options.random ?? Math.random;
  }

  getTurns(): readonly ConversationTurn[] {
    return this.turns;
  }

  fallbackTurn(): DialogueTurn {
    const line = this.deflection();
    this.turns.push({ speaker: "character", text: line });
    return this.makeTurn(line, "fallback", NO_EFFECTS, "The model could not produce a reliable reply; this is an authored fallback.");
  }

  async start(): Promise<DialogueTurn> {
    const effects = this.applyReadyGoal(NO_EFFECTS);
    const greetings = this.character.greetings;
    const greeting = greetings[Math.floor(this.random() * greetings.length)] ?? "";
    const result = await this.client.generateJSON(
      buildLineRequest(buildGreetingPrompt(this.character, this.context, greeting), { temperature: BASE_TEMPERATURE }),
    );
    const rephrased = cleanCharacterLine(result.value.line, this.character.name);
    const usable = result.status !== "failed" && result.status !== "cancelled" && isUsableCharacterLine(rephrased, this.character.name);
    const line = usable ? rephrased : greeting;
    this.turns.push({ speaker: "character", text: line });
    return this.makeTurn(line, usable ? "generated" : "fallback", effects, failureNotice(result, "Dialogue generation"));
  }

  reply(reply: string | PlayerReply): Promise<DialogueTurn> {
    const text = typeof reply === "string" ? reply : reply.text;
    this.turns.push({ speaker: "player", text });
    const facts = retrieveKnowledge(availableKnowledge(this.pack, this.state, this.character), text);
    return this.advance(facts, NO_EFFECTS);
  }

  // The player hands over an item. Code applies the pack's goal transition before the model speaks.
  give(itemId: string): Promise<DialogueTurn> {
    const handover = giveItemToCharacter(this.pack, this.state, this.character, itemId);
    if (!handover) throw new Error("The character has no use for that item right now.");
    const name = this.pack.items.find((item) => item.id === itemId)?.name ?? itemId;
    this.turns.push({ speaker: "player", text: `Here, take the ${name}.` });
    this.pendingHandovers.push(handover);
    return this.advance([], handoverEffects(handover));
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

  private async advance(facts: readonly RetrievedFact[], earlyEffects: AppliedEffects): Promise<DialogueTurn> {
    const promptFacts: KnowledgeItem[] = facts.map((fact) => fact.item);
    const goalHint = goalHintLine(this.character, this.state, this.hintTurn);
    this.hintTurn += 1;
    const handoverLines = handoverPromptLines(this.pack, this.state, this.character, this.pendingHandovers);
    const previousLines = this.turns.filter((turn) => turn.speaker === "character").map((turn) => turn.text);

    let line = "";
    let quality: DialogueTurn["quality"] = "fallback";
    let notice: string | undefined;
    for (let attempt = 0; attempt <= MAX_RESAMPLES; attempt += 1) {
      const prompt = buildDialoguePrompt({
        character: this.character,
        context: this.context,
        turns: this.turns,
        facts: promptFacts,
        goalHint,
        handoverLines,
        reminder: reminderFor(this.character, attempt),
      });
      const result = await this.client.generateJSON(
        buildLineRequest(prompt, { temperature: BASE_TEMPERATURE + TEMPERATURE_STEP * attempt }),
      );
      notice ??= failureNotice(result, "Dialogue generation");
      if (result.status === "failed" || result.status === "cancelled") break;
      const candidate = cleanCharacterLine(result.value.line, this.character.name);
      if (isUsableCharacterLine(candidate, this.character.name) && !repeatsCharacterLine(candidate, previousLines)) {
        line = candidate;
        quality = attempt === 0 ? "generated" : "repaired";
        break;
      }
    }

    let effects = earlyEffects;
    if (quality === "fallback") {
      line = this.deflection();
      notice ??= "The model could not produce a reliable reply; this is an authored fallback.";
    } else {
      this.pendingHandovers = [];
      for (const fact of facts) this.discussed.add(fact.item.id);
      for (const fact of facts) {
        if (!fact.explicit || !fact.item.clue_id) continue;
        const revealed = revealClueFromTalk(this.pack, this.state, this.character, fact.item.clue_id);
        if (revealed) effects = { ...effects, revealedClue: revealed };
      }
    }
    effects = this.applyReadyGoal(effects);
    this.turns.push({ speaker: "character", text: line });
    return this.makeTurn(line, quality, effects, notice);
  }

  private makeTurn(line: string, quality: DialogueTurn["quality"], effects: AppliedEffects, notice?: string): DialogueTurn {
    const available = availableKnowledge(this.pack, this.state, this.character);
    return {
      line,
      mode: "choices",
      choices: buildQuickReplies(available, this.discussed, this.state),
      gives: giveOptions(this.pack, this.state, this.character),
      effects,
      quality,
      ...(notice ? { notice } : {}),
    };
  }
}

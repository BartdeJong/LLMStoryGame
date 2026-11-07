import type { LLMClient } from "../llm/client";
import type { DialogueTurnOutput } from "../llm/shapes";
import type { StoryState } from "../story/state";
import type { CastMember, StoryPack } from "../story/types";
import { applyDialogueEffects } from "./effects";
import type { AppliedEffects } from "./effects";
import { buildDialogueRequest } from "./prompt";
import type { DialogueContext } from "./prompt";
import type { ConversationTurn } from "./types";

export interface DialogueTurn {
  line: string;
  mode: "choices" | "free";
  choices: string[];
  effects: AppliedEffects;
}

// Runs one conversation with one character. Turns live only in this instance: nothing about a
// conversation is written back to the character or persisted once the player walks away.
export class ConversationController {
  private readonly turns: ConversationTurn[] = [];

  constructor(
    private readonly client: LLMClient,
    private readonly pack: StoryPack,
    private readonly state: StoryState,
    private readonly character: CastMember,
    private readonly context: DialogueContext,
  ) {}

  getTurns(): readonly ConversationTurn[] {
    return this.turns;
  }

  start(): Promise<DialogueTurn> {
    return this.advance();
  }

  reply(playerText: string): Promise<DialogueTurn> {
    this.turns.push({ speaker: "player", text: playerText });
    return this.advance();
  }

  private async advance(): Promise<DialogueTurn> {
    const result = await this.client.generateJSON(
      buildDialogueRequest(this.character, this.state, this.context, this.turns),
    );
    const output: DialogueTurnOutput = result.value;
    this.turns.push({ speaker: "character", text: output.line });
    const effects = applyDialogueEffects(this.pack, this.state, this.character, output.effects);
    return { line: output.line, mode: output.mode, choices: output.choices, effects };
  }
}

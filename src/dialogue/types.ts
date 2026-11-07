// A single line in the player-character exchange. Conversations are never persisted per character:
// this list exists only for the lifetime of one conversation.
export interface ConversationTurn {
  speaker: "player" | "character";
  text: string;
}

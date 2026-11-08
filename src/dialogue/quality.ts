import type { CastMember } from "../story/types";
import { cleanCharacterLine, rejectionReason } from "./lineCleanup";

export function sanitizeCharacterLine(text: string, characterName = ""): string {
  return cleanCharacterLine(text, characterName);
}

// A cleaned line is usable when it is not narration, not addressed to the player as "you feel...",
// and passes the shared rejection rules (too short, third person, "welcome to <name>", scene text).
export function isUsableCharacterLine(line: string, characterName = ""): boolean {
  if (/^\s*(?:narrator|scene)\s*:/i.test(line)) return false;
  if (/^(?:you\s+(?:think|feel|say|decide)|the player\s+(?:thinks|feels|says|decides))\b/i.test(line)) return false;
  if (/^(?:I|we|he|she|they)\s+(?:walk|walks|turn|turns|smile|smiles|laugh|laughs|nod|nods|hum|hums|look|looks)\s+(?:at|around|back|toward|to)\b/i.test(line)) return false;
  return rejectionReason(line, characterName) === null;
}

// Authored in-character line for questions the model could not answer well. Never the same one
// twice in a row; it never echoes the character sheet or goal text.
export function pickDeflection(character: CastMember, previous?: string, random: () => number = Math.random): string {
  const options = character.deflections.filter((line) => line !== previous);
  const pool = options.length > 0 ? options : character.deflections;
  return pool[Math.floor(random() * pool.length)] ?? "I would rather not say.";
}

function comparableReply(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

export function repeatsCharacterLine(line: string, previousLines: readonly string[]): boolean {
  const current = new Set(comparableReply(line).split(" ").filter((word) => word.length > 2));
  if (current.size < 3) return false;
  return previousLines.some((previous) => {
    const comparable = comparableReply(previous);
    if (comparable === comparableReply(line)) return true;
    const earlier = new Set(comparable.split(" ").filter((word) => word.length > 2));
    if (earlier.size < 3) return false;
    const overlap = [...current].filter((word) => earlier.has(word)).length;
    return overlap / new Set([...current, ...earlier]).size >= 0.8;
  });
}

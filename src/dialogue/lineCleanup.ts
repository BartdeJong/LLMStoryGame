// Pure helpers that clean up and vet one spoken line. Shared by the dialogue controller and the
// story pack validator, so authored lines and model lines are held to the same rules.

export interface CleanupConfig {
  nameVerbs: readonly string[];
  scenePhrases: readonly string[];
  minWords: number;
}

export const DEFAULT_CLEANUP: CleanupConfig = {
  nameVerbs: [
    "is", "was", "has", "had", "will", "would", "says", "said", "asks", "replies", "answers", "whispers", "mumbles",
    "murmurs", "mutters", "listens", "looks", "smiles", "nods", "sighs", "laughs", "chuckles", "grins", "shrugs",
    "frowns", "turns", "walks", "hums", "pauses", "waits", "stands", "steps", "glances", "gestures",
  ],
  scenePhrases: ["The air", "The room", "The sound", "The smell", "The light", "The walls", "The floor", "The shop"],
  minWords: 3,
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function nameAlternatives(name: string): string {
  const full = name.trim();
  const names = [...new Set([full, firstName(full)].filter(Boolean))].sort((a, b) => b.length - a.length);
  return names.map(escapeRegExp).join("|");
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const OPENING_QUOTES = /["\u201c\u2018']/;
const CLOSING_QUOTES = /["\u201d\u2019']/;

// "Bramwell mumbles, 'Aye.'" -> "Aye."  A fully quoted line is unwrapped too.
function extractQuotedSpeech(line: string, name: string, config: CleanupConfig): string {
  const text = line.trim();
  const last = text.at(-1);
  if (!last || !CLOSING_QUOTES.test(last)) return text;
  for (let index = 0; index < text.length - 1; index += 1) {
    const char = text[index]!;
    if (!OPENING_QUOTES.test(char)) continue;
    // A single quote inside a word is an apostrophe, not the start of speech.
    const before = text[index - 1];
    if (char === "'" && before !== undefined && !/[\s,:]/.test(before)) continue;
    if (/\s/.test(text[index + 1] ?? " ")) continue;
    const preamble = text.slice(0, index).trim().replace(/[,:]$/, "").trim();
    const content = text.slice(index + 1, -1).trim();
    if (!content) return text;
    if (!preamble) return content;
    const mentionsName = new RegExp(`\\b(?:${nameAlternatives(name)})\\b`, "i").test(preamble);
    const hasVerb = new RegExp(`\\b(?:${config.nameVerbs.join("|")})\\b`, "i").test(preamble);
    return wordCount(preamble) <= 8 && (mentionsName || hasVerb) ? content : text;
  }
  return text;
}

function fixDoubledPunctuation(text: string): string {
  return text
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([!?])[.,]+/g, "$1")
    .replace(/,+([.!?])/g, "$1")
    .replace(/,{2,}/g, ",")
    .replace(/!{2,}/g, "!")
    .replace(/\?{2,}/g, "?")
    .replace(/(?<!\.)\.{2}(?!\.)/g, ".")
    .replace(/\.{4,}/g, "...");
}

// Order matters: trim, quoted speech, name prefix, markup, punctuation, whitespace.
export function cleanCharacterLine(raw: string, name = "", config: CleanupConfig = DEFAULT_CLEANUP): string {
  let line = raw.trim();
  line = extractQuotedSpeech(line, name, config);
  if (name.trim()) {
    const prefix = new RegExp(`^(?:(?:${nameAlternatives(name)})\\s*:\\s*)+`, "i");
    line = line.replace(prefix, "");
  }
  line = line.replace(/\*[^*]*\*/g, " ").replace(/\([^)]*\)/g, " ");
  line = fixDoubledPunctuation(line);
  return line.replace(/\s+/g, " ").trim();
}

// Why a cleaned line cannot be shown, or null when it is fine.
export function rejectionReason(line: string, name: string, config: CleanupConfig = DEFAULT_CLEANUP): string | null {
  if (!line) return "empty";
  if (wordCount(line) < config.minWords) return "too short";
  const names = nameAlternatives(name);
  if (names) {
    if (new RegExp(`^(?:${names})\\s+(?:${config.nameVerbs.join("|")})\\b`, "i").test(line)) {
      return "speaks about the character in the third person";
    }
    if (new RegExp(`\\bwelcome to (?:the )?(?:${names})\\b`, "i").test(line)) return "treats the character's name as a place";
  }
  for (const phrase of config.scenePhrases) {
    if (new RegExp(`^${escapeRegExp(phrase)}\\b`, "i").test(line)) return "describes the scene";
  }
  return null;
}

// Used on authored text: it must already be clean spoken words, so cleaning must not change it.
export function narrationIssue(text: string, name: string): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (cleanCharacterLine(text, name) !== collapsed) return "contains narration, quotes, markup or a name prefix";
  return rejectionReason(collapsed, name, { ...DEFAULT_CLEANUP, minWords: 1 });
}

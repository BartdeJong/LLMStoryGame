// Story pack types. Keep in sync with tools/story-forge/schema/story-pack.schema.json
// (a unit test checks that the example pack passes the schema).

import type { GlyphCategory, VisualSpec } from "../art/glyphs";
import type { PaletteName } from "../art/palettes";
import type { SpriteSpec } from "../art/spriteSpec";
import type { Biome, FloorStyle, WallStyle } from "../world/types";

// Names a story's length. A pack defines exactly one of them (the longest version; see storyLengthOf).
export const LENGTH_IDS = ["short", "medium", "long"] as const;
export type LengthId = (typeof LENGTH_IDS)[number];

export type SourceKind = "location" | "character";
export interface SourceRef {
  type: SourceKind;
  id: string;
}

// What the player must have before something becomes possible. All entries must hold.
export interface Requirement {
  items?: string[];
  goal_states?: string[];
  truths?: string[];
}

// Who the player is in this story, and how the player looks on screen and in dialogue.
export interface PlayerCharacter {
  name: string;
  species: string;
  description: string;
  sprite: SpriteSpec;
}

export interface Identity {
  id: string;
  version: number;
  title: string;
  logline: string;
  setting: string;
  tone: string;
  themes: string[];
  content_notes: string[];
  player: PlayerCharacter;
}

export interface StyleExample {
  cast_id: string;
  lines: string[];
}

export interface StyleGuide {
  narrator_voice: string;
  use: string[];
  avoid: string[];
  naming_conventions: string;
  examples: StyleExample[];
}

export interface GoalState {
  id: string;
  description: string;
  requires: Requirement;
  gives_items?: string[];
  reveals?: string;
}

export interface Relationship {
  cast_id: string;
  relation: string;
}

// A fact a character can tell. Code retrieves these by keyword; the model only phrases them.
export interface KnowledgeItem {
  id: string;
  topic: string; // at most 3 words
  ask: string; // what a player would naturally say to bring this up
  text: string;
  keywords: string[];
  clue_id?: string; // telling this fact explicitly marks the clue as found
  truth_id?: string;
}

export type SubjectType = "cast" | "item" | "clue";
export interface SubjectRef {
  type: SubjectType;
  id: string;
}

// An authored answer to "ask about <subject>". Optional; a clue_id marks that clue found when it is said.
export interface Reaction {
  id: string;
  about: SubjectRef;
  text: string;
  requires?: Requirement;
  clue_id?: string;
}

// Evidence that breaks a statement: any one listed item the player holds or clue they found is enough.
export interface StatementEvidence {
  items?: string[];
  clues?: string[];
}

// What backs a deduction or summation answer: the player shows items and clues from this list.
export interface Proof extends StatementEvidence {
  required?: number; // how many listed pieces must be shown; default 1, at most PROOF_SLOTS
}

// Something a character claims that is false or leaves out the important part. The player hears it in
// conversation, finds evidence against it and challenges it; code decides whether the evidence fits. The
// admission is never shown to the model before the statement is broken.
export interface Statement {
  id: string;
  topic: string; // at most 3 words
  ask: string; // what a player would naturally say to bring this up
  keywords: string[];
  text: string; // the cover story, spoken in the character's voice
  requires?: Requirement; // when the statement can be heard
  broken_by: StatementEvidence;
  admission: string; // what the character admits once the statement is broken
  clue_id?: string; // the clue the admission reveals
  rebuff?: string; // authored line when a challenge does not fit (a deflection is used otherwise)
}

export interface GoalHints {
  unmet: string[];
  in_progress: string[];
  resolved: string[];
}

export interface CastMember {
  id: string;
  name: string;
  species: string;
  personality: string;
  goal: string;
  secret: string;
  motivations: string[];
  relationships: Relationship[];
  sprite: SpriteSpec; // layered look of the character (src/art/spriteSpec.ts)
  home_location: string;
  knows_truths: string[];
  goal_states: GoalState[];
  voice_notes: string;
  greetings: string[];
  knowledge: KnowledgeItem[];
  goal_hints: GoalHints;
  deflections: string[];
  reactions?: Reaction[];
  statements?: Statement[];
}

export type Importance = "core" | "side";
// A truth with a deduction is confirmed by the player choosing the right answer, not by finding a clue.
export interface Deduction {
  question: string;
  answer: string;
  wrong_answers: string[]; // 2-3 plausible but wrong options
  rules_out?: string[]; // red herring ids settled when the player answers correctly
  proof?: Proof; // evidence that backs the answer; without it one click settles the question
}

export interface Truth {
  id: string;
  text: string;
  depends_on: string[];
  importance: Importance;
  revealed_by: string[];
  deduction?: Deduction;
}

export type ClueKind = "spoken" | "object" | "place" | "item_combination";
export interface Clue {
  id: string;
  truth_id?: string; // absent for clues that only set up a twist or red herring
  kind: ClueKind;
  where: SourceRef;
  alternatives: SourceRef[]; // other places the same clue can be found
  object_id?: string; // location object the clue is attached to: examining it finds the clue (see "Clue anchors")
  requirements: Requirement;
  text: string;
  locked_glimpse?: string; // shown when the object is examined while the requirements are unmet
  reveal_text?: string; // announced when the requirements become met
}

export interface Item {
  id: string;
  name: string;
  description: string;
  icon_recipe: string;
  visual?: VisualSpec;
  visualInferred?: boolean;
  key: boolean; // key items can never be missable
  found_at?: SourceRef;
  found_requires?: Requirement;
  purpose: string;
}

// A door lock. The optional texts make it explain itself in-world; without them the game derives text.
export interface DoorLock extends Requirement {
  reason?: string; // shown when the player tries the door
  lead?: string; // the journal note: who or what opens it
  unlock_text?: string; // announced when it opens
}

export interface Door {
  id: string;
  to: string;
  lock?: DoorLock; // doors work in both directions
}

export interface WorldObject {
  id: string;
  name: string;
  description: string;
  visual?: VisualSpec;
  visualInferred?: boolean;
}

export interface VisualRequest {
  name: string;
  description: string;
  suggested_category: GlyphCategory;
}

// Pre-written surface for a location, so the game does not have to generate it while the player waits.
export interface AreaDoorText {
  to: string; // a neighbouring location id (doors work in both directions)
  label: string; // at most 4 words, shown on the sign
  hint: string;
}

// Everything about a place is baked into the pack ahead of time (Story Forge bake step); nothing is
// generated while the game runs. Map format: src/world/mapLegend.ts.
export interface AuthoredArea {
  description: string; // 1-2 sentences shown on arrival
  doors: AreaDoorText[]; // map digit n is doors[n - 1]
  biome: Biome; // drives door look, lighting and ambience
  palette: PaletteName;
  floor: FloorStyle;
  wall: WallStyle;
  map: string[];
  // Tile for each story thing that can appear here, keyed by pack id: location object, item found here or
  // required character. Clues have no tile of their own; they belong to the object they are anchored to.
  // Things missing from the current length are not placed.
  placements: Record<string, [number, number]>;
  decor: { icon: string; x: number; y: number }[];
}

export interface Location {
  id: string;
  name: string;
  biome: string;
  mood: string;
  palette: string;
  role: string;
  hub: boolean;
  required_characters: string[];
  objects: WorldObject[];
  doors: Door[];
  area?: AuthoredArea;
}

export interface Twist {
  id: string;
  description: string;
  setup_clues: string[];
  payoff_trigger: Requirement;
}

export interface RedHerring {
  id: string;
  description: string;
  setup_clues: string[];
  resolution: string;
}

export interface EndingConditions {
  truths: string[];
  goal_states: string[];
  choices: string[]; // key choices the player is free to make
}

export interface SummationEntry {
  question: string;
  truth_id: string; // must be one of the ending's condition truths
  proof?: Proof;
}

// Plays instead of the normal ending when the player's case record is flawed (src/story/caseRecord.ts).
export interface FlawedEnding {
  scene_outline: string;
  tone: string;
  epilogue_notes: string;
}

export interface Ending {
  id: string;
  conditions: EndingConditions;
  summation?: SummationEntry[]; // 2-4 questions the player answers from confirmed truths before this ending

  scene_outline: string;
  tone: string;
  epilogue_notes: string;
  flawed?: FlawedEnding;
}

export interface Beat {
  id: string;
  title: string;
  objective?: string;
  guidance?: string;
  gate_reason?: string; // why this beat's places stay shut until the previous beat's must_find holds
  unlock_text?: string; // announced when they open
  locations: string[];
  must_find: Requirement; // must hold before the next beat opens
}

export interface StoryOpening {
  context: string;
}

export interface Subplot {
  id: string;
  title: string;
  description: string;
  cast: string[];
  truths: string[];
}

// Someone present after the ending. `endings` limits them to those endings (all endings when absent).
export interface EpilogueCast {
  id: string;
  at: [number, number]; // tile in the epilogue location's area
  greeting: string; // authored first line after the ending; the model rephrases it lightly
  endings?: string[];
}

// After the ending the player walks around one area and talks with the people who belong in the ending.
export interface Epilogue {
  location: string;
  description: string; // arrival caption
  objective: string; // shown in the objective HUD
  join_label: string; // the ending screen's button into the epilogue
  door_message: string; // said when the player tries to leave
  player_sprite?: SpriteSpec; // the player's look after the ending (Paddington wears his hat again)
  deflections: string[]; // small talk when a character has nothing to add
  cast: EpilogueCast[];
}

export interface LengthDefinition {
  target_minutes: number;
  start_location: string;
  opening?: StoryOpening;
  epilogue?: Epilogue;
  cast: string[];
  core_truths: string[];
  side_truths: string[];
  subplots: Subplot[];
  twists: string[];
  red_herrings: string[];
  endings: string[];
  beats: Beat[];
}

export interface StoryPack {
  schema_version: number;
  identity: Identity;
  style_guide: StyleGuide;
  cast: CastMember[];
  truths: Truth[];
  clues: Clue[];
  items: Item[];
  visual_requests?: VisualRequest[];
  locations: Location[];
  twists: Twist[];
  red_herrings: RedHerring[];
  endings: Ending[];
  lengths: Partial<Record<LengthId, LengthDefinition>>;
}

// A story has exactly one length: the longest version. It is named here and defined in the pack's `lengths`.
export interface StoryIndexEntry {
  id: string;
  title: string;
  logline: string;
  length: LengthId;
  estimated_minutes?: number;
}

export interface StoryIndex {
  stories: StoryIndexEntry[];
}


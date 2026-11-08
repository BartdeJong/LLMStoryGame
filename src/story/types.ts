// Story pack types. Keep in sync with tools/story-forge/schema/story-pack.schema.json
// (a unit test checks that the example pack passes the schema).

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

export interface Identity {
  id: string;
  version: number;
  title: string;
  logline: string;
  setting: string;
  tone: string;
  themes: string[];
  content_notes: string[];
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
  sprite_recipe: string;
  home_location: string;
  knows_truths: string[];
  goal_states: GoalState[];
  voice_notes: string;
  greetings: string[];
  knowledge: KnowledgeItem[];
  goal_hints: GoalHints;
  deflections: string[];
}

export type Importance = "core" | "side";
export interface Truth {
  id: string;
  text: string;
  depends_on: string[];
  importance: Importance;
  revealed_by: string[];
}

export type ClueKind = "spoken" | "object" | "place" | "item_combination";
export interface Clue {
  id: string;
  truth_id?: string; // absent for clues that only set up a twist or red herring
  kind: ClueKind;
  where: SourceRef;
  alternatives: SourceRef[]; // other places the same clue can be found
  requirements: Requirement;
  text: string;
}

export interface Item {
  id: string;
  name: string;
  description: string;
  icon_recipe: string;
  key: boolean; // key items can never be missable
  found_at?: SourceRef;
  found_requires?: Requirement;
  purpose: string;
}

export interface Door {
  id: string;
  to: string;
  lock?: Requirement; // doors work in both directions
}

export interface WorldObject {
  id: string;
  name: string;
  description: string;
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

export interface Ending {
  id: string;
  conditions: EndingConditions;
  scene_outline: string;
  tone: string;
  epilogue_notes: string;
}

export interface Beat {
  id: string;
  title: string;
  objective?: string;
  guidance?: string;
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

export interface LengthDefinition {
  target_minutes: number;
  start_location: string;
  opening?: StoryOpening;
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
  locations: Location[];
  twists: Twist[];
  red_herrings: RedHerring[];
  endings: Ending[];
  lengths: Partial<Record<LengthId, LengthDefinition>>;
}

export interface StoryIndexEntry {
  id: string;
  title: string;
  logline: string;
  lengths: LengthId[];
  estimated_minutes: Partial<Record<LengthId, number>>;
}

export interface StoryIndex {
  stories: StoryIndexEntry[];
}

export const SCHEMA_VERSION = 2;

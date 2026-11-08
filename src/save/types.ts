import type { StoryAreaBrief } from "../story/briefs";
import type { LengthId } from "../story/types";
import type { StoryState } from "../story/state";
import type { Area } from "../world/types";

export const SAVE_FORMAT_VERSION = 3;

export interface SaveMetadata {
  storyTitle: string;
  length: LengthId;
  timePlayedMs: number;
  lastSaved: string;
}

export interface SavedArea {
  area: Area;
  brief: StoryAreaBrief;
}

export interface PlayerSave {
  areaId: string;
  x: number;
  y: number;
}

export interface GameSave {
  formatVersion: number;
  slotId: string;
  metadata: SaveMetadata;
  worldSeed: string;
  packId: string;
  packVersion: number;
  length: LengthId;
  storyState: StoryState;
  areas: SavedArea[];
  player: PlayerSave;
}

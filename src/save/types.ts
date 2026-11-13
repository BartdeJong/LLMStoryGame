import type { LengthId } from "../story/types";
import type { StoryState } from "../story/state";

export const SAVE_FORMAT_VERSION = 8;

export interface SaveMetadata {
  storyTitle: string;
  length: LengthId;
  timePlayedMs: number;
  lastSaved: string;
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
  areaIds: string[]; // visited areas; each is rebuilt from the story pack on load
  player: PlayerSave;
}

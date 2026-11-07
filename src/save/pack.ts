import { loadStoryPack } from "../story/loader";
import type { StoryPack } from "../story/types";
import type { GameSave } from "./types";

export class SavePackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavePackError";
  }
}

export async function loadPackForSave(
  save: GameSave,
  load: (packId: string) => Promise<StoryPack> = loadStoryPack,
): Promise<StoryPack> {
  let pack: StoryPack;
  try {
    pack = await load(save.packId);
  } catch (error) {
    throw new SavePackError(
      `This save needs story "${save.packId}" version ${save.packVersion}, but that story could not be loaded. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (pack.identity.version !== save.packVersion) {
    throw new SavePackError(
      `This save needs story "${save.packId}" version ${save.packVersion}, but version ${pack.identity.version} is available. The save has not been changed.`,
    );
  }
  return pack;
}

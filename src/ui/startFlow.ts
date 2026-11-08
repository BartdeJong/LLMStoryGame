import { Game } from "../game";
import { LLMClient } from "../llm/client";
import { BedrockGatewayBackend } from "../llm/bedrockGatewayBackend";
import { MockBackend } from "../llm/mock";
import type { LLMProviderSettings } from "../llm/providerSettings";
import { checkSupport } from "../llm/support";
import { WebLLMBackend } from "../llm/webllmBackend";
import { storyMockRespond } from "../story/mockResponder";
import { StorySession } from "../story/storySession";
import { mountUnsupportedScreen, runModelSetup } from "./modelScreens";
import { mountStorySelectScreen } from "./storySelect";
import { mountStoryOpeningScreen } from "./storyOpening";
import { mountTitleScreen } from "./title";
import { getLengthView, type LengthView } from "../story/loader";
import type { StoryPack } from "../story/types";
import { SaveRepository, requestPersistentStorage } from "../save/repository";
import { loadPackForSave } from "../save/pack";
import { mountLoadGameScreen, mountSaveSlotPicker } from "../save/screens";
import type { GamePersistence } from "../game";
import type { GameSave } from "../save/types";
import { mountProviderSetup } from "./providerSetup";

const SCREEN_CLASS = "llm-debug-mode"; // lets the menu screens scroll; removed when the game starts

function note(text: string): HTMLElement {
  const box = document.createElement("section");
  box.className = "llm-screen";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  box.append(paragraph);
  return box;
}

// Start flow: device check, model setup, story and length choice, first area, then the game itself.
// `?mock=1` swaps in the mock LLM so the whole flow runs without WebGPU or a download.
export async function startGame(shell: HTMLElement, root: HTMLElement, useMock: boolean): Promise<void> {
  document.documentElement.classList.add(SCREEN_CLASS);
  document.body.classList.add(SCREEN_CLASS);
  shell.remove();

  const providerSettings: LLMProviderSettings | undefined = useMock ? undefined : await mountProviderSetup(root);
  if (!useMock && providerSettings?.provider === "local") {
    const report = await checkSupport();
    if (!report.supported) {
      mountUnsupportedScreen(root, report);
      const link = document.createElement("a");
      link.className = "llm-button";
      link.href = "?mock=1";
      link.textContent = "Try with the mock storyteller";
      root.querySelector(".llm-screen")?.append(link);
      return;
    }
  }

  let storageNote = "";
  try {
    if (!await requestPersistentStorage()) {
      storageNote = "This browser may clear saved games. Export your saves from Load Game as backups.";
    }
  } catch (error) {
    storageNote = `Persistent storage could not be enabled: ${error instanceof Error ? error.message : String(error)}. Export saves as backups.`;
  }
  const saves = new SaveRepository();
  const client = new LLMClient(
    useMock
      ? new MockBackend({ delayMs: 120, respond: storyMockRespond })
      : providerSettings?.provider === "bedrock"
        ? new BedrockGatewayBackend({
          endpoint: providerSettings.bedrockEndpoint,
          token: providerSettings.bedrockToken,
        })
        : new WebLLMBackend(),
  );
  if (useMock) await client.load();
  else if (providerSettings?.provider === "bedrock") await client.load("bedrock");
  else await runModelSetup(root, client);

  const canvas = shell.querySelector<HTMLCanvasElement>("#game");
  const joystick = shell.querySelector<HTMLButtonElement>("#joystick");
  const actionButton = shell.querySelector<HTMLButtonElement>("#action-button");
  const pauseButton = shell.querySelector<HTMLButtonElement>("#pause-button");
  const message = shell.querySelector<HTMLElement>("#game-message");
  if (!canvas || !joystick || !actionButton || !pauseButton || !message) throw new Error("The game page is missing required controls.");

  const startSession = (
    story: StorySession,
    startArea: import("../world/types").Area,
    persistence: GamePersistence,
  ): void => {
    document.documentElement.classList.remove(SCREEN_CLASS);
    document.body.classList.remove(SCREEN_CLASS);
    root.replaceChildren(shell);
    new Game(
      canvas,
      joystick,
      actionButton,
      pauseButton,
      message,
      story,
      startArea,
      root,
      chooseNewGame,
      backToTitle,
      persistence,
      (save) => beginLoadedGame(save),
    ).start();
  };
  const chooseStory = (slotId: string): void => {
    document.documentElement.classList.add(SCREEN_CLASS);
    document.body.classList.add(SCREEN_CLASS);
    void mountStorySelectScreen(
      root,
      (view, pack) => { void beginStory(view, pack, slotId); },
      chooseNewGame,
    );
  };
  const chooseNewGame = (): void => {
    void mountSaveSlotPicker(root, saves, chooseStory, backToTitle);
  };
  const chooseLoadGame = (): void => {
    void mountLoadGameScreen(root, saves, beginLoadedGame, backToTitle);
  };
  const backToTitle = (): void => mountTitleScreen(root, chooseNewGame, chooseLoadGame, storageNote);
  const beginStory = async (view: LengthView, pack: StoryPack, slotId: string): Promise<void> => {
    root.replaceChildren(note("Setting the scene..."));
    try {
      const story = new StorySession(pack, view, client);
      const startArea = await story.start();
      const persistence = { repository: saves, slotId, timePlayedMs: 0 };
      if (view.definition.opening) {
        mountStoryOpeningScreen(root, story, () => startSession(story, startArea, persistence));
      } else {
        startSession(story, startArea, persistence);
      }
    } catch (error) {
      root.replaceChildren(note(`Could not start the story: ${error instanceof Error ? error.message : String(error)}`));
    }
  };
  const beginLoadedGame = async (save: GameSave): Promise<void> => {
    const pack = await loadPackForSave(save);
    const view = getLengthView(pack, save.length);
    const story = new StorySession(pack, view, client, undefined, save.worldSeed);
    story.restoreSave(save);
    const startArea = story.getArea(save.player.areaId);
    startSession(story, startArea, {
      repository: saves,
      slotId: save.slotId,
      timePlayedMs: save.metadata.timePlayedMs,
      player: save.player,
    });
  };
  mountTitleScreen(root, chooseNewGame, chooseLoadGame, storageNote);
}

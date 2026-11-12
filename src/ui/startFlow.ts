import { Game } from "../game";
import { LLMClient } from "../llm/client";
import { BedrockGatewayBackend } from "../llm/bedrockGatewayBackend";
import { saveSelectedLocalModelId } from "../llm/config";
import { MockBackend } from "../llm/mock";
import { saveLLMProviderSettings } from "../llm/providerSettings";
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
import type { ProviderSetupSelection } from "./providerSetup";

const SCREEN_CLASS = "llm-debug-mode"; // lets the menu screens scroll; removed when the game starts

function note(text: string): HTMLElement {
  const box = document.createElement("section");
  box.className = "llm-screen";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  box.append(paragraph);
  return box;
}

function showActionScreen(
  root: HTMLElement,
  text: string,
  actions: readonly { label: string; run: () => void }[],
): void {
  const box = note(text);
  for (const action of actions) {
    const button = document.createElement("button");
    button.className = "llm-button";
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", action.run);
    box.append(button);
  }
  root.replaceChildren(box);
}

// Start flow: device check, model setup, story and length choice, first area, then the game itself.
// `?mock=1` swaps in the mock LLM so the whole flow runs without WebGPU or a download.
export async function startGame(shell: HTMLElement, root: HTMLElement, useMock: boolean): Promise<void> {
  document.documentElement.classList.add(SCREEN_CLASS);
  document.body.classList.add(SCREEN_CLASS);
  shell.remove();

  let selection: ProviderSetupSelection | undefined = useMock ? undefined : await mountProviderSetup(root);
  if (!useMock && !selection) return;
  if (selection?.settings.provider === "local") {
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
  const createClient = (providerSelection: ProviderSetupSelection | undefined): LLMClient => new LLMClient(
    useMock
      ? new MockBackend({ delayMs: 120, respond: storyMockRespond })
      : providerSelection?.settings.provider === "bedrock"
        ? new BedrockGatewayBackend({
          endpoint: providerSelection.settings.bedrockEndpoint,
          token: providerSelection.settings.bedrockToken,
        })
        : new WebLLMBackend(),
  );
  let client = createClient(selection);
  const loadSelection = async (
    target: LLMClient,
    providerSelection: ProviderSetupSelection,
    allowCancel = false,
  ): Promise<boolean> => {
    if (providerSelection.settings.provider === "bedrock") {
      await target.load("bedrock");
      return true;
    }
    if (allowCancel) {
      return (await runModelSetup(root, target, providerSelection.modelId, true)) !== undefined;
    }
    await runModelSetup(root, target, providerSelection.modelId);
    return true;
  };
  if (useMock) await client.load();
  else if (selection) await loadSelection(client, selection);

  const canvas = shell.querySelector<HTMLCanvasElement>("#game");
  const joystick = shell.querySelector<HTMLButtonElement>("#joystick");
  const actionButton = shell.querySelector<HTMLButtonElement>("#action-button");
  const mapButton = shell.querySelector<HTMLButtonElement>("#map-button");
  const pauseButton = shell.querySelector<HTMLButtonElement>("#pause-button");
  const message = shell.querySelector<HTMLElement>("#game-message");
  if (!canvas || !joystick || !actionButton || !mapButton || !pauseButton || !message) throw new Error("The game page is missing required controls.");

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
      mapButton,
      pauseButton,
      message,
      story,
      startArea,
      root,
      chooseNewGame,
      backToTitle,
      useMock ? undefined : (slotId) => changeAISettings(slotId),
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
      const startArea = story.start();
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
    const story = new StorySession(pack, view, client, save.worldSeed);
    story.restoreSave(save);
    const startArea = story.getArea(save.player.areaId);
    startSession(story, startArea, {
      repository: saves,
      slotId: save.slotId,
      timePlayedMs: save.metadata.timePlayedMs,
      player: save.player,
    });
  };
  const restorePreviousGame = async (
    save: GameSave,
    previousClient: LLMClient,
    previousSelection: ProviderSetupSelection,
    reload: boolean,
  ): Promise<void> => {
    if (reload) await loadSelection(previousClient, previousSelection);
    saveLLMProviderSettings(previousSelection.settings);
    saveSelectedLocalModelId(previousSelection.modelId);
    selection = previousSelection;
    client = previousClient;
    await beginLoadedGame(save);
  };
  const changeAISettings = async (slotId: string): Promise<void> => {
    const previousSelection = selection;
    if (!previousSelection) throw new Error("The current AI settings are unavailable.");
    const previousClient = client;
    let save: GameSave;
    try {
      const currentSave = await saves.get(slotId);
      if (!currentSave) throw new Error("The current game save could not be found.");
      save = currentSave;
    } catch (error) {
      showActionScreen(root, `Could not open AI settings: ${error instanceof Error ? error.message : String(error)}`, [
        { label: "Return to title", run: () => mountTitleScreen(root, chooseNewGame, chooseLoadGame, storageNote) },
      ]);
      return;
    }

    const returnToPrevious = (reload: boolean): void => {
      void restorePreviousGame(save, previousClient, previousSelection, reload).catch((error: unknown) => {
        showActionScreen(root, `Could not return to the saved game: ${error instanceof Error ? error.message : String(error)}.`, [
          { label: "Try again", run: () => returnToPrevious(reload) },
          { label: "Choose AI settings again", run: () => { void changeAISettings(slotId); } },
        ]);
      });
    };

    let previousUnloaded = false;
    let nextClient: LLMClient | null = null;
    try {
      const requested = await mountProviderSetup(root, true);
      if (!requested) {
        await restorePreviousGame(save, previousClient, previousSelection, false);
        return;
      }

      if (requested.settings.provider === "local") {
        const report = await checkSupport();
        if (!report.supported) {
          showActionScreen(root, report.reason ?? "The on-device model cannot run on this device.", [
            { label: "Choose another AI provider", run: () => { void changeAISettings(slotId); } },
            { label: "Return to game", run: () => returnToPrevious(false) },
          ]);
          return;
        }
      }

      previousUnloaded = true;
      await previousClient.unload();
      nextClient = createClient(requested);
      if (!await loadSelection(nextClient, requested, true)) {
        await restorePreviousGame(save, previousClient, previousSelection, true);
        return;
      }
      selection = requested;
      client = nextClient;
      await beginLoadedGame(save);
    } catch (error) {
      if (nextClient) {
        try {
          await nextClient.unload();
        } catch (unloadError) {
          console.error("Could not unload the replacement storyteller.", unloadError);
        }
      }
      try {
        await restorePreviousGame(save, previousClient, previousSelection, previousUnloaded);
        message.textContent = `AI settings were not changed: ${error instanceof Error ? error.message : String(error)}. Your previous game was restored.`;
      } catch (restoreError) {
        showActionScreen(
          root,
          `Could not change AI settings (${error instanceof Error ? error.message : String(error)}), and the previous storyteller could not be restored (${restoreError instanceof Error ? restoreError.message : String(restoreError)}). Your save is safe.`,
          [
            {
              label: "Retry previous storyteller",
              run: () => {
                void restorePreviousGame(save, previousClient, previousSelection, true).catch((retryError: unknown) => {
                  showActionScreen(root, `Could not restore the previous storyteller: ${retryError instanceof Error ? retryError.message : String(retryError)}.`, [
                    { label: "Try again", run: () => { void changeAISettings(slotId); } },
                  ]);
                });
              },
            },
            { label: "Choose AI settings again", run: () => { void changeAISettings(slotId); } },
          ],
        );
      }
    }
  };
  mountTitleScreen(root, chooseNewGame, chooseLoadGame, storageNote);
}

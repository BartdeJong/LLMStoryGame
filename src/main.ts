import "./style.css";
import { soundEffects } from "./audio/soundEffects";
import { mountArtDebugScreen } from "./art/debug";
import { mountWorldDebugScreen } from "./world/debug";
import { applySavedTextSize } from "./ui/preferences";
import { keepScreenAwake } from "./ui/screenWakeLock";
import { gamepadInput } from "./input/gamepad";
import { trackInputMode } from "./input/mode";

applySavedTextSize();
trackInputMode();

let toastTimer = 0;
let toastElement: HTMLElement | null = null;
gamepadInput.onConnection((connected) => {
  const text = connected ? "Controller connected" : "Controller disconnected";
  const message = document.querySelector<HTMLElement>("#game-message");
  if (message) {
    const previous = message.textContent;
    message.textContent = text;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      if (message.isConnected && message.textContent === text) message.textContent = previous;
    }, 1800);
    return;
  }
  toastElement?.remove();
  toastElement = document.createElement("div");
  toastElement.className = "controller-toast";
  toastElement.setAttribute("role", "status");
  toastElement.textContent = text;
  document.body.append(toastElement);
  window.setTimeout(() => {
    toastElement?.remove();
    toastElement = null;
  }, 1800);
});
gamepadInput.start();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .catch((error: unknown) => console.error("Could not register the offline service worker.", error));
}

const unlockAudio = (): void => {
  window.removeEventListener("pointerdown", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
  void soundEffects.unlock().catch((error: unknown) => console.warn("Audio could not be unlocked.", error));
};
window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });

const debugMode = new URLSearchParams(window.location.search).get("debug");
if (debugMode === "icons") {
  void import("./art/glyphs/debug").then(({ mountGlyphDebugScreen }) => mountGlyphDebugScreen());
} else if (debugMode === "story-visuals") {
  const storyId = new URLSearchParams(window.location.search).get("story");
  if (storyId) {
    void import("./art/glyphs/debug").then(({ mountStoryVisualDebugScreen }) => mountStoryVisualDebugScreen(storyId));
  } else {
    document.body.textContent = "Add a story id with ?debug=story-visuals&story=<id>.";
  }
} else if (debugMode === "art") {
  mountArtDebugScreen();
} else if (debugMode === "world") {
  mountWorldDebugScreen();
} else if (debugMode === "llm") {
  void import("./llm/debug").then((module) => module.mountLLMDebugScreen());
} else if (debugMode === "dialogue" && import.meta.env.DEV) {
  void import("./dialogue/debug")
    .then((module) => module.mountDialogueDebugScreen())
    .catch((error: unknown) => {
      const box = document.createElement("section");
      box.className = "llm-screen";
      box.textContent = `Could not open the dialogue lab: ${error instanceof Error ? error.message : String(error)}`;
      document.body.replaceChildren(box);
    });
} else if (debugMode === "stories") {
  void import("./ui/storySelect").then(({ mountStorySelectScreen, describeLengthView }) => {
    document.documentElement.classList.add("llm-debug-mode");
    document.body.classList.add("llm-debug-mode");
    const root = document.body;
    void mountStorySelectScreen(root, (view) => {
      const result = document.createElement("p");
      result.className = "llm-screen-note";
      result.textContent = `Loaded ${describeLengthView(view)} Order: ${view.locations.map((l) => l.id).join(" > ")}`;
      root.querySelector(".llm-screen")?.append(result);
    });
  });
} else {
  keepScreenAwake();
  const shell = document.querySelector<HTMLElement>("#game-shell");
  if (!shell) throw new Error("The game page is missing its shell.");
  const useMock = new URLSearchParams(window.location.search).get("mock") === "1";
  void import("./ui/startFlow")
    .then(({ startGame }) => startGame(shell, document.body, useMock))
    .catch((error: unknown) => {
      const box = document.createElement("section");
      box.className = "llm-screen";
      box.textContent = `Could not start the game: ${error instanceof Error ? error.message : String(error)}`;
      document.body.replaceChildren(box);
    });
}

import "./style.css";
import { soundEffects } from "./audio/soundEffects";
import { mountArtDebugScreen } from "./art/debug";
import { mountWorldDebugScreen } from "./world/debug";
import { applySavedTextSize } from "./ui/preferences";

applySavedTextSize();

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
if (debugMode === "art") {
  mountArtDebugScreen();
} else if (debugMode === "world") {
  mountWorldDebugScreen();
} else if (debugMode === "llm") {
  void import("./llm/debug").then((module) => module.mountLLMDebugScreen());
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

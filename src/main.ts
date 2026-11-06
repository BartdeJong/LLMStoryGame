import "./style.css";
import { Game } from "./game";
import { mountArtDebugScreen } from "./art/debug";
import { mountWorldDebugScreen } from "./world/debug";

const debugMode = new URLSearchParams(window.location.search).get("debug");
if (debugMode === "art") {
  mountArtDebugScreen();
} else if (debugMode === "world") {
  mountWorldDebugScreen();
} else if (debugMode === "llm") {
  void import("./llm/debug").then((module) => module.mountLLMDebugScreen());
} else {
  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  const joystick = document.querySelector<HTMLButtonElement>("#joystick");
  const actionButton = document.querySelector<HTMLButtonElement>("#action-button");
  const message = document.querySelector<HTMLElement>("#game-message");

  if (!canvas || !joystick || !actionButton || !message) {
    throw new Error("The game page is missing required controls.");
  }

  new Game(canvas, joystick, actionButton, message).start();
}

export type InputMode = "keyboard" | "touch" | "gamepad";

export let inputMode: InputMode = "keyboard";

export function setInputMode(mode: InputMode): void {
  inputMode = mode;
  if (typeof document !== "undefined") document.documentElement.dataset.inputMode = mode;
}

export function trackInputMode(): void {
  setInputMode(inputMode);
  window.addEventListener("keydown", () => setInputMode("keyboard"));
  window.addEventListener("pointerdown", (event) => {
    setInputMode(event.pointerType === "touch" ? "touch" : "keyboard");
  });
}

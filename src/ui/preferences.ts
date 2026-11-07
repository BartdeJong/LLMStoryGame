import { soundEffects } from "../audio/soundEffects";

export type TextSize = "standard" | "large";

const TEXT_SIZE_KEY = "cozy-mystery.text-size";

export function getTextSize(): TextSize {
  return localStorage.getItem(TEXT_SIZE_KEY) === "large" ? "large" : "standard";
}

export function setTextSize(size: TextSize): void {
  localStorage.setItem(TEXT_SIZE_KEY, size);
  document.documentElement.dataset.textSize = size;
}

export function applySavedTextSize(): void {
  setTextSize(getTextSize());
}

export function createPreferenceControls(): HTMLElement {
  const controls = document.createElement("div");
  controls.className = "preference-controls";
  const mute = document.createElement("button");
  mute.className = "llm-button preference-mute";
  mute.type = "button";
  const updateMuteLabel = (): void => {
    mute.textContent = `Sound: ${soundEffects.muted ? "Off" : "On"}`;
    mute.setAttribute("aria-pressed", String(soundEffects.muted));
  };
  updateMuteLabel();
  mute.addEventListener("click", () => {
    soundEffects.toggleMuted();
    updateMuteLabel();
  });

  const sizeLabel = document.createElement("label");
  sizeLabel.className = "text-size-setting";
  sizeLabel.append("Text size ");
  const size = document.createElement("select");
  size.setAttribute("aria-label", "Text size");
  for (const [value, label] of [["standard", "Standard"], ["large", "Large"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    size.append(option);
  }
  size.value = getTextSize();
  size.addEventListener("change", () => setTextSize(size.value === "large" ? "large" : "standard"));
  sizeLabel.append(size);
  controls.append(mute, sizeLabel);
  return controls;
}

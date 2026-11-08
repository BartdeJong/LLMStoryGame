import { soundEffects } from "../audio/soundEffects";

export type TextSize = "standard" | "large" | "extra-large";

const TEXT_SIZE_KEY = "cozy-mystery.text-size";
const REDUCED_MOTION_KEY = "cozy-mystery.reduced-motion";
const HIGH_CONTRAST_KEY = "cozy-mystery.high-contrast";
const LARGE_CONTROLS_KEY = "cozy-mystery.large-controls";
const CONTROL_HINTS_KEY = "cozy-mystery.control-hints";
const MOVEMENT_SPEED_KEY = "cozy-mystery.movement-speed";
type MovementSpeed = "relaxed" | "standard" | "brisk";

function readMovementSpeed(): MovementSpeed {
  const saved = localStorage.getItem(MOVEMENT_SPEED_KEY);
  return saved === "relaxed" || saved === "brisk" ? saved : "standard";
}

let movementSpeed: MovementSpeed = readMovementSpeed();

export function getTextSize(): TextSize {
  const saved = localStorage.getItem(TEXT_SIZE_KEY);
  return saved === "large" || saved === "extra-large" ? saved : "standard";
}

export function setTextSize(size: TextSize): void {
  localStorage.setItem(TEXT_SIZE_KEY, size);
  document.documentElement.dataset.textSize = size;
}

export function getMovementSpeed(): number {
  return movementSpeed === "relaxed" ? 0.75 : movementSpeed === "brisk" ? 1.25 : 1;
}

export function setMovementSpeed(speed: MovementSpeed): void {
  movementSpeed = speed;
  localStorage.setItem(MOVEMENT_SPEED_KEY, speed);
}

export function applySavedTextSize(): void {
  movementSpeed = readMovementSpeed();
  setTextSize(getTextSize());
  document.documentElement.dataset.reducedMotion = String(localStorage.getItem(REDUCED_MOTION_KEY) === "true");
  document.documentElement.dataset.highContrast = String(localStorage.getItem(HIGH_CONTRAST_KEY) === "true");
  document.documentElement.dataset.largeControls = String(localStorage.getItem(LARGE_CONTROLS_KEY) === "true");
  document.documentElement.dataset.controlHints = String(localStorage.getItem(CONTROL_HINTS_KEY) === "true");
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
  for (const [value, label] of [
    ["standard", "Standard"],
    ["large", "Large"],
    ["extra-large", "Extra large"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    size.append(option);
  }
  size.value = getTextSize();
  size.addEventListener("change", () => {
    const value = size.value;
    setTextSize(value === "large" || value === "extra-large" ? value : "standard");
  });
  sizeLabel.append(size);

  const volumeLabel = document.createElement("label");
  volumeLabel.className = "range-setting";
  volumeLabel.append("Sound volume ");
  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.step = "5";
  volume.value = String(Math.round(soundEffects.volume * 100));
  volume.setAttribute("aria-label", "Sound volume");
  const volumeOutput = document.createElement("output");
  volumeOutput.textContent = `${volume.value}%`;
  volume.addEventListener("input", () => {
    soundEffects.setVolume(Number(volume.value) / 100);
    volumeOutput.textContent = `${volume.value}%`;
  });
  volumeLabel.append(volume, volumeOutput);

  const speedLabel = document.createElement("label");
  speedLabel.className = "text-size-setting";
  speedLabel.append("Walk speed ");
  const speed = document.createElement("select");
  speed.setAttribute("aria-label", "Walk speed");
  for (const [value, label] of [["relaxed", "Relaxed"], ["standard", "Standard"], ["brisk", "Brisk"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    speed.append(option);
  }
  speed.value = movementSpeed;
  speed.addEventListener("change", () => {
    const value = speed.value;
    setMovementSpeed(value === "relaxed" || value === "brisk" ? value : "standard");
  });
  speedLabel.append(speed);

  const setting = (key: string, label: string, dataset: string): HTMLLabelElement => {
    const wrapper = document.createElement("label");
    wrapper.className = "check-setting";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = localStorage.getItem(key) === "true";
    checkbox.addEventListener("change", () => {
      localStorage.setItem(key, String(checkbox.checked));
      document.documentElement.dataset[dataset] = String(checkbox.checked);
    });
    wrapper.append(checkbox, label);
    return wrapper;
  };

  controls.append(
    mute,
    sizeLabel,
    volumeLabel,
    speedLabel,
    setting(REDUCED_MOTION_KEY, "Reduce motion", "reducedMotion"),
    setting(HIGH_CONTRAST_KEY, "High contrast", "highContrast"),
    setting(LARGE_CONTROLS_KEY, "Larger touch controls", "largeControls"),
    setting(CONTROL_HINTS_KEY, "Always show control hints", "controlHints"),
  );
  return controls;
}

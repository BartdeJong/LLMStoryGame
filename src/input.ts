import { gamepadInput } from "./input/gamepad";
import { setInputMode } from "./input/mode";

export interface MovementInput {
  readonly x: number;
  readonly y: number;
}

export function mergeMovementInputs(...inputs: readonly MovementInput[]): MovementInput {
  let x = inputs.reduce((sum, input) => sum + input.x, 0);
  let y = inputs.reduce((sum, input) => sum + input.y, 0);
  const magnitude = Math.hypot(x, y);
  if (magnitude > 1) {
    x /= magnitude;
    y /= magnitude;
  }
  return { x, y };
}

// A press on the world that moves less than this many CSS pixels before release is a tap; any more is a drag.
// About the width of a fingertip's natural wobble, and small enough that a deliberate stick drag starts at once.
export const TAP_SLOP_PX = 10;
// Touches that land in this left share of the screen can start the floating stick.
const STICK_ZONE_SHARE = 0.5;
const DEFAULT_STICK_SIZE = 116;

export interface WorldSurface {
  readonly canvas: HTMLCanvasElement;
  // Element shown under the thumb while the floating stick is held.
  readonly stick: HTMLElement;
  readonly onTap: (clientX: number, clientY: number) => void;
}

interface Gesture {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly touch: boolean;
  mode: "pending" | "stick" | "drag";
  stickSize: number;
}

export class InputController {
  private readonly keys = new Set<string>();
  private joystickX = 0;
  private joystickY = 0;
  private floatingX = 0;
  private floatingY = 0;
  private gesture: Gesture | null = null;

  constructor(
    private readonly joystick: HTMLButtonElement,
    private readonly actionButton: HTMLButtonElement,
    private readonly onInteract: () => void,
    private readonly surface?: WorldSurface,
  ) {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.clearInput);
    this.joystick.addEventListener("pointerdown", this.handlePointerDown);
    this.joystick.addEventListener("pointermove", this.handlePointerMove);
    this.joystick.addEventListener("pointerup", this.handlePointerEnd);
    this.joystick.addEventListener("pointercancel", this.handlePointerEnd);
    this.joystick.addEventListener("lostpointercapture", this.handlePointerEnd);
    this.actionButton.addEventListener("click", this.onInteract);
    const canvas = this.surface?.canvas;
    canvas?.addEventListener("pointerdown", this.handleSurfaceDown);
    canvas?.addEventListener("pointermove", this.handleSurfaceMove);
    canvas?.addEventListener("pointerup", this.handleSurfaceUp);
    canvas?.addEventListener("pointercancel", this.handleSurfaceCancel);
    canvas?.addEventListener("lostpointercapture", this.handleSurfaceCancel);
  }

  getMovement(): MovementInput {
    let x = this.joystickX + this.floatingX;
    let y = this.joystickY + this.floatingY;

    if (this.keys.has("ArrowLeft") || this.keys.has("a")) x -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("d")) x += 1;
    if (this.keys.has("ArrowUp") || this.keys.has("w")) y -= 1;
    if (this.keys.has("ArrowDown") || this.keys.has("s")) y += 1;

    const gamepadMovement = gamepadInput.current.uiConsumed
      ? { x: 0, y: 0 }
      : gamepadInput.current.movement;
    return mergeMovementInputs({ x, y }, gamepadMovement);
  }

  clear(): void {
    this.keys.clear();
    this.handlePointerEnd();
    this.endGesture();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearInput);
    this.joystick.removeEventListener("pointerdown", this.handlePointerDown);
    this.joystick.removeEventListener("pointermove", this.handlePointerMove);
    this.joystick.removeEventListener("pointerup", this.handlePointerEnd);
    this.joystick.removeEventListener("pointercancel", this.handlePointerEnd);
    this.joystick.removeEventListener("lostpointercapture", this.handlePointerEnd);
    this.actionButton.removeEventListener("click", this.onInteract);
    const canvas = this.surface?.canvas;
    canvas?.removeEventListener("pointerdown", this.handleSurfaceDown);
    canvas?.removeEventListener("pointermove", this.handleSurfaceMove);
    canvas?.removeEventListener("pointerup", this.handleSurfaceUp);
    canvas?.removeEventListener("pointercancel", this.handleSurfaceCancel);
    canvas?.removeEventListener("lostpointercapture", this.handleSurfaceCancel);
    this.clear();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (
      event.target instanceof HTMLElement
      && event.target.closest("input, textarea, select, button, a[href], [contenteditable='true']")
    ) return;

    setInputMode("keyboard");
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(key)) {
      event.preventDefault();
    }
    if ((key === " " || key === "e") && !this.keys.has(key)) {
      this.onInteract();
    }
    this.keys.add(key);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    this.keys.delete(key);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    setInputMode("touch");
    this.joystick.setPointerCapture(event.pointerId);
    this.updateJoystick(event);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.joystick.hasPointerCapture(event.pointerId)) {
      this.updateJoystick(event);
    }
  };

  private readonly handlePointerEnd = (): void => {
    this.joystickX = 0;
    this.joystickY = 0;
    this.joystick.style.setProperty("--stick-x", "0px");
    this.joystick.style.setProperty("--stick-y", "0px");
  };

  private readonly clearInput = (): void => {
    this.clear();
  };

  private readonly handleSurfaceDown = (event: PointerEvent): void => {
    if (this.gesture || (event.pointerType === "mouse" && event.button !== 0)) return;
    const touch = event.pointerType === "touch";
    if (touch) setInputMode("touch");
    this.gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      touch,
      mode: "pending",
      stickSize: DEFAULT_STICK_SIZE,
    };
    this.surface?.canvas.setPointerCapture(event.pointerId);
  };

  private readonly handleSurfaceMove = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.mode === "pending"
      && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > TAP_SLOP_PX) {
      const inStickZone = gesture.startX < window.innerWidth * STICK_ZONE_SHARE;
      gesture.mode = gesture.touch && inStickZone ? "stick" : "drag";
      if (gesture.mode === "stick") this.showStick(gesture);
    }
    if (gesture.mode === "stick") this.moveStick(gesture, event);
  };

  private readonly handleSurfaceUp = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const wasTap = gesture.mode === "pending";
    this.endGesture();
    if (wasTap) this.surface?.onTap(event.clientX, event.clientY);
  };

  private readonly handleSurfaceCancel = (event: PointerEvent): void => {
    if (this.gesture?.pointerId === event.pointerId) this.endGesture();
  };

  private endGesture(): void {
    const gesture = this.gesture;
    this.gesture = null;
    this.floatingX = 0;
    this.floatingY = 0;
    if (!gesture || !this.surface) return;
    this.surface.stick.hidden = true;
    this.joystick.classList.remove("joystick-idle");
    if (this.surface.canvas.hasPointerCapture(gesture.pointerId)) {
      this.surface.canvas.releasePointerCapture(gesture.pointerId);
    }
  }

  // The stick takes the size of the resting joystick, so the larger-controls preference applies to it too.
  private showStick(gesture: Gesture): void {
    const surface = this.surface;
    if (!surface) return;
    const shell = surface.canvas.parentElement;
    if (!shell) return;
    const resting = this.joystick.getBoundingClientRect().width;
    gesture.stickSize = resting > 0 ? resting : DEFAULT_STICK_SIZE;
    const bounds = shell.getBoundingClientRect();
    const stick = surface.stick;
    stick.style.width = `${gesture.stickSize}px`;
    stick.style.height = `${gesture.stickSize}px`;
    stick.style.transform = `translate(${gesture.startX - bounds.left - gesture.stickSize / 2}px, ${gesture.startY - bounds.top - gesture.stickSize / 2}px)`;
    stick.style.setProperty("--stick-x", "0px");
    stick.style.setProperty("--stick-y", "0px");
    stick.hidden = false;
    this.joystick.classList.add("joystick-idle");
  }

  private moveStick(gesture: Gesture, event: PointerEvent): void {
    const maxDistance = Math.max(1, gesture.stickSize / 2 - 25);
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const distance = Math.hypot(dx, dy);
    const scale = distance > maxDistance ? maxDistance / distance : 1;
    this.floatingX = (dx * scale) / maxDistance;
    this.floatingY = (dy * scale) / maxDistance;
    this.surface?.stick.style.setProperty("--stick-x", `${dx * scale}px`);
    this.surface?.stick.style.setProperty("--stick-y", `${dy * scale}px`);
  }

  private updateJoystick(event: PointerEvent): void {
    const bounds = this.joystick.getBoundingClientRect();
    const maxDistance = Math.max(1, bounds.width / 2 - 25);
    const dx = event.clientX - (bounds.left + bounds.width / 2);
    const dy = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(dx, dy);
    const scale = distance > maxDistance ? maxDistance / distance : 1;

    this.joystickX = (dx * scale) / maxDistance;
    this.joystickY = (dy * scale) / maxDistance;
    this.joystick.style.setProperty("--stick-x", `${dx * scale}px`);
    this.joystick.style.setProperty("--stick-y", `${dy * scale}px`);
  }
}

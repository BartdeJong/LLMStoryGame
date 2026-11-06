export interface MovementInput {
  readonly x: number;
  readonly y: number;
}

export class InputController {
  private readonly keys = new Set<string>();
  private joystickX = 0;
  private joystickY = 0;

  constructor(
    private readonly joystick: HTMLButtonElement,
    private readonly actionButton: HTMLButtonElement,
    private readonly onInteract: () => void,
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
  }

  getMovement(): MovementInput {
    let x = this.joystickX;
    let y = this.joystickY;

    if (this.keys.has("ArrowLeft") || this.keys.has("a")) x -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("d")) x += 1;
    if (this.keys.has("ArrowUp") || this.keys.has("w")) y -= 1;
    if (this.keys.has("ArrowDown") || this.keys.has("s")) y += 1;

    const magnitude = Math.hypot(x, y);
    if (magnitude > 1) {
      x /= magnitude;
      y /= magnitude;
    }

    return { x, y };
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
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
    this.keys.clear();
    this.handlePointerEnd();
  };

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

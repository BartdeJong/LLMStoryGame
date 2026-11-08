import { routeGamepadFocus } from "./focus";
import { inputMode, setInputMode } from "./mode";

export interface GamepadButtonLike {
  readonly pressed: boolean;
  readonly value?: number;
}

export interface GamepadLike {
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly GamepadButtonLike[];
}

export interface GamepadProvider {
  getGamepads(): readonly (GamepadLike | null)[];
  subscribe(onConnected: (gamepad: GamepadLike) => void, onDisconnected: (index: number) => void): () => void;
}

export interface GamepadDirection {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

export interface GamepadButtons {
  readonly a: boolean;
  readonly b: boolean;
  readonly x: boolean;
  readonly y: boolean;
  readonly menu: boolean;
}

export interface GamepadFrame {
  readonly movement: { readonly x: number; readonly y: number };
  readonly direction: GamepadDirection;
  readonly held: GamepadButtons;
  readonly pressed: GamepadButtons;
  readonly uiConsumed: boolean;
}

type FrameListener = (frame: GamepadFrame) => void;
type ConnectionListener = (connected: boolean) => void;

const BUTTON_INDEX: Record<keyof GamepadButtons, number> = { a: 0, b: 1, x: 2, y: 3, menu: 9 };
const NO_BUTTONS: GamepadButtons = { a: false, b: false, x: false, y: false, menu: false };

function browserProvider(): GamepadProvider {
  return {
    getGamepads: () => typeof navigator.getGamepads === "function" ? Array.from(navigator.getGamepads()) : [],
    subscribe: (onConnected, onDisconnected) => {
      const connected = (event: GamepadEvent): void => onConnected(event.gamepad);
      const disconnected = (event: GamepadEvent): void => onDisconnected(event.gamepad.index);
      window.addEventListener("gamepadconnected", connected);
      window.addEventListener("gamepaddisconnected", disconnected);
      return () => {
        window.removeEventListener("gamepadconnected", connected);
        window.removeEventListener("gamepaddisconnected", disconnected);
      };
    },
  };
}

export class GamepadController {
  private readonly provider: GamepadProvider;
  private readonly listeners = new Set<FrameListener>();
  private readonly connectionListeners = new Set<ConnectionListener>();
  private stopEvents: (() => void) | null = null;
  private animationFrame: number | null = null;
  private connectedIndex: number | null = null;
  private eventPad: GamepadLike | null = null;
  private previousButtons: GamepadButtons = NO_BUTTONS;
  private frame: GamepadFrame = {
    movement: { x: 0, y: 0 },
    direction: { up: false, down: false, left: false, right: false },
    held: NO_BUTTONS,
    pressed: NO_BUTTONS,
    uiConsumed: false,
  };

  constructor(provider: GamepadProvider = browserProvider()) {
    this.provider = provider;
  }

  get current(): GamepadFrame {
    return this.frame;
  }

  onFrame(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  start(): void {
    if (this.animationFrame !== null) return;
    this.stopEvents = this.provider.subscribe(
      (pad) => {
        this.eventPad = pad.connected && pad.mapping === "standard" ? pad : null;
      },
      (index) => {
        if (this.eventPad?.index === index) this.eventPad = null;
        if (this.connectedIndex === index) this.setConnected(null);
      },
    );
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.stopEvents?.();
    this.stopEvents = null;
    this.eventPad = null;
    this.setConnected(null);
    this.previousButtons = NO_BUTTONS;
    this.frame = emptyFrame();
  }

  poll(now: number): GamepadFrame {
    const pads = this.provider.getGamepads();
    const active = pads.find((pad) => pad?.connected && pad.mapping === "standard")
      ?? (this.eventPad?.connected ? this.eventPad : null);
    this.eventPad = null;
    this.setConnected(active?.index ?? null);

    const movement = active ? readMovement(active) : { x: 0, y: 0 };
    const held = active ? readButtons(active) : NO_BUTTONS;
    const pressed = buttonEdges(held, this.previousButtons);
    this.previousButtons = held;
    const direction = {
      up: movement.y < -0.35,
      down: movement.y > 0.35,
      left: movement.x < -0.35,
      right: movement.x > 0.35,
    };
    if (Object.values(held).some(Boolean) || movement.x !== 0 || movement.y !== 0) setInputMode("gamepad");
    const provisional: GamepadFrame = { movement, direction, held, pressed, uiConsumed: false };
    const uiConsumed = active !== null && inputMode === "gamepad" ? routeGamepadFocus(provisional, now) : false;
    this.frame = { ...provisional, uiConsumed };
    for (const listener of this.listeners) listener(this.frame);
    return this.frame;
  }

  private readonly tick = (timestamp: number): void => {
    this.poll(timestamp);
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private setConnected(index: number | null): void {
    if (index === this.connectedIndex) return;
    const wasConnected = this.connectedIndex !== null;
    this.connectedIndex = index;
    if (wasConnected !== (index !== null)) {
      for (const listener of this.connectionListeners) listener(index !== null);
    }
    if (index === null) {
      this.previousButtons = NO_BUTTONS;
      this.frame = emptyFrame();
    }
  }
}

function readMovement(pad: GamepadLike): { x: number; y: number } {
  const axisX = pad.axes[0] ?? 0;
  const axisY = pad.axes[1] ?? 0;
  const magnitude = Math.hypot(axisX, axisY);
  let x = 0;
  let y = 0;
  if (magnitude > 0.25) {
    const scale = Math.min(1, (magnitude - 0.25) / 0.75) / magnitude;
    x = axisX * scale;
    y = axisY * scale;
  }

  const dpadX = Number(isPressed(pad, 15)) - Number(isPressed(pad, 14));
  const dpadY = Number(isPressed(pad, 13)) - Number(isPressed(pad, 12));
  x += dpadX;
  y += dpadY;
  const combined = Math.hypot(x, y);
  return combined > 1 ? { x: x / combined, y: y / combined } : { x, y };
}

function readButtons(pad: GamepadLike): GamepadButtons {
  return {
    a: isPressed(pad, BUTTON_INDEX.a),
    b: isPressed(pad, BUTTON_INDEX.b),
    x: isPressed(pad, BUTTON_INDEX.x),
    y: isPressed(pad, BUTTON_INDEX.y),
    menu: isPressed(pad, BUTTON_INDEX.menu),
  };
}

function isPressed(pad: GamepadLike, index: number): boolean {
  return pad.buttons[index]?.pressed ?? false;
}

function buttonEdges(held: GamepadButtons, previous: GamepadButtons): GamepadButtons {
  return {
    a: held.a && !previous.a,
    b: held.b && !previous.b,
    x: held.x && !previous.x,
    y: held.y && !previous.y,
    menu: held.menu && !previous.menu,
  };
}

function emptyFrame(): GamepadFrame {
  return {
    movement: { x: 0, y: 0 },
    direction: { up: false, down: false, left: false, right: false },
    held: NO_BUTTONS,
    pressed: NO_BUTTONS,
    uiConsumed: false,
  };
}

export const gamepadInput = new GamepadController();

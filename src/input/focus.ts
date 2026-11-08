import type { GamepadFrame, GamepadDirection } from "./gamepad";

export interface FocusTarget {
  focus(): void;
  click(): void;
  readonly disabled?: boolean;
}

export interface FocusFrame {
  readonly direction: GamepadDirection;
  readonly pressed: GamepadFrame["pressed"];
}

export class FocusManager {
  private items: readonly FocusTarget[] = [];
  private index = -1;
  private lastDirection = "";
  private nextRepeatAt = 0;
  private initialized = false;

  setItems(items: readonly FocusTarget[]): void {
    const current = this.items[this.index];
    this.items = items.filter((item) => !item.disabled);
    this.index = current ? this.items.indexOf(current) : -1;
    if (this.index < 0 && this.items.length > 0) {
      this.index = 0;
      if (this.initialized) this.focusCurrent();
    }
  }

  focusFirst(): void {
    this.initialized = true;
    this.index = this.items.length > 0 ? 0 : -1;
    this.focusCurrent();
  }

  update(
    frame: FocusFrame,
    now: number,
    onBack: () => FocusTarget | void,
    onX?: () => void,
    onY?: () => void,
    onMenu?: () => void,
  ): void {
    const direction = directionName(frame.direction);
    if (!direction) {
      this.lastDirection = "";
      this.nextRepeatAt = 0;
    } else if (direction !== this.lastDirection) {
      this.move(direction);
      this.lastDirection = direction;
      this.nextRepeatAt = now + 400;
    } else if (now >= this.nextRepeatAt) {
      this.move(direction);
      this.nextRepeatAt = now + 120;
    }

    if (frame.pressed.a) this.items[this.index]?.click();
    if (frame.pressed.b) {
      const target = onBack();
      if (target) this.focusTarget(target);
    }
    if (frame.pressed.x) onX?.();
    if (frame.pressed.y) onY?.();
    if (frame.pressed.menu) onMenu?.();
  }

  private move(direction: string): void {
    if (this.items.length === 0) return;
    const delta = direction === "up" || direction === "left" ? -1 : 1;
    this.index = (this.index + delta + this.items.length) % this.items.length;
    this.focusCurrent();
  }

  private focusCurrent(): void {
    if (this.index >= 0) this.items[this.index]?.focus();
  }

  private focusTarget(target: FocusTarget): void {
    const index = this.items.indexOf(target);
    if (index >= 0) {
      this.index = index;
      target.focus();
    }
  }
}

export interface GamepadFocusOptions {
  readonly onBack?: () => FocusTarget | void;
  readonly onX?: () => void;
  readonly onY?: () => void;
  readonly onMenu?: () => void;
  readonly isActive?: () => boolean;
}

interface FocusScope extends GamepadFocusOptions {
  readonly element: HTMLElement;
  readonly manager: FocusManager;
  entered: boolean;
  active: boolean;
  order: number;
}

const scopes: FocusScope[] = [];
let activationOrder = 0;

export function activateGamepadFocus(element: HTMLElement, options: GamepadFocusOptions = {}): () => void {
  const scope: FocusScope = { ...options, element, manager: new FocusManager(), entered: false, active: false, order: 0 };
  scopes.push(scope);
  return () => {
    const index = scopes.indexOf(scope);
    if (index >= 0) scopes.splice(index, 1);
  };
}

export function routeGamepadFocus(frame: GamepadFrame, now: number): boolean {
  const scope = topmostActiveScope();
  if (!scope) return false;

  const items = getFocusable(scope.element);
  scope.manager.setItems(items);
  if (!scope.entered) {
    scope.manager.focusFirst();
    scope.entered = true;
  }
  scope.manager.update(frame, now, scope.onBack ?? (() => {}), scope.onX, scope.onY, scope.onMenu);
  return true;
}

function topmostActiveScope(): FocusScope | undefined {
  for (const scope of scopes) {
    const active = scope.element.isConnected
      && !scope.element.hidden
      && scope.isActive?.() !== false
      && !scope.element.closest("[hidden]");
    if (active && !scope.active) scope.order = ++activationOrder;
    if (!active) scope.entered = false;
    scope.active = active;
  }
  return scopes.filter((scope) => scope.active).sort((a, b) => b.order - a.order)[0];
}

function getFocusable(root: HTMLElement): FocusTarget[] {
  return [...root.querySelectorAll<HTMLElement>(
    "button:not([disabled]), a[href], input:not([disabled]):not([type='hidden']), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )].filter((item) => !item.closest("[hidden]")).map((item) => {
    item.dataset.padHint ??= "A";
    return item as FocusTarget;
  });
}

function directionName(direction: GamepadDirection): string {
  if (direction.up) return "up";
  if (direction.down) return "down";
  if (direction.left) return "left";
  if (direction.right) return "right";
  return "";
}

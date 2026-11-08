import { beforeEach, describe, expect, it } from "vitest";
import { inputMode, setInputMode } from "./mode";
import { GamepadController, type GamepadLike, type GamepadProvider } from "./gamepad";
import { mergeMovementInputs } from "../input";

class FakeProvider implements GamepadProvider {
  pads: (GamepadLike | null)[] = [];

  getGamepads(): readonly (GamepadLike | null)[] {
    return this.pads;
  }

  subscribe(): () => void {
    return () => {};
  }
}

function pad(
  axes: number[] = [0, 0],
  pressed: number[] = [],
  mapping = "standard",
): GamepadLike {
  const buttons = Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index) }));
  return { index: 0, connected: true, mapping, axes, buttons };
}

describe("GamepadController", () => {
  beforeEach(() => setInputMode("keyboard"));

  it("applies a radial dead zone and reads the D-pad", () => {
    const provider = new FakeProvider();
    const controller = new GamepadController(provider);
    provider.pads = [pad([0.2, 0])];
    expect(controller.poll(0).movement).toEqual({ x: 0, y: 0 });

    provider.pads = [pad([0.7, 0])];
    expect(controller.poll(16).movement.x).toBeCloseTo(0.6);
    provider.pads = [pad([0, 0], [12])];
    const dpad = controller.poll(32);
    expect(dpad.movement.y).toBe(-1);
    expect(dpad.direction.up).toBe(true);
  });

  it("emits one pressed edge while a button is held", () => {
    const provider = new FakeProvider();
    const controller = new GamepadController(provider);
    provider.pads = [pad()];
    controller.poll(0);
    provider.pads = [pad([0, 0], [0])];

    const first = controller.poll(16);
    const held = controller.poll(32);
    expect(first.pressed.a).toBe(true);
    expect(first.held.a).toBe(true);
    expect(held.pressed.a).toBe(false);
    expect(held.held.a).toBe(true);
  });

  it("clears movement and held state when disconnected", () => {
    const provider = new FakeProvider();
    const controller = new GamepadController(provider);
    const connections: boolean[] = [];
    controller.onConnection((connected) => connections.push(connected));
    provider.pads = [pad([0.8, 0])];
    expect(controller.poll(0).movement.x).toBeGreaterThan(0);

    provider.pads = [];
    const disconnected = controller.poll(16);
    expect(disconnected.movement).toEqual({ x: 0, y: 0 });
    expect(disconnected.held).toEqual({ a: false, b: false, x: false, y: false, menu: false });
    expect(connections).toEqual([true, false]);
  });

  it("ignores non-standard mappings and chooses the first standard pad", () => {
    const provider = new FakeProvider();
    const controller = new GamepadController(provider);
    provider.pads = [pad([1, 0], [], "xbox"), { ...pad([0, -0.8]), index: 1 }];
    expect(controller.poll(0).movement.x).toBe(0);
    expect(controller.current.movement.y).toBeLessThan(0);
  });

  it("merges keyboard and controller movement and tracks the last device", () => {
    const provider = new FakeProvider();
    const controller = new GamepadController(provider);
    provider.pads = [pad([0, -1])];
    controller.poll(0);
    expect(inputMode).toBe("gamepad");
    const merged = mergeMovementInputs({ x: 1, y: 0 }, controller.current.movement);
    expect(merged.x).toBeCloseTo(Math.SQRT1_2);
    expect(merged.y).toBeCloseTo(-Math.SQRT1_2);

    setInputMode("touch");
    expect(inputMode).toBe("touch");
    setInputMode("keyboard");
    expect(inputMode).toBe("keyboard");
  });
});

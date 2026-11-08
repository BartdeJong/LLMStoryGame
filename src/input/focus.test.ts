import { describe, expect, it } from "vitest";
import { FocusManager, type FocusFrame, type FocusTarget } from "./focus";

function target(name: string, selected: string[]): FocusTarget {
  return {
    focus: () => selected.push(`focus:${name}`),
    click: () => selected.push(`click:${name}`),
  };
}

function frame(
  direction: FocusFrame["direction"] = { up: false, down: false, left: false, right: false },
  pressed: Partial<FocusFrame["pressed"]> = {},
): FocusFrame {
  return {
    direction,
    pressed: { a: false, b: false, x: false, y: false, menu: false, ...pressed },
  };
}

describe("FocusManager", () => {
  it("moves focus, wraps, and activates the selected target", () => {
    const selected: string[] = [];
    const manager = new FocusManager();
    manager.setItems([target("one", selected), target("two", selected), target("three", selected)]);
    manager.focusFirst();
    manager.update(frame({ up: true, down: false, left: false, right: false }), 0, () => {});
    manager.update(frame({ up: false, down: false, left: false, right: false }, { a: true }), 1, () => {});

    expect(selected).toEqual(["focus:one", "focus:three", "click:three"]);
  });

  it("uses a 400ms initial delay and 120ms repeat interval", () => {
    const selected: string[] = [];
    const manager = new FocusManager();
    manager.setItems([target("one", selected), target("two", selected), target("three", selected)]);
    manager.focusFirst();
    const down = { up: false, down: true, left: false, right: false };
    let now = 0;
    manager.update(frame(down), now, () => {});
    now = 399;
    manager.update(frame(down), now, () => {});
    expect(selected.filter((entry) => entry.startsWith("focus:"))).toHaveLength(2);
    now = 400;
    manager.update(frame(down), now, () => {});
    now = 519;
    manager.update(frame(down), now, () => {});
    expect(selected.filter((entry) => entry.startsWith("focus:"))).toHaveLength(3);
    now = 520;
    manager.update(frame(down), now, () => {});
    expect(selected.at(-1)).toBe("focus:one");
  });

  it("runs the active screen back action", () => {
    const manager = new FocusManager();
    let backs = 0;
    manager.setItems([]);
    manager.update(frame(undefined, { b: true }), 0, () => { backs += 1; });
    expect(backs).toBe(1);
  });
});

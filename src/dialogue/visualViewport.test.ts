import { describe, expect, it } from "vitest";
import { getVisualViewportBottomInset } from "./visualViewport";

describe("getVisualViewportBottomInset", () => {
  it("returns no inset when the visual and layout viewports match", () => {
    expect(getVisualViewportBottomInset(844, 844, 0)).toBe(0);
  });

  it("returns the obscured layout area below the visual viewport", () => {
    expect(getVisualViewportBottomInset(844, 500, 0)).toBe(344);
  });

  it("accounts for a visual viewport shifted down by browser scrolling", () => {
    expect(getVisualViewportBottomInset(844, 500, 100)).toBe(244);
  });

  it("never returns a negative inset", () => {
    expect(getVisualViewportBottomInset(844, 900, 0)).toBe(0);
  });
});

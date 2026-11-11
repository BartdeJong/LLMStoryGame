export function getVisualViewportBottomInset(
  layoutHeight: number,
  visualViewportHeight: number,
  visualViewportOffsetTop: number,
): number {
  return Math.max(0, layoutHeight - visualViewportHeight - visualViewportOffsetTop);
}

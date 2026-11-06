export function createPixelCanvas(): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("This browser could not create an art canvas context.");
  }
  context.imageSmoothingEnabled = false;
  return { canvas, context };
}

export const REFERENCE_VIEW_WIDTH = 320;
export const REFERENCE_VIEW_HEIGHT = 180;
// Never show a sliver of world; tiny windows still get a playable view.
const MIN_VIEW_WIDTH = 160;
const MIN_VIEW_HEIGHT = 90;

export interface ViewLayout {
  // World pixels drawn on the canvas.
  readonly width: number;
  readonly height: number;
  // Device pixels per world pixel; always a whole number so the art stays crisp.
  readonly deviceScale: number;
  // Canvas size and offset in CSS pixels. The canvas covers the container and is centred, so it may overhang by less than one world pixel.
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly cssLeft: number;
  readonly cssTop: number;
}

// The zoom is the scale the old fixed 320x180 view had when fitted inside the container, rounded to the nearest whole number
// of device pixels per world pixel (at least one). Tiles therefore keep roughly their old physical size, and the view
// grows to cover whatever shape the container has.
export function computeViewLayout(cssWidth: number, cssHeight: number, pixelRatio: number): ViewLayout {
  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  const width = Math.max(1, cssWidth);
  const height = Math.max(1, cssHeight);
  const fitted = Math.min(width / REFERENCE_VIEW_WIDTH, height / REFERENCE_VIEW_HEIGHT);
  const deviceScale = Math.max(1, Math.round(fitted * ratio));
  const deviceWidth = width * ratio;
  const deviceHeight = height * ratio;
  const viewWidth = Math.max(MIN_VIEW_WIDTH, Math.ceil(deviceWidth / deviceScale));
  const viewHeight = Math.max(MIN_VIEW_HEIGHT, Math.ceil(deviceHeight / deviceScale));
  return {
    width: viewWidth,
    height: viewHeight,
    deviceScale,
    cssWidth: (viewWidth * deviceScale) / ratio,
    cssHeight: (viewHeight * deviceScale) / ratio,
    cssLeft: Math.floor((deviceWidth - viewWidth * deviceScale) / 2) / ratio,
    cssTop: Math.floor((deviceHeight - viewHeight * deviceScale) / 2) / ratio,
  };
}

import { describe, expect, it } from "vitest";
import { canEnlarge, glyphBottomRow, isBigFurniture, isWallMounted, wallCropRows } from "./placement";

describe("glyph placement", () => {
  it("hangs paintings, mirrors and boards on the wall but not free-standing things", () => {
    expect(isWallMounted("painting")).toBe(true);
    expect(isWallMounted("mirror")).toBe(true);
    expect(isWallMounted("hook")).toBe(true);
    expect(isWallMounted("sign", "Notice board")).toBe(true);
    expect(isWallMounted("urn", "Shelf of jars")).toBe(true);
    expect(isWallMounted("bookshelf")).toBe(false);
    expect(isWallMounted("grandfather_clock")).toBe(false);
    expect(isWallMounted("barrel")).toBe(false);
  });

  it("crops signs to their board when hung up", () => {
    expect(wallCropRows("sign")).toBe(9);
    expect(wallCropRows("painting")).toBe(16);
  });

  it("enlarges furniture only", () => {
    expect(isBigFurniture("bed")).toBe(true);
    expect(isBigFurniture("bookshelf")).toBe(true);
    expect(isBigFurniture("barrel")).toBe(false);
  });

  it("falls back to normal size when a neighbour tile is busy", () => {
    expect(canEnlarge(5, 5, () => false)).toBe(true);
    expect(canEnlarge(5, 5, (x, y) => x === 6 && y === 5)).toBe(false);
    expect(canEnlarge(5, 5, (x, y) => x === 5 && y === 4)).toBe(false);
    expect(canEnlarge(5, 5, (x, y) => x === 5 && y === 6)).toBe(true);
  });

  it("finds the last drawn row of a glyph", () => {
    expect(glyphBottomRow("bed")).toBe(14);
    expect(glyphBottomRow("nope")).toBe(15);
  });
});

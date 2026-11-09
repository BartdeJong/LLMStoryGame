import { afterEach, describe, expect, it, vi } from "vitest";
import { GLYPH_CATALOG, type GlyphDefinition } from "./catalog";
import { resolveVisual, tokenizeVisualText } from "./matcher";
import { lintGlyphCatalog } from "./lint";
import { renderGlyph } from "./render";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("glyph renderer", () => {
  it("renders a glyph onto a 16x16 canvas", () => {
    const drawn: number[][] = [];
    const context = {
      fillStyle: "",
      imageSmoothingEnabled: true,
      fillRect: (x: number, y: number, width: number, height: number) => drawn.push([x, y, width, height]),
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal("document", { createElement: () => canvas });

    const rendered = renderGlyph(GLYPH_CATALOG[0]!, { palette: "meadow" });
    expect([rendered.width, rendered.height]).toEqual([16, 16]);
    expect(context.imageSmoothingEnabled).toBe(false);
    expect(drawn.length).toBeGreaterThan(30);
  });

  it("applies seeded modifiers deterministically", () => {
    const drawn: string[] = [];
    const context = {
      fillStyle: "",
      imageSmoothingEnabled: true,
      fillRect: (x: number, y: number) => drawn.push(`${context.fillStyle}:${x},${y}`),
    } as unknown as CanvasRenderingContext2D;
    vi.stubGlobal("document", { createElement: () => ({
      width: 0, height: 0, getContext: () => context,
    } as unknown as HTMLCanvasElement) });
    const glyph = GLYPH_CATALOG.find((entry) => entry.id === "generic_tool")!;
    const states = ["glow", "cracked", "stained", "rusty", "dusty"] as const;
    renderGlyph(glyph, { palette: "shore", states, seed: "repeatable" });
    const first = [...drawn];
    drawn.length = 0;
    renderGlyph({ ...glyph, id: "test_copy" }, { palette: "shore", states, seed: "repeatable" });
    expect(drawn).toEqual(first);
  });
});

describe("visual matcher", () => {
  const glyph = (id: string, name: string, tags: string[], category: GlyphDefinition["category"] = "generic"): GlyphDefinition => ({
    id, name, category, material: "misc", tags, size: "1x1", rows: Array.from({ length: 16 }, () => "................"),
  });
  const fixture = [
    glyph("flask", "Glass flask", ["flask", "bottle", "vial", "container", "glass"]),
    glyph("key", "Iron key", ["key", "metal", "lock", "door", "tooth"], "tool"),
    glyph("book", "Hardcover book", ["book", "ledger", "journal", "volume", "paper"], "paper"),
  ];

  it("matches the head noun and recognizes modifiers and accents", () => {
    expect(resolveVisual("Empty Flask", "A clear container with a cork stopper.", fixture).icon).toBe("flask");
    expect(resolveVisual("rusty key", "A key with chipped teeth.", fixture).states).toContain("rusty");
    expect(resolveVisual("red key", "", fixture).accent).toBe("accent");
    expect(resolveVisual("Overdue Book", "", fixture).icon).toBe("book");
  });

  it("uses a generic category glyph with zero confidence for an unknown noun", () => {
    expect(resolveVisual("Unknown Widget", "", fixture)).toMatchObject({ icon: "generic_prop", confidence: 0 });
  });

  it("singularizes plurals without damaging words ending in double s", () => {
    expect(tokenizeVisualText("Brass spyglasses and glass bottles")).toEqual(["brass", "spyglass", "and", "glass", "bottle"]);
  });
});

describe("glyph lint", () => {
  it("includes every requested glyph in the catalog", () => {
    const requiredIds = [
      "key", "potion_bottle", "book", "gem", "leaf", "feather", "lantern", "coin",
      "generic_container", "generic_tool", "generic_paper", "generic_trinket", "generic_prop",
      "chest", "chest_open", "barrel", "crate", "sack", "basket", "jar", "bottle", "flask", "vial",
      "cup", "mug", "teapot", "urn", "bucket", "cooking_pot", "kettle", "bowl", "jug", "canister",
      "magnifying_glass", "compass", "telescope", "pocket_watch", "hammer", "wrench", "saw", "scissors",
      "shovel", "rope", "hook", "candle", "torch", "matchbox", "padlock", "crowbar", "pliers",
      "lantern_hand", "spectacles", "bell",
      "letter", "envelope", "telegram", "map", "scroll", "newspaper", "note", "ticket", "photograph",
      "ledger", "diary", "playing_card", "quill_pen", "inkwell", "stamp", "wax_seal", "blueprint",
      "ring", "necklace", "locket", "brooch", "crown", "top_hat", "hat", "gloves", "scarf", "cane",
      "umbrella", "boots", "coat", "purse", "tobacco_pipe", "monocle", "key_ring", "medal",
      "bread", "apple", "cheese", "pie", "tea_cup", "mushroom", "flower", "shell", "stone", "bone",
      "egg", "fish", "carrot", "herb_bundle", "acorn",
      "sign", "signpost", "bench", "table", "chair", "lamp_post", "fountain", "well", "bookshelf",
      "bed", "stove", "grandfather_clock", "mirror", "painting", "statue", "oil_press", "tap_valve",
      "gears", "crank", "metal_pipe", "lever", "clockwork_box", "cart_wheel",
      "dagger", "revolver", "poison_bottle", "bloodstain", "footprints", "broken_glass", "cut_rope",
      "cobweb", "skull", "scorched_paper", "handcuffs",
      "storage_bin", "letter_box", "display_stand", "lamp_stand", "bedside_table",
      "cooling_table", "council_table", "stool", "receipt",
    ];
    const availableIds = new Set(GLYPH_CATALOG.map((glyph) => glyph.id));

    expect(requiredIds.filter((id) => !availableIds.has(id))).toEqual([]);
  });

  it("accepts and resolves the sourced lighthouse glyph", () => {
    const lighthouse = GLYPH_CATALOG.find((entry) => entry.id === "lighthouse")!;

    expect(lintGlyphCatalog([lighthouse])).toEqual([]);
    expect(resolveVisual("The Thirteenth Light", "", [lighthouse]).icon).toBe("lighthouse");
  });

  it("accepts the catalog and reports malformed glyphs with ids", () => {
    expect(lintGlyphCatalog(GLYPH_CATALOG)).toEqual([]);
    const malformed = {
      ...GLYPH_CATALOG[0]!,
      id: "Bad-Id",
      rows: ["wrong"],
      tags: ["UPPER"],
    } as GlyphDefinition;
    const issues = lintGlyphCatalog([malformed]);
    expect(issues.length).toBeGreaterThan(3);
    expect(issues.every((issue) => issue.glyphId === "Bad-Id")).toBe(true);
  });
});

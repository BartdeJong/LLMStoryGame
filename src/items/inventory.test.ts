import { describe, expect, it } from "vitest";
import fixture from "../story/fixtures/example-pack.json";
import { getLengthView } from "../story/loader";
import { createStoryState, giveItem } from "../story/state";
import { validateStoryPack } from "../story/validate";
import { listInventory } from "./inventory";

describe("inventory icons", () => {
  it("uses the item's identity when an authored recipe depicts the wrong shape", () => {
    const report = validateStoryPack(fixture);
    if (!report.pack) throw new Error("The example story fixture is invalid.");
    const pack = structuredClone(report.pack);
    pack.items[0]!.icon_recipe = "shape=key; primaryColor=accent; secondaryColor=cream";
    const state = createStoryState(getLengthView(pack, "short"));
    giveItem(state, pack.items[0]!.id);

    expect(listInventory(pack, state)[0]!.icon.shape).toBe("book");
  });
});

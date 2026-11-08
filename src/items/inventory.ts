import type { IconRecipe } from "../art";
import { inferIconShape, parseIconRecipe, seededIconRecipe } from "../story/recipes";
import type { StoryState } from "../story/state";
import type { StoryPack } from "../story/types";

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  icon: IconRecipe;
}

// The player's held items as pack data, in pickup order, ready for the inventory UI.
export function listInventory(pack: StoryPack, state: StoryState): InventoryItem[] {
  return state.itemsHeld
    .map((id) => pack.items.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .map((item) => {
      const icon = parseIconRecipe(item.icon_recipe) ?? seededIconRecipe(item.id, `${item.name} ${item.description}`);
      const shape = inferIconShape(item.name, item.description);
      return {
        id: item.id,
        name: item.name,
        description: item.description,
        icon: shape ? { ...icon, shape } : icon,
      };
    });
}

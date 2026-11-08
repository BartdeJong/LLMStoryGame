import { getIconCanvas } from "../art";
import type { PaletteName } from "../art";
import type { InventoryItem } from "./inventory";
import { activateGamepadFocus } from "../input/focus";

export interface InventoryUI {
  readonly toggleButton: HTMLButtonElement;
  readonly elements: readonly HTMLElement[];
  render(items: readonly InventoryItem[], palette: PaletteName): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

// A small toggle button plus a slide-in panel listing the player's items with icon, name and description.
export function createInventoryUI(container: HTMLElement): InventoryUI {
  const toggleButton = el("button", "inventory-button");
  toggleButton.type = "button";
  toggleButton.textContent = "🎒";
  toggleButton.setAttribute("aria-label", "Inventory");
  toggleButton.dataset.padHint = "Y";

  const panel = el("section", "inventory-panel");
  panel.hidden = true;
  const title = el("p", "inventory-title");
  title.textContent = "Inventory";
  const list = el("div", "inventory-list");
  const empty = el("p", "inventory-empty");
  empty.textContent = "Nothing yet.";
  panel.append(title, list, empty);

  const togglePanel = (): void => {
    panel.hidden = !panel.hidden;
  };
  toggleButton.addEventListener("click", togglePanel);
  activateGamepadFocus(panel, {
    isActive: () => !panel.hidden,
    onBack: togglePanel,
    onY: togglePanel,
  });

  container.append(toggleButton, panel);

  return {
    toggleButton,
    elements: [toggleButton, panel],
    render(items, palette) {
      list.replaceChildren();
      empty.hidden = items.length > 0;
      for (const item of items) {
        const row = el("div", "inventory-item");
        row.tabIndex = 0;
        const canvas = getIconCanvas(item.icon, palette);
        const icon = canvas.cloneNode(true) as HTMLCanvasElement;
        icon.className = "inventory-item-icon";
        const text = el("div", "inventory-item-text");
        const name = el("p", "inventory-item-name");
        name.textContent = item.name;
        const description = el("p", "inventory-item-description");
        description.textContent = item.description;
        text.append(name, description);
        row.append(icon, text);
        list.append(row);
      }
    },
  };
}

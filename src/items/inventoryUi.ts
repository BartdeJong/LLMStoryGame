import { getAshenObjectSprite } from "../art";
import { getVisualCanvas } from "../art/glyphs";
import type { PaletteName } from "../art";
import type { InventoryItem } from "./inventory";
import { activateGamepadFocus } from "../input/focus";

export interface InventoryUI {
  readonly toggleButton: HTMLButtonElement;
  readonly elements: readonly HTMLElement[];
  readonly isOpen: boolean;
  render(items: readonly InventoryItem[], palette: PaletteName): void;
  toggle(): void;
  close(): void;
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
  toggleButton.textContent = "🎒 0";
  toggleButton.setAttribute("aria-label", "Inventory, 0 items");
  toggleButton.setAttribute("aria-expanded", "false");
  toggleButton.setAttribute("aria-controls", "inventory-panel");
  toggleButton.dataset.padHint = "Y";

  const panel = el("section", "inventory-panel");
  panel.id = "inventory-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Inventory");
  const title = el("p", "inventory-title");
  title.textContent = "Inventory";
  const search = el("input", "inventory-search");
  search.type = "search";
  search.placeholder = "Search items";
  search.setAttribute("aria-label", "Search inventory");
  const list = el("div", "inventory-list");
  const empty = el("p", "inventory-empty");
  empty.textContent = "Nothing yet.";
  const status = el("p", "inventory-status");
  status.setAttribute("aria-live", "polite");
  panel.append(title, search, list, empty, status);

  let currentItems: readonly InventoryItem[] = [];
  let currentPalette: PaletteName = "meadow";
  const renderItems = (): void => {
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = currentItems.filter((item) =>
      `${item.name} ${item.description}`.toLocaleLowerCase().includes(query));
    list.replaceChildren();
    empty.hidden = filtered.length > 0;
    empty.textContent = currentItems.length === 0 ? "Nothing yet. Explore nearby places to find useful items." : "No matching items.";
    status.textContent = query ? `${filtered.length} of ${currentItems.length} items` : `${currentItems.length} ${currentItems.length === 1 ? "item" : "items"}`;
    for (const item of filtered) {
      const row = el("article", "inventory-item");
      const canvas = getAshenObjectSprite(item.id, currentPalette)
        ?? getVisualCanvas(item.visual, currentPalette, item.icon, item.visualInferred, item.id);
      const icon = canvas.cloneNode(true) as HTMLCanvasElement;
      icon.className = "inventory-item-icon";
      icon.setAttribute("aria-hidden", "true");
      const text = el("div", "inventory-item-text");
      const name = el("p", "inventory-item-name");
      name.textContent = item.name;
      const description = el("p", "inventory-item-description");
      description.textContent = item.description;
      text.append(name, description);
      row.append(icon, text);
      list.append(row);
    }
  };
  search.addEventListener("input", renderItems);
  const togglePanel = (): void => {
    panel.hidden = !panel.hidden;
    toggleButton.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) search.focus();
    else toggleButton.focus();
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
    get isOpen() {
      return !panel.hidden;
    },
    toggle: togglePanel,
    close() {
      if (!panel.hidden) togglePanel();
    },
    render(items, palette) {
      currentItems = items;
      currentPalette = palette;
      toggleButton.textContent = `🎒 ${items.length}`;
      toggleButton.setAttribute("aria-label", `Inventory, ${items.length} ${items.length === 1 ? "item" : "items"}`);
      renderItems();
    },
  };
}

import { getVisualCanvas } from "../art/glyphs";
import type { PaletteName } from "../art";
import type { IconRecipe } from "../art";
import type { VisualSpec } from "../art/glyphs";

export interface ExamineUI {
  show(name: string, description: string, visual: VisualSpec, palette: PaletteName, recipe?: IconRecipe, inferred?: boolean): void;
  hide(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function createExamineUI(container: HTMLElement): ExamineUI {
  const panel = el("section", "examine-panel");
  panel.hidden = true;
  panel.setAttribute("aria-label", "Examined object");
  const close = el("button", "examine-close");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => { panel.hidden = true; });
  const content = el("div", "examine-content");
  panel.append(close, content);
  container.append(panel);

  return {
    show(name, description, visual, palette, recipe, inferred = false) {
      const icon = getVisualCanvas(visual, palette, recipe, inferred, name);
      icon.className = "examine-icon";
      icon.setAttribute("aria-hidden", "true");
      const text = el("div", "examine-text");
      const heading = el("p", "examine-name");
      heading.textContent = name;
      const details = el("p", "examine-description");
      details.textContent = description;
      text.append(heading, details);
      content.replaceChildren(icon, text);
      panel.hidden = false;
    },
    hide() {
      panel.hidden = true;
    },
  };
}

export type CelebrationKind = "clue" | "truth" | "item" | "deduction";

export interface ProgressToasts {
  show(kind: CelebrationKind, label: string, text: string): void;
  clear(): void;
}

const TOAST_MS = 4200;
const MAX_TOASTS = 3;

const ICONS: Record<CelebrationKind, string> = { clue: "?", truth: "✓", item: "◆", deduction: "★" };

// Short celebratory toasts plus a soft glow over the play area. Motion is skipped when reduced motion is on.
export function createProgressToasts(container: HTMLElement): ProgressToasts {
  const glow = document.createElement("div");
  glow.className = "celebration-glow";
  glow.setAttribute("aria-hidden", "true");
  (container.closest("#game-shell") ?? container.parentElement ?? container).append(glow);
  let glowTimer = 0;

  const reducedMotion = (): boolean => document.documentElement.dataset.reducedMotion === "true";
  return {
    show(kind, label, text) {
      const toast = document.createElement("div");
      toast.className = `progress-toast progress-toast-${kind}`;
      const icon = document.createElement("span");
      icon.className = "progress-toast-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = ICONS[kind];
      const words = document.createElement("span");
      words.className = "progress-toast-text";
      const strong = document.createElement("strong");
      strong.textContent = `${label}: `;
      words.append(strong, text);
      toast.append(icon, words);
      container.append(toast);
      while (container.children.length > MAX_TOASTS) container.firstElementChild?.remove();
      window.setTimeout(() => toast.remove(), TOAST_MS);
      if (!reducedMotion()) {
        glow.dataset.kind = kind;
        glow.classList.remove("is-glowing");
        void glow.offsetWidth;
        glow.classList.add("is-glowing");
        window.clearTimeout(glowTimer);
        glowTimer = window.setTimeout(() => glow.classList.remove("is-glowing"), 1400);
      }
    },
    clear() {
      container.replaceChildren();
      glow.remove();
      window.clearTimeout(glowTimer);
    },
  };
}

// A clue or truth can be a whole sentence; toasts show the start of it.
export function shorten(text: string, limit = 80): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), limit - 20)).replace(/[,;:.\s]+$/, "")}…`;
}

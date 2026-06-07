// Start / pause menu.
//
// Shown on page load so the player can pick a seed before playing, and again
// when they press Escape mid-game (which releases pointer lock). The same
// overlay serves both modes: a "start" mode with a seed picker + Play, and a
// "pause" mode with Resume, manual Save, and an auto-save toggle.
//
// Styled via the `.menu-*` classes in index.html so it matches the in-game
// panels (coordinates HUD, render-distance selector).

import { parseSeed } from "../world/gen/settings";

export interface MenuCallbacks {
  /** Start a new game with the chosen seed. */
  onPlay: (seed: number) => void;
  /** Return to the running game. */
  onResume: () => void;
  /** Persist all unsaved edits; resolves with the number of chunks written. */
  onSaveProgress: () => Promise<number> | number;
  /** Toggle automatic saving on every edit. */
  onAutoSaveChange: (enabled: boolean) => void;
}

export class Menu {
  private overlay: HTMLDivElement;
  private startSection: HTMLDivElement;
  private pauseSection: HTMLDivElement;
  private seedInput: HTMLInputElement;
  private seedDisplay: HTMLSpanElement;
  private autoSaveCheckbox: HTMLInputElement;
  private status: HTMLDivElement;

  constructor(private callbacks: MenuCallbacks) {
    this.overlay = el("div", "menu-overlay");
    const card = el("div", "menu-card");
    this.overlay.appendChild(card);

    const title = el("div", "menu-title");
    title.textContent = "Cubeworld";
    card.appendChild(title);

    // --- Start mode ---------------------------------------------------------
    this.startSection = el("div", "menu-row");

    const seedRow = el("div", "menu-row");
    const seedLabel = el("label");
    seedLabel.textContent = "Seed";
    seedLabel.style.fontSize = "13px";
    this.seedInput = document.createElement("input");
    this.seedInput.type = "text";
    this.seedInput.spellcheck = false;
    seedRow.appendChild(seedLabel);
    seedRow.appendChild(this.seedInput);

    const randomBtn = button("Random seed", "menu-btn");
    randomBtn.addEventListener("click", () => {
      this.seedInput.value = String((Math.random() * 0x7fffffff) >>> 0);
    });

    const playBtn = button("Play", "menu-btn primary");
    playBtn.addEventListener("click", () => {
      this.callbacks.onPlay(parseSeed(this.seedInput.value));
    });
    // Enter in the seed field starts the game.
    this.seedInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") playBtn.click();
    });

    this.startSection.appendChild(seedRow);
    this.startSection.appendChild(randomBtn);
    this.startSection.appendChild(playBtn);
    card.appendChild(this.startSection);

    // --- Pause mode ---------------------------------------------------------
    this.pauseSection = el("div", "menu-row");

    const seedLine = el("div", "menu-seed-line");
    seedLine.append("Seed: ");
    this.seedDisplay = document.createElement("span");
    seedLine.appendChild(this.seedDisplay);

    const resumeBtn = button("Resume", "menu-btn primary");
    resumeBtn.addEventListener("click", () => this.callbacks.onResume());

    const saveBtn = button("Save progress", "menu-btn");
    saveBtn.addEventListener("click", async () => {
      this.status.textContent = "Saving…";
      const n = await this.callbacks.onSaveProgress();
      this.status.textContent =
        n > 0 ? `Saved ${n} chunk${n === 1 ? "" : "s"}.` : "No unsaved changes.";
    });

    const autoSaveLabel = el("label", "menu-toggle");
    this.autoSaveCheckbox = document.createElement("input");
    this.autoSaveCheckbox.type = "checkbox";
    this.autoSaveCheckbox.addEventListener("change", () => {
      this.callbacks.onAutoSaveChange(this.autoSaveCheckbox.checked);
      this.status.textContent = this.autoSaveCheckbox.checked
        ? "Auto-save on — edits save automatically."
        : "Auto-save off.";
    });
    autoSaveLabel.appendChild(this.autoSaveCheckbox);
    autoSaveLabel.append("Auto-save");

    this.status = el("div", "menu-status");

    this.pauseSection.appendChild(seedLine);
    this.pauseSection.appendChild(resumeBtn);
    this.pauseSection.appendChild(saveBtn);
    this.pauseSection.appendChild(autoSaveLabel);
    this.pauseSection.appendChild(this.status);
    card.appendChild(this.pauseSection);

    document.body.appendChild(this.overlay);
  }

  /** Show the start screen with a prefilled seed. */
  showStart(seed: number) {
    this.seedInput.value = String(seed);
    this.startSection.style.display = "flex";
    this.pauseSection.style.display = "none";
    this.overlay.classList.add("visible");
    this.seedInput.focus();
    this.seedInput.select();
  }

  /** Show the pause screen for the running game. */
  showPause(opts: { seed: number; autoSave: boolean }) {
    this.seedDisplay.textContent = String(opts.seed);
    this.autoSaveCheckbox.checked = opts.autoSave;
    this.status.textContent = "";
    this.startSection.style.display = "none";
    this.pauseSection.style.display = "flex";
    this.overlay.classList.add("visible");
  }

  hide() {
    this.overlay.classList.remove("visible");
  }

  get isVisible(): boolean {
    return this.overlay.classList.contains("visible");
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function button(label: string, className: string): HTMLButtonElement {
  const b = el("button", className);
  b.textContent = label;
  return b;
}

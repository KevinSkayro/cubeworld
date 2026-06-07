import { Game } from "./game/Game";
import { Menu } from "./ui/Menu";
import {
  loadSeed,
  saveSeed,
  DEFAULT_WORLD_SETTINGS,
} from "./world/gen/settings";

// One Game is created when the player first presses Play; the pause menu reuses
// it (no mid-game seed change — that's chosen once on the start screen).
let game: Game | null = null;

function showGameHud(visible: boolean) {
  document.body.classList.toggle("playing", visible);
}

const menu = new Menu({
  onPlay(seed) {
    saveSeed(seed);
    if (!game) {
      game = new Game(seed);
      // Escape (pointer-lock release) re-opens the menu in pause mode.
      game.onPause = () => {
        showGameHud(false);
        menu.showPause({ seed: game!.seed, autoSave: game!.isAutoSave() });
      };
      game.start();
    }
    menu.hide();
    showGameHud(true);
    game.setPaused(false);
    game.requestPointerLock();
  },

  onResume() {
    menu.hide();
    showGameHud(true);
    game?.setPaused(false);
    game?.requestPointerLock();
  },

  onSaveProgress() {
    return game ? game.saveProgress() : 0;
  },

  onAutoSaveChange(enabled) {
    game?.setAutoSave(enabled);
  },
});

menu.showStart(loadSeed(DEFAULT_WORLD_SETTINGS.seed));

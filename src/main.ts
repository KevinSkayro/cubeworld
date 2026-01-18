import { Game } from "./game/Game";

// function createStartScreen(onStart: () => void) {
//   const overlay = document.createElement("div");
//   overlay.style.position = "fixed";
//   overlay.style.inset = "0";
//   overlay.style.display = "flex";
//   overlay.style.alignItems = "center";
//   overlay.style.justifyContent = "center";
//   overlay.style.background = "rgba(0, 0, 0, 0.6)";
//   overlay.style.zIndex = "1000";

//   const button = document.createElement("button");
//   button.textContent = "Start Game";
//   button.style.padding = "12px 24px";
//   button.style.fontSize = "16px";
//   button.style.cursor = "pointer";

//   button.addEventListener("click", () => {
//     overlay.remove();
//     onStart();
//   });

//   overlay.appendChild(button);
//   document.body.appendChild(overlay);
// }

// createStartScreen(() => {
//   const game = new Game();
//   game.start();
// });
const game = new Game();
game.start();

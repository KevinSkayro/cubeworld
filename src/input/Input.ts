import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

export class Input {
  controls: PointerLockControls;
  keys: { [key: string]: boolean } = {};
  keyPresses: { [key: string]: boolean } = {};
  leftClick: boolean = false;
  rightClick: boolean = false;
  leftDown: boolean = false;
  rightDown: boolean = false;
  wheelDelta: number = 0; // Mouse wheel delta (positive = scroll up, negative = scroll down)

  constructor(camera: THREE.Camera, canvas: HTMLCanvasElement) {
    this.controls = new PointerLockControls(camera, canvas);

    canvas.addEventListener("click", () => {
      this.controls.lock();
    });

    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === canvas) {
        this.onLock();
      } else {
        this.onUnlock();
      }
    });

    document.addEventListener("keydown", (e) => {
      this.keys[e.key.toLowerCase()] = true;
      this.keyPresses[e.key.toLowerCase()] = true;
    });

    document.addEventListener("keyup", (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    document.addEventListener("mousedown", (e) => {
      if (this.controls.isLocked) {
        if (e.button === 0) this.leftClick = true;
        if (e.button === 2) this.rightClick = true;
        if (e.button === 0) this.leftDown = true;
        if (e.button === 2) this.rightDown = true;
      }
    });

    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.leftDown = false;
      if (e.button === 2) this.rightDown = false;
    });

    document.addEventListener("wheel", (e) => {
      if (this.controls.isLocked) {
        // Accumulate wheel delta
        this.wheelDelta += e.deltaY > 0 ? 1 : -1;
      }
    }, { passive: true });

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  onLock() {
    // Mouse is locked
  }

  onUnlock() {
    // Mouse is unlocked (ESC pressed)
  }

  isKeyPressed(key: string): boolean {
    return this.keys[key.toLowerCase()] === true;
  }

  consumeLeftClick(): boolean {
    const clicked = this.leftClick;
    this.leftClick = false;
    return clicked;
  }

  consumeRightClick(): boolean {
    const clicked = this.rightClick;
    this.rightClick = false;
    return clicked;
  }

  consumeKeyPress(key: string): boolean {
    const k = key.toLowerCase();
    const pressed = this.keyPresses[k] === true;
    if (pressed) this.keyPresses[k] = false;
    return pressed;
  }

  isLeftDown(): boolean {
    return this.leftDown;
  }

  isRightDown(): boolean {
    return this.rightDown;
  }

  consumeWheelDelta(): number {
    const delta = this.wheelDelta;
    this.wheelDelta = 0;
    return delta;
  }
}

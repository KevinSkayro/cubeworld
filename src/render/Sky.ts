// The sky: a sun and moon that arc overhead, with lighting and sky colour that
// follow them through dawn / day / dusk / night.
//
// Owns the scene's directional + ambient lights (moved here from Renderer) so
// all "what colour and how bright is the world right now" logic lives in one
// place. Driven each frame by TimeOfDay's hour via `update(hours, cameraPos)`.
//
// Model: the sun travels a vertical arc - below the horizon at midnight, due
// east at 06:00 (sunrise), overhead at noon, due west at 18:00 (sunset). The
// moon sits exactly opposite. A single directional light points from whichever
// body is up; its intensity ramps to ~0 as that body nears the horizon, so the
// hand-off (and the direction flip) is hidden by darkness at dawn/dusk. Sky and
// fog colour lerp night→day with an orange glow when the sun is near the
// horizon.

import * as THREE from "three";

// Apparent size of the sun/moon discs, as a fraction of their distance from the
// camera (constant angular size regardless of render distance).
const DISC_SIZE = 0.04;
// A slight north tilt to the arc so the sun doesn't pass straight through the
// zenith — reads more naturally.
const ARC_TILT = 0.25;

// Colour palette (tunable).
const DAY_SKY = new THREE.Color(0x87ceeb);
const NIGHT_SKY = new THREE.Color(0x222e4d); // dim blue night — dark but not black
const DUSK_GLOW = new THREE.Color(0xff8347); // sunrise/sunset horizon tint
const SUN_COLOR = new THREE.Color(0xfff4d6);
const SUN_LOW_COLOR = new THREE.Color(0xff9d52); // sun near the horizon
const MOON_COLOR = new THREE.Color(0xbcccea);
const DAY_AMBIENT = new THREE.Color(0xffffff);
const NIGHT_AMBIENT = new THREE.Color(0x7d8cb5); // moonlit blue, bright enough to see by

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class Sky {
  private scene: THREE.Scene;
  private sun: THREE.Mesh;
  private moon: THREE.Mesh;
  private sunLight: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;

  // Scratch objects reused each frame (no per-frame allocation).
  private readonly sunDir = new THREE.Vector3();
  private readonly skyColor = new THREE.Color();
  private readonly lightColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.ambient = new THREE.AmbientLight(DAY_AMBIENT, 0.6);
    scene.add(this.ambient);

    this.sunLight = new THREE.DirectionalLight(SUN_COLOR, 0.9);
    scene.add(this.sunLight);

    // Unlit discs, unaffected by fog so they stay visible at the sky's distance,
    // and don't write depth so terrain in front still occludes them naturally.
    const sunMat = new THREE.MeshBasicMaterial({
      color: SUN_COLOR,
      fog: false,
      depthWrite: false,
    });
    const moonMat = new THREE.MeshBasicMaterial({
      color: MOON_COLOR,
      fog: false,
      depthWrite: false,
    });
    const disc = new THREE.SphereGeometry(1, 16, 16);
    this.sun = new THREE.Mesh(disc, sunMat);
    this.moon = new THREE.Mesh(disc, moonMat);
    scene.add(this.sun);
    scene.add(this.moon);
  }

  /**
   * Update sun/moon position and all lighting/sky colour for the given hour.
   * `cameraPos` keeps the bodies centred on the viewer (they read as infinitely
   * far). `viewDistance` is the camera far plane, so the discs sit just inside
   * it regardless of render-distance setting.
   */
  update(hours: number, cameraPos: THREE.Vector3, viewDistance: number): void {
    // Sun arc angle: -π/2 at midnight (straight down), 0 at 06:00 (east
    // horizon), +π/2 at noon (up), +π at 18:00 (west horizon).
    const a = (hours / 24) * Math.PI * 2 - Math.PI / 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // East-up with a small north tilt; normalised.
    this.sunDir.set(cos, sin, ARC_TILT).normalize();
    const elevation = this.sunDir.y; // >0 sun is up, <0 moon is up

    // Place the discs just inside the far plane, centred on the camera.
    const dist = Math.max(64, viewDistance * 0.85);
    const size = dist * DISC_SIZE;
    this.sun.scale.setScalar(size);
    this.moon.scale.setScalar(size);
    this.sun.position.copy(cameraPos).addScaledVector(this.sunDir, dist);
    this.moon.position.copy(cameraPos).addScaledVector(this.sunDir, -dist);

    // Day / night weights. The fade is pinned tight to the horizon (full
    // daylight holds while the sun is still visibly up, then dusk happens in the
    // last sliver before it sets), and the ramp passes through ~0.2 at the
    // horizon — low enough that the sun→moon direction flip at elevation 0 is
    // masked, and where the sun/moon directional intensities meet so there's no
    // brightness jump at the hand-off.
    const dayWeight = smoothstep(-0.03, 0.07, elevation);
    const nightWeight = smoothstep(-0.03, 0.07, -elevation);

    // Directional light follows whichever body is above the horizon.
    if (elevation >= 0) {
      this.lightColor.copy(SUN_LOW_COLOR).lerp(SUN_COLOR, dayWeight);
      this.sunLight.color.copy(this.lightColor);
      this.sunLight.intensity = 0.2 + 0.7 * dayWeight;
      this.sunLight.position.copy(this.sunDir);
    } else {
      this.sunLight.color.copy(MOON_COLOR);
      this.sunLight.intensity = 0.25 + 0.35 * nightWeight;
      this.sunLight.position.copy(this.sunDir).multiplyScalar(-1);
    }

    // Ambient: bright neutral by day, soft moonlit blue at night (kept high
    // enough to navigate by).
    this.ambient.color.copy(NIGHT_AMBIENT).lerp(DAY_AMBIENT, dayWeight);
    this.ambient.intensity = 0.72 + 0.13 * dayWeight;

    // Sky colour: night→day, plus an orange glow when the sun rides the horizon
    // (dawn and dusk), strongest right at elevation 0.
    this.skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, dayWeight);
    const glow = Math.max(0, 1 - Math.abs(elevation) / 0.25);
    this.skyColor.lerp(DUSK_GLOW, glow * 0.6);

    (this.scene.background as THREE.Color).copy(this.skyColor);
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.copy(this.skyColor);
  }
}

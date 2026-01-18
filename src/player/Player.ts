import * as THREE from "three";
import { Input } from "../input/Input";
import { BLOCK_AIR } from "../world/constants";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { TextureLoader, SRGBColorSpace } from "three";

const EPS = 1e-3; // Small offset to avoid getting stuck on freshly mined blocks

export class Player {
  position: THREE.Vector3;
  velocity: THREE.Vector3 = new THREE.Vector3();
  speed: number = 0.1;
  input: Input;
  camera: THREE.Camera;
  gravity: number = -0.02;
  jumpStrength: number = 0.3;
  onGround: boolean = false;
  height: number = 1.6;
  radius: number = 0.15;
  thirdPerson: boolean = false;
  thirdPersonDistance: number = 3;
  thirdPersonHeight: number = 1;
  checkBlock: (x: number, y: number, z: number) => number;
  scene: THREE.Scene;
  model: THREE.Object3D | null = null;
  modelLoaded: boolean = false;
  fallbackTexture: THREE.Texture | null = null;

  constructor(
    camera: THREE.Camera,
    input: Input,
    scene: THREE.Scene,
    checkBlock: (x: number, y: number, z: number) => number,
  ) {
    this.camera = camera;
    this.input = input;
    this.scene = scene;
    this.checkBlock = checkBlock;
    this.position = camera.position.clone();
    this.loadModel();
  }

  private loadModel() {
    // Preload a fallback diffuse texture in case the GLB materials miss theirs
    const texLoader = new TextureLoader();
    texLoader.load(
      new URL("./textures/png/texture-b.png", import.meta.url).href,
      (tex) => {
        tex.colorSpace = SRGBColorSpace;
        this.fallbackTexture = tex;
      },
    );

    const loader = new GLTFLoader();
    // Textures are in textures/png alongside the GLB
    loader.setResourcePath(new URL("./textures/png/", import.meta.url).href);
    const url = new URL("./textures/character-b.glb", import.meta.url).href;

    loader.load(
      url,
      (gltf) => {
        this.model = gltf.scene;
        this.model.traverse((child) => {
          // Ensure meshes cast/receive light
          if ((child as THREE.Mesh).isMesh) {
            (child as THREE.Mesh).castShadow = false;
            (child as THREE.Mesh).receiveShadow = false;
            const mat = (child as THREE.Mesh).material as THREE.Material;
            const anyMat = mat as any;
            if (anyMat.map) {
              anyMat.map.colorSpace = SRGBColorSpace;
              anyMat.map.needsUpdate = true;
            } else if (this.fallbackTexture) {
              anyMat.map = this.fallbackTexture;
              anyMat.map.needsUpdate = true;
            }
            if (anyMat.emissiveMap) {
              anyMat.emissiveMap.colorSpace = SRGBColorSpace;
              anyMat.emissiveMap.needsUpdate = true;
            }
            console.log("Model material", {
              name: (child as THREE.Mesh).name,
              hasMap: Boolean(anyMat.map),
              hasEmissiveMap: Boolean(anyMat.emissiveMap),
              hasNormalMap: Boolean(anyMat.normalMap),
              hasRoughnessMap: Boolean(anyMat.roughnessMap),
              hasMetalnessMap: Boolean(anyMat.metalnessMap),
            });
            mat.needsUpdate = true;
          }
        });
        this.scene.add(this.model);
        this.modelLoaded = true;
        this.updateModelTransform();
      },
      undefined,
      (err) => {
        console.warn("Failed to load player model", err);
      },
    );
  }

  update() {
    // Apply gravity
    this.velocity.y += this.gravity;

    // Horizontal movement
    const direction = new THREE.Vector3();

    if (this.input.isKeyPressed("w")) {
      direction.z -= 1;
    }
    if (this.input.isKeyPressed("s")) {
      direction.z += 1;
    }
    if (this.input.isKeyPressed("a")) {
      direction.x -= 1;
    }
    if (this.input.isKeyPressed("d")) {
      direction.x += 1;
    }

    if (direction.length() > 0) {
      direction.normalize();
      direction.applyQuaternion(this.camera.quaternion);
      direction.y = 0; // Keep movement horizontal
      direction.normalize();
      this.velocity.x = direction.x * this.speed;
      this.velocity.z = direction.z * this.speed;
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    // Jump
    if (this.input.isKeyPressed(" ") && this.onGround) {
      this.velocity.y = this.jumpStrength;
      this.onGround = false;
    }

    // Apply velocity with collision: resolve vertical first to avoid sideways push when landing
    this.position.y += this.velocity.y;
    this.resolveCollisionY();

    this.position.x += this.velocity.x;
    this.resolveCollisionX();

    this.position.z += this.velocity.z;
    this.resolveCollisionZ();

    this.updateCameraPosition();
    this.updateModelTransform();
  }

  setThirdPerson(enabled: boolean) {
    this.thirdPerson = enabled;
  }

  private updateCameraPosition() {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.camera.quaternion,
    );
    forward.y = 0;
    forward.normalize();

    const camPos = this.position.clone();
    if (this.thirdPerson) {
      camPos.addScaledVector(forward, -this.thirdPersonDistance);
      camPos.y += this.thirdPersonHeight;
    }

    this.camera.position.copy(camPos);
  }

  private updateModelTransform() {
    if (!this.model || !this.modelLoaded) return;
    // Place model so feet are at ground; position is at camera height
    this.model.position.set(
      this.position.x,
      this.position.y - this.height,
      this.position.z,
    );
    this.model.visible = this.thirdPerson;
  }

  private resolveCollisionX() {
    const feet = this.position.y - this.height;
    const head = this.position.y;

    const xMinIdx = Math.floor(this.position.x - this.radius + EPS);
    const xMaxIdx = Math.floor(this.position.x + this.radius - EPS);
    const yMinIdx = Math.floor(feet + EPS);
    const yMaxIdx = Math.floor(head - EPS);

    for (let y = yMinIdx; y <= yMaxIdx; y++) {
      for (
        let z = Math.floor(this.position.z - this.radius + EPS);
        z <= Math.floor(this.position.z + this.radius - EPS);
        z++
      ) {
        if (this.checkBlock(xMinIdx, y, z) !== BLOCK_AIR) {
          this.position.x = xMinIdx + 1 + this.radius;
        }
        if (this.checkBlock(xMaxIdx, y, z) !== BLOCK_AIR) {
          this.position.x = xMaxIdx - this.radius - EPS;
        }
      }
    }
  }

  private resolveCollisionZ() {
    const feet = this.position.y - this.height;
    const head = this.position.y;

    const zMinIdx = Math.floor(this.position.z - this.radius + EPS);
    const zMaxIdx = Math.floor(this.position.z + this.radius - EPS);
    const yMinIdx = Math.floor(feet + EPS);
    const yMaxIdx = Math.floor(head - EPS);

    for (let y = yMinIdx; y <= yMaxIdx; y++) {
      for (
        let x = Math.floor(this.position.x - this.radius + EPS);
        x <= Math.floor(this.position.x + this.radius - EPS);
        x++
      ) {
        if (this.checkBlock(x, y, zMinIdx) !== BLOCK_AIR) {
          this.position.z = zMinIdx + 1 + this.radius;
        }
        if (this.checkBlock(x, y, zMaxIdx) !== BLOCK_AIR) {
          this.position.z = zMaxIdx - this.radius - EPS;
        }
      }
    }
  }

  private resolveCollisionY() {
    const feet = this.position.y - this.height;
    const head = this.position.y;

    this.onGround = false;

    for (
      let x = Math.floor(this.position.x - this.radius + EPS);
      x <= Math.floor(this.position.x + this.radius - EPS);
      x++
    ) {
      for (
        let z = Math.floor(this.position.z - this.radius + EPS);
        z <= Math.floor(this.position.z + this.radius - EPS);
        z++
      ) {
        // Check feet (going down)
        if (this.velocity.y <= 0) {
          const feetBlock = Math.floor(feet - EPS);
          if (this.checkBlock(x, feetBlock, z) !== BLOCK_AIR) {
            this.position.y = feetBlock + 1 + this.height;
            this.velocity.y = 0;
            this.onGround = true;
          }
        }

        // Check head (going up)
        if (this.velocity.y > 0) {
          const headBlock = Math.floor(head + EPS);
          if (this.checkBlock(x, headBlock, z) !== BLOCK_AIR) {
            this.position.y = headBlock - EPS;
            this.velocity.y = 0;
          }
        }
      }
    }
  }
}

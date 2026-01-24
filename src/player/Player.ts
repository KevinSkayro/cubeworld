import * as THREE from "three";
import { Input } from "../input/Input";
import { BLOCK_AIR, BLOCK_GRASS, BLOCK_STONE } from "../world/constants";
import { TextureLoader, SRGBColorSpace } from "three";
import grassFootstepSound from "@/assets/player/audio/footstep_grass_004.ogg";
import stoneFootstepSound from "@/assets/player/audio/footstep_stone_002.ogg";

const EPS = 1e-3; // Small offset to avoid getting stuck on freshly mined blocks

// Custom skin texture layout - 1024x1024 with labeled regions
const SKIN_WIDTH = 1024;
const SKIN_HEIGHT = 1024;

export class Player {
  position: THREE.Vector3;
  velocity: THREE.Vector3 = new THREE.Vector3();
  speed: number = 0.1;
  input: Input;
  camera: THREE.Camera;
  gravity: number = -0.02;
  jumpStrength: number = 0.22;
  jumpCooldown: number = 0;
  jumpCooldownDuration: number = 0.5; // Cooldown duration in seconds
  wasSpacePressed: boolean = false; // Track if space was pressed in previous frame
  onGround: boolean = false;
  height: number = 1.6;
  radius: number = 0.15;
  thirdPerson: boolean = false;
  thirdPersonDistance: number = 3;
  thirdPersonHeight: number = 1;
  checkBlock: (x: number, y: number, z: number) => number;
  scene: THREE.Scene;
  model: THREE.Group | null = null;
  modelLoaded: boolean = false;
  skinTexture: THREE.Texture | null = null;
  
  // Limb references for animation
  leftArm: THREE.Group | null = null;
  rightArm: THREE.Group | null = null;
  leftLeg: THREE.Group | null = null;
  rightLeg: THREE.Group | null = null;
  
  // Animation state
  walkTime: number = 0;
  walkSpeed: number = 10; // How fast the limbs swing
  walkAmplitude: number = 0.5; // Max rotation in radians (~30 degrees)
  
  // Audio
  grassFootstepAudio: HTMLAudioElement;
  stoneFootstepAudio: HTMLAudioElement;
  footstepCooldown: number = 0;
  footstepInterval: number = 0.315; // Time between footsteps in seconds

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
    
    // Initialize footstep audio
    this.grassFootstepAudio = new Audio(grassFootstepSound);
    this.grassFootstepAudio.volume = 0.1;
    this.grassFootstepAudio.preload = "auto";
    
    this.stoneFootstepAudio = new Audio(stoneFootstepSound);
    this.stoneFootstepAudio.volume = 0.1;
    this.stoneFootstepAudio.preload = "auto";
    
    this.loadModel();
  }

  private loadModel() {
    const texLoader = new TextureLoader();
    const textureUrl = new URL("@/assets/player/textures/texture-a.png", import.meta.url).href;
    
    texLoader.load(
      textureUrl,
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        this.skinTexture = texture;
        this.createMinecraftModel();
      },
      undefined,
      (err) => {
        console.warn("Failed to load player texture", err);
      }
    );
  }

  private createMinecraftModel() {
    if (!this.skinTexture) return;

    this.model = new THREE.Group();
    
    const material = new THREE.MeshLambertMaterial({
      map: this.skinTexture,
    });

    // Scale: 1 unit = 1 block, player is about 1.875 blocks tall (32 pixels)
    const pixelSize = 1 / 16; // Each pixel = 1/16 of a block
    
    // Model origin is at feet level (y=0)
    // Leg height: 12 pixels, Body height: 12 pixels, Head height: 8 pixels
    // Total: 32 pixels = 2 blocks

    // Head (8x8x8 game pixels) - UV coords for 1024x1024 texture
    // Head is in upper-left area of texture
    const head = this.createBoxWithUVs(
      8 * pixelSize, 8 * pixelSize, 8 * pixelSize,
      material,
      {
        right:   { x: 256, y: 128, w: 128, h: 128 },
        left:  { x: 0,   y: 128, w: 128, h: 128 },   // Left side of head
        top:    { x: 128, y: 0,   w: 128, h: 128 },   // Top of head (hair)
        bottom: { x: 256, y: 0,   w: 128, h: 128 },   // Bottom of head
        front:  { x: 128, y: 128, w: 128, h: 128 },   // Face
        back:   { x: 384, y: 128, w: 128, h: 128 },   // Back of head
      }
    );
    head.position.y = 28 * pixelSize;
    this.model.add(head);

    // Body (8x12x4 game pixels) - Torso section in lower-left of texture
    const body = this.createBoxWithUVs(
      8 * pixelSize, 12 * pixelSize, 4 * pixelSize,
      material,
      {
        right:  { x: 0,   y: 704, w: 64,  h: 192 },   // Left side (red)
        left:   { x: 288, y: 704, w: 64,  h: 192 },   // Right side (red)
        top:    { x: 64,  y: 640, w: 128, h: 64 },    // Top (shoulders)
        bottom: { x: 192, y: 640, w: 128, h: 64 },    // Bottom
        front:  { x: 96,  y: 770, w: 128, h: 192 },   // Front (red with straps)
        back:   { x: 320, y: 770, w: 128, h: 192 },   // Back (red)
      }
    );
    body.position.y = 18 * pixelSize;
    this.model.add(body);

    // Right Arm (4x12x4 game pixels) - "Arm (right)" section
    // Wrap in pivot group for shoulder rotation
    this.rightArm = new THREE.Group();
    const rightArmMesh = this.createBoxWithUVs(
      4 * pixelSize, 12 * pixelSize, 4 * pixelSize,
      material,
      {
        right:  { x: 768, y: 336, w: 64,  h: 192 },   // Outer (red)
        left:   { x: 896, y: 336, w: 64,  h: 192 },   // Inner (skin)
        top:    { x: 832, y: 272, w: 64,  h: 64 },    // Top (shoulder/skin)
        bottom: { x: 896, y: 272, w: 64,  h: 64 },    // Bottom (hand)
        front:  { x: 832, y: 336, w: 64,  h: 192 },   // Front (red)
        back:   { x: 960, y: 336, w: 64,  h: 192 },   // Back (red)
      }
    );
    // Offset mesh so pivot is at shoulder (top of arm)
    rightArmMesh.position.y = -6 * pixelSize;
    this.rightArm.add(rightArmMesh);
    this.rightArm.position.set(-6 * pixelSize, 24 * pixelSize, 0);
    this.model.add(this.rightArm);

    // Left Arm (4x12x4 game pixels) - "Arm (left)" section
    this.leftArm = new THREE.Group();
    const leftArmMesh = this.createBoxWithUVs(
      4 * pixelSize, 12 * pixelSize, 4 * pixelSize,
      material,
      {
        right:  { x: 480, y: 336, w: 64,  h: 192 },   // Inner (skin)
        left:   { x: 608, y: 336, w: 64,  h: 192 },   // Outer (red)
        top:    { x: 544, y: 272, w: 64,  h: 64 },    // Top (shoulder/skin)
        bottom: { x: 608, y: 272, w: 64,  h: 64 },    // Bottom (hand)
        front:  { x: 544, y: 336, w: 64,  h: 192 },   // Front (red)
        back:   { x: 672, y: 336, w: 64,  h: 192 },   // Back (red)
      }
    );
    leftArmMesh.position.y = -6 * pixelSize;
    this.leftArm.add(leftArmMesh);
    this.leftArm.position.set(6 * pixelSize, 24 * pixelSize, 0);
    this.model.add(this.leftArm);

    // Right Leg (4x12x4 game pixels) - "Leg (right)" section
    this.rightLeg = new THREE.Group();
    const rightLegMesh = this.createBoxWithUVs(
      4 * pixelSize, 12 * pixelSize, 4 * pixelSize,
      material,
      {
        right:  { x: 768, y: 624, w: 64,  h: 192 },   // Outer (blue)
        left:   { x: 896, y: 624, w: 64,  h: 192 },   // Inner (skin)
        top:    { x: 832, y: 560, w: 64,  h: 64 },    // Top
        bottom: { x: 896, y: 560, w: 64,  h: 64 },    // Bottom (shoe)
        front:  { x: 832, y: 624, w: 64,  h: 192 },   // Front (blue)
        back:   { x: 960, y: 624, w: 64,  h: 192 },   // Back (blue)
      }
    );
    // Offset mesh so pivot is at hip (top of leg)
    rightLegMesh.position.y = -6 * pixelSize;
    this.rightLeg.add(rightLegMesh);
    this.rightLeg.position.set(-2 * pixelSize, 12 * pixelSize, 0);
    this.model.add(this.rightLeg);

    // Left Leg (4x12x4 game pixels) - "Leg (left)" section
    this.leftLeg = new THREE.Group();
    const leftLegMesh = this.createBoxWithUVs(
      4 * pixelSize, 12 * pixelSize, 4 * pixelSize,
      material,
      {
        right:  { x: 480, y: 624, w: 64,  h: 192 },   // Inner (skin)
        left:   { x: 608, y: 624, w: 64,  h: 192 },   // Outer (blue)
        top:    { x: 544, y: 560, w: 64,  h: 64 },    // Top
        bottom: { x: 608, y: 560, w: 64,  h: 64 },    // Bottom (shoe)
        front:  { x: 544, y: 624, w: 64,  h: 192 },   // Front (blue)
        back:   { x: 672, y: 624, w: 64,  h: 192 },   // Back (blue)
      }
    );
    leftLegMesh.position.y = -6 * pixelSize;
    this.leftLeg.add(leftLegMesh);
    this.leftLeg.position.set(2 * pixelSize, 12 * pixelSize, 0);
    this.model.add(this.leftLeg);

    this.scene.add(this.model);
    this.modelLoaded = true;
    this.updateModelTransform();
  }

  private createBoxWithUVs(
    width: number, height: number, depth: number,
    material: THREE.Material,
    faces: {
      right: { x: number, y: number, w: number, h: number },
      left: { x: number, y: number, w: number, h: number },
      top: { x: number, y: number, w: number, h: number },
      bottom: { x: number, y: number, w: number, h: number },
      front: { x: number, y: number, w: number, h: number },
      back: { x: number, y: number, w: number, h: number },
    }
  ): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    
    // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
    // Each face has 4 UV coordinates (2 triangles, but sharing vertices)
    const uvAttribute = geometry.getAttribute('uv');
    const uvArray = uvAttribute.array as Float32Array;
    
    const faceOrder = ['right', 'left', 'top', 'bottom', 'front', 'back'] as const;
    
    for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
      const face = faces[faceOrder[faceIdx]];
      const baseIdx = faceIdx * 8; // 4 vertices * 2 components
      
      // Convert pixel coordinates to UV (0-1 range)
      // Note: UV origin is bottom-left, texture origin is top-left
      const u0 = face.x / SKIN_WIDTH;
      const v0 = 1 - (face.y + face.h) / SKIN_HEIGHT;
      const u1 = (face.x + face.w) / SKIN_WIDTH;
      const v1 = 1 - face.y / SKIN_HEIGHT;
      
      // BoxGeometry UV layout per face: [0,1], [1,1], [0,0], [1,0]
      uvArray[baseIdx + 0] = u0; uvArray[baseIdx + 1] = v1; // top-left
      uvArray[baseIdx + 2] = u1; uvArray[baseIdx + 3] = v1; // top-right
      uvArray[baseIdx + 4] = u0; uvArray[baseIdx + 5] = v0; // bottom-left
      uvArray[baseIdx + 6] = u1; uvArray[baseIdx + 7] = v0; // bottom-right
    }
    
    uvAttribute.needsUpdate = true;
    
    return new THREE.Mesh(geometry, material);
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
    const isSpacePressed = this.input.isKeyPressed(" ");
    const spaceJustPressed = isSpacePressed && !this.wasSpacePressed; // Space was just pressed this frame
    
    // Reset cooldown if space was just pressed (user released and pressed again)
    if (spaceJustPressed) {
      this.jumpCooldown = 0;
    }
    
    if (isSpacePressed && this.onGround && this.jumpCooldown <= 0) {
      this.velocity.y = this.jumpStrength;
      this.onGround = false;
      this.jumpCooldown = this.jumpCooldownDuration; // Reset cooldown
    }
    
    // Update jump cooldown
    if (this.jumpCooldown > 0) {
      this.jumpCooldown -= 0.016; // Assuming ~60fps, decrement by delta time
    }
    
    // Remember if space was pressed for next frame
    this.wasSpacePressed = isSpacePressed;

    // Apply velocity with collision: resolve vertical first to avoid sideways push when landing
    this.position.y += this.velocity.y;
    this.resolveCollisionY();

    this.position.x += this.velocity.x;
    this.resolveCollisionX();

    this.position.z += this.velocity.z;
    this.resolveCollisionZ();

    this.updateCameraPosition();
    this.updateModelTransform();
    this.updateWalkAnimation();
    this.updateFootsteps();
  }

  private updateWalkAnimation() {
    // Check if player is moving horizontally
    const isMoving = Math.abs(this.velocity.x) > 0.001 || Math.abs(this.velocity.z) > 0.001;
    
    if (isMoving && this.onGround) {
      // Increment walk time based on movement speed
      this.walkTime += this.walkSpeed * 0.016; // Assuming ~60fps
      
      // Calculate swing angle using sine wave
      const swing = Math.sin(this.walkTime) * this.walkAmplitude;
      
      // Animate limbs - arms and legs swing opposite to each other
      if (this.leftArm) this.leftArm.rotation.x = swing;
      if (this.rightArm) this.rightArm.rotation.x = -swing;
      if (this.leftLeg) this.leftLeg.rotation.x = -swing;
      if (this.rightLeg) this.rightLeg.rotation.x = swing;
    } else {
      // Return to idle pose smoothly
      const returnSpeed = 0.1;
      if (this.leftArm) this.leftArm.rotation.x *= (1 - returnSpeed);
      if (this.rightArm) this.rightArm.rotation.x *= (1 - returnSpeed);
      if (this.leftLeg) this.leftLeg.rotation.x *= (1 - returnSpeed);
      if (this.rightLeg) this.rightLeg.rotation.x *= (1 - returnSpeed);
    }
  }

  private getBlockUnderFeet(): number {
    const feetY = Math.floor(this.position.y - this.height - EPS);
    const blockX = Math.floor(this.position.x);
    const blockZ = Math.floor(this.position.z);
    return this.checkBlock(blockX, feetY, blockZ);
  }

  private updateFootsteps() {
    // Update cooldown
    if (this.footstepCooldown > 0) {
      this.footstepCooldown -= 0.016; // Assuming ~60fps
    }

    // Check if player is moving and on ground
    const isMoving = Math.abs(this.velocity.x) > 0.001 || Math.abs(this.velocity.z) > 0.001;
    
    if (isMoving && this.onGround && this.footstepCooldown <= 0) {
      const blockType = this.getBlockUnderFeet();
      
      // Play footstep sound based on block type
      if (blockType === BLOCK_GRASS) {
        // Reset audio to beginning and play
        this.grassFootstepAudio.currentTime = 0;
        this.grassFootstepAudio.play().catch((err) => {
          // Ignore audio play errors (e.g., user hasn't interacted with page yet)
          console.debug("Grass footstep audio play failed:", err);
        });
        
        // Reset cooldown
        this.footstepCooldown = this.footstepInterval;
      } else if (blockType === BLOCK_STONE) {
        // Play stone footstep sound
        this.stoneFootstepAudio.currentTime = 0;
        this.stoneFootstepAudio.play().catch((err) => {
          // Ignore audio play errors (e.g., user hasn't interacted with page yet)
          console.debug("Stone footstep audio play failed:", err);
        });
        
        // Reset cooldown
        this.footstepCooldown = this.footstepInterval;
      }
    }
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
    
    // Rotate model to face the same direction as the camera (yaw only)
    // Get the camera's forward direction projected onto the XZ plane
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(this.camera.quaternion);
    forward.y = 0; // Ignore vertical component
    forward.normalize();
    
    // Calculate the angle from the forward vector
    const angle = Math.atan2(forward.x, forward.z);
    this.model.rotation.y = angle;
    
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

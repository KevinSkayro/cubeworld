import * as THREE from "three";
import { Renderer } from "../render/Renderer";
import { Input } from "../input/Input";
import { Player } from "../player/Player";
import { World } from "../world/World";
import { ChunkManager } from "../world/ChunkManager";
import { CHUNK_SIZE, BLOCK_AIR, BLOCK_STONE, BLOCK_GRASS, BLOCK_DIRT,BLOCK_SAND, BLOCK_SNOW, MAX_BUILD_HEIGHT } from "../world/constants";
import { MesherWorkerResponse } from "../world/meshing/types";
import { voxelRaycast } from "../world/raycast/voxelRaycast";
import { TextureAtlas } from "../world/textures/atlas";
import {
  WorldSettings,
  DEFAULT_WORLD_SETTINGS,
  RENDER_RADIUS_MIN,
  RENDER_RADIUS_MAX,
  loadRenderRadius,
  saveRenderRadius,
} from "../world/gen/settings";
import { makeNoise, NoiseSampler } from "../world/gen/noise";
import { columnHeight } from "../world/gen/terrain";
import { BiomeOverlay } from "../debug/BiomeOverlay";
import { CoordsOverlay } from "../debug/CoordsOverlay";

interface WorldgenWorkerResponse {
  chunkKey: string;
  blocks: Uint16Array;
}

export class Game {
  renderer: Renderer;
  input: Input;
  player: Player;
  world: World;
  chunkManager: ChunkManager;
  mesherWorker: Worker;
  worldgenWorker: Worker;
  seed: number = 12345;
  settings: WorldSettings;
  biomeNoise: NoiseSampler;
  biomeOverlay: BiomeOverlay;
  coordsOverlay: CoordsOverlay;
  settingsPanel: HTMLElement | null = null;
  running: boolean = false;
  mineTargetKey: string | null = null;
  mineStartTime: number = 0;
  mineHoldMs: number = 500;
  placeCooldownMs: number = 200; // Cooldown between block placements
  lastPlaceTime: number = 0;
  thirdPerson: boolean = false;
  textureAtlas: TextureAtlas;
  chunkMaterial: THREE.MeshPhongMaterial;
  
  // Block selection
  selectedBlockType: number = BLOCK_STONE;
  hotbarSlots: Array<{ blockType: number; name: string }> = [
    { blockType: BLOCK_GRASS, name: "Grass" },
    { blockType: BLOCK_DIRT, name: "Dirt" },
    { blockType: BLOCK_STONE, name: "Stone" },
    { blockType: BLOCK_SAND, name: "Sand" },
    { blockType: BLOCK_SNOW, name: "Snow" },
  ];
  hotbarElement: HTMLElement | null = null;

  constructor() {
    this.settings = {
      ...DEFAULT_WORLD_SETTINGS,
      seed: this.seed,
      renderRadius: loadRenderRadius(DEFAULT_WORLD_SETTINGS.renderRadius),
    };

    this.renderer = new Renderer();
    this.renderer.setRenderDistance(this.settings.renderRadius * CHUNK_SIZE);
    this.input = new Input(this.renderer.camera, this.renderer.canvas);
    this.world = new World();
    this.player = new Player(
      this.renderer.camera,
      this.input,
      this.renderer.scene,
      (x, y, z) => this.world.getBlock(x, y, z),
    );

    // Spawn the player just above the actual terrain surface at the spawn
    // column (terrain is now deep, so a fixed Y would start inside the ground).
    this.biomeNoise = makeNoise(this.settings.seed);
    const spawnX = this.player.position.x;
    const spawnZ = this.player.position.z;
    const spawnHeight = columnHeight(
      this.biomeNoise,
      Math.floor(spawnX),
      Math.floor(spawnZ),
    );
    this.player.position.set(spawnX, spawnHeight + 3, spawnZ);

    // Create texture atlas and material
    this.textureAtlas = new TextureAtlas();
    this.chunkMaterial = new THREE.MeshPhongMaterial({
      map: this.textureAtlas.texture,
      // Cut out transparent texels (leaf gaps) instead of showing the atlas
      // background; opaque blocks (alpha 1) are unaffected.
      alphaTest: 0.5,
    });

    // Create workers
    this.mesherWorker = new Worker(
      new URL("../workers/mesher.worker.ts", import.meta.url),
      { type: "module" },
    );
    this.mesherWorker.onmessage = (event: MessageEvent<MesherWorkerResponse>) =>
      this.onMeshReady(event.data);

    this.worldgenWorker = new Worker(
      new URL("../workers/worldgen.worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worldgenWorker.onmessage = (
      event: MessageEvent<WorldgenWorkerResponse>,
    ) => this.onWorldgenComplete(event.data);

    // Create chunk manager
    this.chunkManager = new ChunkManager(
      this.world,
      this.renderer.scene,
      this.mesherWorker,
      this.worldgenWorker,
      this.settings,
      (key, meshData) => this.onMeshReady({ chunkKey: key, meshData }),
    );

    // Load initial chunks around player spawn
    this.chunkManager.update(
      this.player.position.x,
      this.player.position.y,
      this.player.position.z,
    );

    // Initialize hotbar UI
    this.initHotbar();

    // Initialize settings UI (render distance slider)
    this.initSettings();

    // Debug: biome parameter visualizer (toggle with 'B')
    this.biomeOverlay = new BiomeOverlay();
    // Debug: coordinates readout (toggle with F3)
    this.coordsOverlay = new CoordsOverlay();
  }

  private initSettings() {
    this.settingsPanel = document.getElementById("settings-panel");
    const slider = document.getElementById(
      "render-distance",
    ) as HTMLInputElement | null;
    const valueLabel = document.getElementById("render-distance-value");
    if (!slider) return;

    slider.min = String(RENDER_RADIUS_MIN);
    slider.max = String(RENDER_RADIUS_MAX);
    slider.value = String(this.settings.renderRadius);
    if (valueLabel) valueLabel.textContent = String(this.settings.renderRadius);

    slider.addEventListener("input", () => {
      const radius = parseInt(slider.value, 10);
      // Mutating the shared settings object updates ChunkManager next tick.
      this.settings.renderRadius = radius;
      if (valueLabel) valueLabel.textContent = String(radius);
      saveRenderRadius(radius);
      this.renderer.setRenderDistance(radius * CHUNK_SIZE);
    });
  }

  private onWorldgenComplete(response: WorldgenWorkerResponse) {
    this.chunkManager.onWorldgenComplete(response.chunkKey, response.blocks);
  }

  private onMeshReady(response: MesherWorkerResponse) {
    const { chunkKey, meshData } = response;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(meshData.positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(meshData.normals, 3),
    );
    geometry.setAttribute("uv", new THREE.BufferAttribute(meshData.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

    // Use the shared texture atlas material
    const mesh = new THREE.Mesh(geometry, this.chunkMaterial);

    const [cx, cy, cz] = chunkKey.split(",").map(Number);
    mesh.position.set(cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE);

    this.chunkManager.setMesh(chunkKey, mesh);
  }

  start() {
    this.running = true;
    this.gameLoop();
  }

  private handlePerspectiveToggle() {
    if (this.input.consumeKeyPress("c")) {
      this.thirdPerson = !this.thirdPerson;
      this.player.setThirdPerson(this.thirdPerson);
    }
  }

  private handleDebugToggles() {
    if (this.input.consumeKeyPress("b")) {
      this.biomeOverlay.toggle();
    }
    if (this.input.consumeKeyPress("f3")) {
      this.coordsOverlay.toggle();
      // The coords HUD shares the top-left corner with the render-distance
      // panel; hide the panel while the HUD is up so they don't overlap.
      if (this.settingsPanel) {
        this.settingsPanel.style.display = this.coordsOverlay.visible
          ? "none"
          : "";
      }
    }
  }
  
  private initHotbar() {
    this.hotbarElement = document.getElementById("hotbar");
    if (!this.hotbarElement) return;
    
    // Clear existing slots
    this.hotbarElement.innerHTML = "";
    
    // Create slots for each block type
    this.hotbarSlots.forEach((slot, index) => {
      const slotElement = document.createElement("div");
      slotElement.className = "hotbar-slot";
      slotElement.dataset.blockType = slot.blockType.toString();
      
      // Add slot number
      const numberElement = document.createElement("div");
      numberElement.className = "hotbar-slot-number";
      numberElement.textContent = (index + 1).toString();
      slotElement.appendChild(numberElement);
      
      // Add block name
      const nameElement = document.createElement("div");
      nameElement.textContent = slot.name;
      slotElement.appendChild(nameElement);
      
      this.hotbarElement!.appendChild(slotElement);
    });
    
    // Set initial selection
    this.updateHotbarSelection();
  }
  
  private updateHotbarSelection() {
    if (!this.hotbarElement) return;
    
    const slots = this.hotbarElement.querySelectorAll(".hotbar-slot");
    slots.forEach((slot) => {
      const blockType = parseInt((slot as HTMLElement).dataset.blockType || "0");
      if (blockType === this.selectedBlockType) {
        slot.classList.add("selected");
      } else {
        slot.classList.remove("selected");
      }
    });
  }
  
  private handleBlockSelection() {
    // Handle number keys 1-9 for block selection
    for (let i = 1; i <= 9; i++) {
      if (this.input.consumeKeyPress(i.toString())) {
        const slotIndex = i - 1;
        if (slotIndex < this.hotbarSlots.length) {
          this.selectedBlockType = this.hotbarSlots[slotIndex].blockType;
          this.updateHotbarSelection();
        }
      }
    }
    
    // Handle mouse wheel scrolling
    const wheelDelta = this.input.consumeWheelDelta();
    if (wheelDelta !== 0) {
      const currentIndex = this.hotbarSlots.findIndex(
        slot => slot.blockType === this.selectedBlockType
      );
      
      if (currentIndex !== -1) {
        // Calculate new index with wrapping
        // Positive wheelDelta = scrolled down = next item (higher index)
        // Negative wheelDelta = scrolled up = previous item (lower index)
        let newIndex = currentIndex + wheelDelta;
        if (newIndex < 0) {
          newIndex = this.hotbarSlots.length - 1; // Wrap to end
        } else if (newIndex >= this.hotbarSlots.length) {
          newIndex = 0; // Wrap to beginning
        }
        
        this.selectedBlockType = this.hotbarSlots[newIndex].blockType;
        this.updateHotbarSelection();
      }
    }
  }

  private handleBlockInteraction() {
    const camera = this.renderer.camera;
    const origin = camera.position.clone();
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(camera.quaternion);

    const hit = voxelRaycast(
      origin,
      direction,
      5,
      (x, y, z) => this.world.getBlock(x, y, z) !== BLOCK_AIR,
    );

    if (!hit) return;

    // Hold left mouse for 1s to mine
    if (this.input.isLeftDown()) {
      const key = `${hit.blockX},${hit.blockY},${hit.blockZ}`;
      if (key !== this.mineTargetKey) {
        this.mineTargetKey = key;
        this.mineStartTime = performance.now();
      }
      const elapsed = performance.now() - this.mineStartTime;
      if (elapsed >= this.mineHoldMs) {
        this.world.setBlock(hit.blockX, hit.blockY, hit.blockZ, BLOCK_AIR);
        this.remeshAffectedChunks(hit.blockX, hit.blockY, hit.blockZ);
        this.mineTargetKey = null;
        this.mineStartTime = 0;
      }
    } else {
      this.mineTargetKey = null;
      this.mineStartTime = 0;
    }

    // Right click - place block (hold to continuously place)
    if (this.input.isRightDown()) {
      const now = performance.now();
      if (now - this.lastPlaceTime >= this.placeCooldownMs) {
        const placeX = hit.blockX + hit.normal.x;
        const placeY = hit.blockY + hit.normal.y;
        const placeZ = hit.blockZ + hit.normal.z;
        
        // Check if block placement is within height limit
        if (placeY >= MAX_BUILD_HEIGHT) {
          // Block is too high, don't place it
          return;
        }
        
        // Check if placing this block would collide with the player
        if (!this.wouldBlockCollideWithPlayer(placeX, placeY, placeZ)) {
          this.world.setBlock(placeX, placeY, placeZ, this.selectedBlockType);
          this.remeshAffectedChunks(placeX, placeY, placeZ);
          this.lastPlaceTime = now;
        }
      }
    }
  }

  private wouldBlockCollideWithPlayer(blockX: number, blockY: number, blockZ: number): boolean {
    const pos = this.player.position;
    const radius = this.player.radius;
    const height = this.player.height;
    
    // Player's bounding box
    const playerMinX = pos.x - radius;
    const playerMaxX = pos.x + radius;
    const playerMinY = pos.y - height;
    const playerMaxY = pos.y;
    const playerMinZ = pos.z - radius;
    const playerMaxZ = pos.z + radius;
    
    // Block's bounding box (blocks are 1x1x1)
    const blockMinX = blockX;
    const blockMaxX = blockX + 1;
    const blockMinY = blockY;
    const blockMaxY = blockY + 1;
    const blockMinZ = blockZ;
    const blockMaxZ = blockZ + 1;
    
    // Check if bounding boxes overlap
    const overlapX = playerMaxX > blockMinX && playerMinX < blockMaxX;
    const overlapY = playerMaxY > blockMinY && playerMinY < blockMaxY;
    const overlapZ = playerMaxZ > blockMinZ && playerMinZ < blockMaxZ;
    
    return overlapX && overlapY && overlapZ;
  }

  private remeshAffectedChunks(blockX: number, blockY: number, blockZ: number) {
    const chunkX = Math.floor(blockX / CHUNK_SIZE);
    const chunkY = Math.floor(blockY / CHUNK_SIZE);
    const chunkZ = Math.floor(blockZ / CHUNK_SIZE);

    const localX = ((blockX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY = ((blockY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localZ = ((blockZ % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    // Remesh the main chunk
    this.chunkManager.requestMeshUpdate(`${chunkX},${chunkY},${chunkZ}`);

    // Remesh neighbor chunks if on border
    if (localX === 0)
      this.chunkManager.requestMeshUpdate(`${chunkX - 1},${chunkY},${chunkZ}`);
    if (localX === CHUNK_SIZE - 1)
      this.chunkManager.requestMeshUpdate(`${chunkX + 1},${chunkY},${chunkZ}`);
    if (localY === 0)
      this.chunkManager.requestMeshUpdate(`${chunkX},${chunkY - 1},${chunkZ}`);
    if (localY === CHUNK_SIZE - 1)
      this.chunkManager.requestMeshUpdate(`${chunkX},${chunkY + 1},${chunkZ}`);
    if (localZ === 0)
      this.chunkManager.requestMeshUpdate(`${chunkX},${chunkY},${chunkZ - 1}`);
    if (localZ === CHUNK_SIZE - 1)
      this.chunkManager.requestMeshUpdate(`${chunkX},${chunkY},${chunkZ + 1}`);
  }

  gameLoop = () => {
    this.player.update();
    this.handlePerspectiveToggle();
    this.handleDebugToggles();
    this.handleBlockSelection();
    this.handleBlockInteraction();
    this.chunkManager.update(
      this.player.position.x,
      this.player.position.y,
      this.player.position.z,
    );
    this.biomeOverlay.update(
      this.biomeNoise,
      this.player.position.x,
      this.player.position.z,
    );
    this.coordsOverlay.update(
      this.player.position.x,
      this.player.position.y,
      this.player.position.z,
    );
    this.renderer.render();
    requestAnimationFrame(this.gameLoop);
  };
}

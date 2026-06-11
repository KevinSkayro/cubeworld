import * as THREE from "three";
import { Renderer } from "../render/Renderer";
import { Input } from "../input/Input";
import { Player } from "../player/Player";
import { World } from "../world/World";
import { ChunkManager } from "../world/ChunkManager";
import { CHUNK_SIZE, BLOCK_AIR, BLOCK_STONE, BLOCK_GRASS, BLOCK_DIRT,BLOCK_SAND, BLOCK_SNOW, BLOCK_BEDROCK, BLOCK_WATER, MAX_BUILD_HEIGHT } from "../world/constants";
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
  loadSeed,
  loadAutoSave,
  saveAutoSave,
} from "../world/gen/settings";
import { makeNoise, NoiseSampler } from "../world/gen/noise";
import { columnHeight } from "../world/gen/terrain";
import { TickEngine } from "../world/sim/TickEngine";
import { WorldFluid } from "../world/sim/WorldFluid";
import { updateCell } from "../world/sim/fluid";
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
  waterOverlay: HTMLElement | null = null;
  tickEngine: TickEngine;
  worldFluid: WorldFluid;
  private lastFrameTime = 0;
  running: boolean = false;
  paused: boolean = false;
  /** Called when the player releases pointer lock (e.g. Escape) so the host can
   *  show the pause menu. */
  onPause?: () => void;
  mineTargetKey: string | null = null;
  mineStartTime: number = 0;
  mineHoldMs: number = 500;
  placeCooldownMs: number = 200; // Cooldown between block placements
  lastPlaceTime: number = 0;
  thirdPerson: boolean = false;
  textureAtlas: TextureAtlas;
  chunkMaterial: THREE.MeshPhongMaterial;
  waterMaterial: THREE.MeshPhongMaterial;
  
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

  constructor(seed: number = loadSeed(DEFAULT_WORLD_SETTINGS.seed)) {
    this.seed = seed;
    this.settings = {
      ...DEFAULT_WORLD_SETTINGS,
      seed,
      renderRadius: loadRenderRadius(DEFAULT_WORLD_SETTINGS.renderRadius),
    };

    this.renderer = new Renderer();
    this.renderer.setRenderDistance(this.settings.renderRadius * CHUNK_SIZE);
    this.input = new Input(this.renderer.camera, this.renderer.canvas);
    // Releasing pointer lock (Escape / focus loss) opens the pause menu.
    this.input.onUnlock = () => this.handlePointerUnlock();
    this.world = new World();

    // Fluid simulation: a shared tick engine (2 tps = one tick every 0.5s)
    // drives water flow. Water cells re-evaluate via the flow rules; settled
    // water doesn't tick (only disturbances near edits do), so idle lakes cost
    // nothing.
    this.tickEngine = new TickEngine(2);
    this.worldFluid = new WorldFluid(this.world, this.tickEngine);
    this.tickEngine.onBlockUpdate = (x, y, z) =>
      updateCell(this.worldFluid, x, y, z);

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

    // Translucent water (flat colour, no texture). depthWrite off so it blends
    // with terrain behind it; DoubleSide so the surface is visible from below
    // when wading in.
    this.waterMaterial = new THREE.MeshPhongMaterial({
      color: 0x3a78c2,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
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
    // Apply the persisted auto-save preference (off by default).
    this.chunkManager.setAutoSave(loadAutoSave(false));

    // Load initial chunks around player spawn
    this.chunkManager.update(
      this.player.position.x,
      this.player.position.y,
      this.player.position.z,
    );

    // Initialize hotbar UI
    this.initHotbar();

    // Debug: biome parameter visualizer (toggle with 'B')
    this.biomeOverlay = new BiomeOverlay();
    // Debug: coordinates readout (toggle with F3)
    this.coordsOverlay = new CoordsOverlay();

    // Blue tint shown while the camera is submerged.
    this.waterOverlay = document.getElementById("water-overlay");

    // Best-effort flush of pending edited-chunk saves when the tab is hidden or
    // closing, so an edit made moments before leaving still persists.
    window.addEventListener("pagehide", () => {
      void this.chunkManager.flushSaves();
    });
  }

  getRenderRadius(): number {
    return this.settings.renderRadius;
  }

  /** Update the render distance (chunk radius). Persisted; applied next tick via
   *  the shared settings object, and the camera far plane/fog immediately. */
  setRenderRadius(radius: number) {
    const r = Math.max(
      RENDER_RADIUS_MIN,
      Math.min(RENDER_RADIUS_MAX, Math.round(radius)),
    );
    this.settings.renderRadius = r;
    saveRenderRadius(r);
    this.renderer.setRenderDistance(r * CHUNK_SIZE);
  }

  private onWorldgenComplete(response: WorldgenWorkerResponse) {
    this.chunkManager.onWorldgenComplete(response.chunkKey, response.blocks);
  }

  private buildMesh(
    meshData: MesherWorkerResponse["meshData"],
    material: THREE.Material,
  ): THREE.Mesh {
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
    return new THREE.Mesh(geometry, material);
  }

  private onMeshReady(response: MesherWorkerResponse) {
    const { chunkKey, meshData, waterMeshData } = response;
    const [cx, cy, cz] = chunkKey.split(",").map(Number);
    const ox = cx * CHUNK_SIZE;
    const oy = cy * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;

    const mesh = this.buildMesh(meshData, this.chunkMaterial);
    mesh.position.set(ox, oy, oz);
    this.chunkManager.setMesh(chunkKey, mesh);

    // Build the translucent water mesh only when the chunk has water.
    if (waterMeshData && waterMeshData.indices.length > 0) {
      const water = this.buildMesh(waterMeshData, this.waterMaterial);
      water.position.set(ox, oy, oz);
      this.chunkManager.setWaterMesh(chunkKey, water);
    } else {
      this.chunkManager.setWaterMesh(chunkKey, null);
    }
  }

  start() {
    this.running = true;
    this.gameLoop();
  }

  /** Freeze/resume the simulation (the render loop keeps running). */
  setPaused(paused: boolean) {
    this.paused = paused;
  }

  /** Request pointer lock (call from a user gesture, e.g. a menu button). */
  requestPointerLock() {
    this.input.controls.lock();
  }

  private handlePointerUnlock() {
    // Ignore if not actively playing or already paused (avoids re-firing).
    if (!this.running || this.paused) return;
    this.paused = true;
    this.onPause?.();
  }

  /** Persist all unsaved edits; resolves with the number of chunks written. */
  async saveProgress(): Promise<number> {
    const count = this.chunkManager.saveAll();
    await this.chunkManager.flushSaves();
    return count;
  }

  /** Toggle auto-save and remember the choice. */
  setAutoSave(enabled: boolean) {
    this.chunkManager.setAutoSave(enabled);
    saveAutoSave(enabled);
  }

  isAutoSave(): boolean {
    return this.chunkManager.isAutoSaveEnabled();
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
      (x, y, z) => {
        const b = this.world.getBlock(x, y, z);
        return b !== BLOCK_AIR && b !== BLOCK_WATER; // water is passable / not targetable
      },
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
        // Bedrock is unbreakable — the mine attempt just resets.
        if (this.world.getBlock(hit.blockX, hit.blockY, hit.blockZ) !== BLOCK_BEDROCK) {
          this.world.setBlock(hit.blockX, hit.blockY, hit.blockZ, BLOCK_AIR);
          this.markEditedAt(hit.blockX, hit.blockY, hit.blockZ);
          this.remeshAffectedChunks(hit.blockX, hit.blockY, hit.blockZ);
          this.worldFluid.disturb(hit.blockX, hit.blockY, hit.blockZ); // water may flow in
        }
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
          this.markEditedAt(placeX, placeY, placeZ);
          this.remeshAffectedChunks(placeX, placeY, placeZ);
          this.worldFluid.disturb(placeX, placeY, placeZ); // displaced/blocked water reflows
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

  /** Remesh any chunks whose water the flow sim changed this frame. */
  private flushFluidChanges() {
    const dirty = this.worldFluid.dirty;
    if (dirty.size === 0) return;
    for (const key of dirty) {
      if (this.world.chunks.has(key)) this.chunkManager.requestMeshUpdate(key);
    }
    dirty.clear();
  }

  /** Flag (and persist) the chunk that owns an edited block. */
  private markEditedAt(blockX: number, blockY: number, blockZ: number) {
    const cx = Math.floor(blockX / CHUNK_SIZE);
    const cy = Math.floor(blockY / CHUNK_SIZE);
    const cz = Math.floor(blockZ / CHUNK_SIZE);
    this.chunkManager.markEdited(`${cx},${cy},${cz}`);
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
    const now = performance.now();
    // Real seconds since last frame, clamped so a tab-out doesn't dump a huge dt.
    const dt = this.lastFrameTime ? Math.min((now - this.lastFrameTime) / 1000, 0.1) : 0;
    this.lastFrameTime = now;

    // Freeze the simulation while paused (menu open); keep rendering the frame.
    if (!this.paused) {
      this.player.update();
      this.handlePerspectiveToggle();
      this.handleDebugToggles();
      this.handleBlockSelection();
      this.handleBlockInteraction();
      // Advance water flow, then remesh any chunks it changed.
      this.tickEngine.advance(dt);
      this.flushFluidChanges();
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
    }
    this.updateWaterOverlay();
    this.renderer.render();
    requestAnimationFrame(this.gameLoop);
  };

  /** Show a blue tint when the camera (the rendered viewpoint) is in water. */
  private updateWaterOverlay() {
    if (!this.waterOverlay) return;
    const p = this.renderer.camera.position;
    const submerged =
      this.world.getBlock(
        Math.floor(p.x),
        Math.floor(p.y),
        Math.floor(p.z),
      ) === BLOCK_WATER;
    this.waterOverlay.classList.toggle("active", submerged);
  }
}

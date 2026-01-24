import * as THREE from "three";
import { Renderer } from "../render/Renderer";
import { Input } from "../input/Input";
import { Player } from "../player/Player";
import { World } from "../world/World";
import { ChunkManager } from "../world/ChunkManager";
import { CHUNK_SIZE, BLOCK_AIR, BLOCK_STONE } from "../world/constants";
import { MesherWorkerResponse } from "../world/meshing/types";
import { voxelRaycast } from "../world/raycast/voxelRaycast";
import { TextureAtlas } from "../world/TextureAtlas";

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
  running: boolean = false;
  mineTargetKey: string | null = null;
  mineStartTime: number = 0;
  mineHoldMs: number = 500;
  placeCooldownMs: number = 100; // Cooldown between block placements
  lastPlaceTime: number = 0;
  thirdPerson: boolean = false;
  textureAtlas: TextureAtlas;
  chunkMaterial: THREE.MeshPhongMaterial;

  constructor() {
    this.renderer = new Renderer();
    this.input = new Input(this.renderer.camera, this.renderer.canvas);
    this.world = new World();
    this.player = new Player(
      this.renderer.camera,
      this.input,
      this.renderer.scene,
      (x, y, z) => this.world.getBlock(x, y, z),
    );

    // Create texture atlas and material
    this.textureAtlas = new TextureAtlas();
    this.chunkMaterial = new THREE.MeshPhongMaterial({
      map: this.textureAtlas.texture,
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
      this.seed,
      (key, meshData) => this.onMeshReady({ chunkKey: key, meshData }),
    );

    // Load initial chunks around player spawn
    this.chunkManager.update(
      this.player.position.x,
      this.player.position.y,
      this.player.position.z,
    );
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
        
        // Check if placing this block would collide with the player
        if (!this.wouldBlockCollideWithPlayer(placeX, placeY, placeZ)) {
          this.world.setBlock(placeX, placeY, placeZ, BLOCK_STONE);
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
    this.handleBlockInteraction();
    this.chunkManager.update(
      this.player.position.x,
      this.player.position.y,
      this.player.position.z,
    );
    this.renderer.render();
    requestAnimationFrame(this.gameLoop);
  };
}

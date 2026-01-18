import * as THREE from "three";

export interface VoxelHit {
  blockX: number;
  blockY: number;
  blockZ: number;
  normal: THREE.Vector3;
}

export function voxelRaycast(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
  checkBlock: (x: number, y: number, z: number) => boolean,
): VoxelHit | null {
  const pos = origin.clone();
  const step = new THREE.Vector3(
    direction.x > 0 ? 1 : -1,
    direction.y > 0 ? 1 : -1,
    direction.z > 0 ? 1 : -1,
  );

  let blockX = Math.floor(pos.x);
  let blockY = Math.floor(pos.y);
  let blockZ = Math.floor(pos.z);

  const tDelta = new THREE.Vector3(
    Math.abs(1 / direction.x),
    Math.abs(1 / direction.y),
    Math.abs(1 / direction.z),
  );

  const tMax = new THREE.Vector3(
    direction.x > 0
      ? (blockX + 1 - pos.x) / direction.x
      : (blockX - pos.x) / direction.x,
    direction.y > 0
      ? (blockY + 1 - pos.y) / direction.y
      : (blockY - pos.y) / direction.y,
    direction.z > 0
      ? (blockZ + 1 - pos.z) / direction.z
      : (blockZ - pos.z) / direction.z,
  );

  const normal = new THREE.Vector3();
  let distance = 0;

  while (distance < maxDistance) {
    if (checkBlock(blockX, blockY, blockZ)) {
      return { blockX, blockY, blockZ, normal };
    }

    if (tMax.x < tMax.y && tMax.x < tMax.z) {
      blockX += step.x;
      distance = tMax.x;
      tMax.x += tDelta.x;
      normal.set(-step.x, 0, 0);
    } else if (tMax.y < tMax.z) {
      blockY += step.y;
      distance = tMax.y;
      tMax.y += tDelta.y;
      normal.set(0, -step.y, 0);
    } else {
      blockZ += step.z;
      distance = tMax.z;
      tMax.z += tDelta.z;
      normal.set(0, 0, -step.z);
    }
  }

  return null;
}

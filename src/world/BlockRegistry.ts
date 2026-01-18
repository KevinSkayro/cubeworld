import { TEX } from "./textureConfig";

// Face indices: +X, -X, +Y, -Y, +Z, -Z (right, left, top, bottom, front, back)
export interface BlockFaceTextures {
  right: number;  // +X
  left: number;   // -X
  top: number;    // +Y
  bottom: number; // -Y
  front: number;  // +Z
  back: number;   // -Z
}

export interface BlockDefinition {
  id: number;
  name: string;
  solid: boolean;
  textures: BlockFaceTextures;
}

// Helper to create uniform textures (same on all faces)
function uniformTextures(textureIndex: number): BlockFaceTextures {
  return {
    right: textureIndex,
    left: textureIndex,
    top: textureIndex,
    bottom: textureIndex,
    front: textureIndex,
    back: textureIndex,
  };
}

// Helper to create top/side/bottom textures
function topSideBottomTextures(top: number, side: number, bottom: number): BlockFaceTextures {
  return {
    right: side,
    left: side,
    top: top,
    bottom: bottom,
    front: side,
    back: side,
  };
}

export class BlockRegistry {
  private blocks: Map<number, BlockDefinition> = new Map();

  constructor() {
    // Air - no textures (won't be rendered)
    this.register(0, "Air", false, uniformTextures(0));
    
    // Grass - green top, grass_side on sides, dirt on bottom
    this.register(1, "Grass", true, topSideBottomTextures(TEX.GRASS_TOP, TEX.GRASS_SIDE, TEX.DIRT));
    
    // Dirt - same on all faces
    this.register(2, "Dirt", true, uniformTextures(TEX.DIRT));
    
    // Stone - same on all faces
    this.register(3, "Stone", true, uniformTextures(TEX.STONE));
  }

  private register(id: number, name: string, solid: boolean, textures: BlockFaceTextures): void {
    this.blocks.set(id, { id, name, solid, textures });
  }

  getBlock(id: number): BlockDefinition | undefined {
    return this.blocks.get(id);
  }

  isSolid(id: number): boolean {
    const block = this.blocks.get(id);
    return block ? block.solid : false;
  }

  getTextures(id: number): BlockFaceTextures | undefined {
    const block = this.blocks.get(id);
    return block?.textures;
  }

  /**
   * Get texture index for a specific face
   * @param blockId - The block type ID
   * @param faceIndex - 0: +X, 1: -X, 2: +Y, 3: -Y, 4: +Z, 5: -Z
   */
  getTextureForFace(blockId: number, faceIndex: number): number {
    const textures = this.getTextures(blockId);
    if (!textures) return 0;
    
    switch (faceIndex) {
      case 0: return textures.right;
      case 1: return textures.left;
      case 2: return textures.top;
      case 3: return textures.bottom;
      case 4: return textures.front;
      case 5: return textures.back;
      default: return 0;
    }
  }
}

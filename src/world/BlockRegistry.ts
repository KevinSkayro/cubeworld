import { BLOCK_DEFINITIONS, type TextureConfig } from "./blocks/definitions";

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
  opaque: boolean;
  translucent: boolean;
  textures: BlockFaceTextures;
}

// Helper to convert texture config to face textures
function textureConfigToFaces(config: TextureConfig): BlockFaceTextures {
  if (config.type === "uniform") {
    return {
      right: config.texture,
      left: config.texture,
      top: config.texture,
      bottom: config.texture,
      front: config.texture,
      back: config.texture,
    };
  } else {
    // topSideBottom
    return {
      right: config.side,
      left: config.side,
      top: config.top,
      bottom: config.bottom,
      front: config.side,
      back: config.side,
    };
  }
}

export class BlockRegistry {
  private blocks: Map<number, BlockDefinition> = new Map();

  constructor() {
    // Register all blocks from centralized definitions
    for (const def of BLOCK_DEFINITIONS) {
      const textures = textureConfigToFaces(def.textureConfig);
      this.blocks.set(def.id, {
        id: def.id,
        name: def.name,
        solid: def.solid,
        opaque: def.opaque !== false, // default true
        translucent: def.translucent === true, // default false
        textures,
      });
    }
  }

  getBlock(id: number): BlockDefinition | undefined {
    return this.blocks.get(id);
  }

  isSolid(id: number): boolean {
    const block = this.blocks.get(id);
    return block ? block.solid : false;
  }

  /** Whether the block fully occludes neighbours (solid and opaque). */
  isOpaque(id: number): boolean {
    const block = this.blocks.get(id);
    return block ? block.solid && block.opaque : false;
  }

  /** Whether the block is rendered in the translucent pass (e.g. water). */
  isTranslucent(id: number): boolean {
    const block = this.blocks.get(id);
    return block ? block.translucent : false;
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

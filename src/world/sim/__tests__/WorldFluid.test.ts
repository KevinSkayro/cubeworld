// End-to-end sim wiring: World water accessors + WorldFluid adapter + TickEngine
// + the flow rules, with no renderer involved.
import { describe, it, expect, beforeEach } from "vitest";
import { World } from "../../World";
import { TickEngine } from "../TickEngine";
import { WorldFluid } from "../WorldFluid";
import { updateCell, SOURCE } from "../fluid";
import { BLOCK_STONE, BLOCK_WATER, BLOCK_AIR } from "../../constants";

function setup() {
  const world = new World();
  // Solid floor at y=4 over a wide area.
  for (let x = -12; x <= 12; x++)
    for (let z = -12; z <= 12; z++) world.setBlock(x, 4, z, BLOCK_STONE);
  // A water source sitting on the floor.
  world.setBlock(0, 5, 0, BLOCK_WATER);
  world.setWaterLevel(0, 5, 0, SOURCE);

  const tick = new TickEngine(10);
  const fluid = new WorldFluid(world, tick);
  tick.onBlockUpdate = (x, y, z) => updateCell(fluid, x, y, z);
  const run = (seconds: number) => tick.advance(seconds);
  return { world, tick, fluid, run };
}

describe("WorldFluid integration", () => {
  it("flows a source out across the floor when disturbed", () => {
    const { world, fluid, run } = setup();
    fluid.disturb(0, 5, 0); // e.g. the player dug next to the source
    for (let i = 0; i < 30; i++) run(0.1);

    expect(world.getBlock(1, 5, 0)).toBe(BLOCK_WATER);
    expect(world.getWaterLevel(1, 5, 0)).toBe(7);
    expect(world.getWaterLevel(2, 5, 0)).toBe(6);
    expect(world.getBlock(8, 5, 0)).toBe(BLOCK_AIR); // beyond the 7-block reach
    // Changed chunks were flagged for remesh.
    expect(fluid.dirty.size).toBeGreaterThan(0);
  });

  it("flows down into a hole dug below the water", () => {
    const { world, fluid, run } = setup();
    // Dig a shaft down through the floor under the source.
    for (let y = 0; y <= 4; y++) world.setBlock(0, y, 0, BLOCK_AIR);
    world.setBlock(0, -1, 0, BLOCK_STONE); // new floor at the bottom
    fluid.disturb(0, 4, 0);
    for (let i = 0; i < 40; i++) run(0.1);

    // Water poured down the shaft.
    expect(world.getBlock(0, 4, 0)).toBe(BLOCK_WATER);
    expect(world.getBlock(0, 0, 0)).toBe(BLOCK_WATER);
  });

  it("recedes when the source is removed", () => {
    const { world, fluid, run } = setup();
    fluid.disturb(0, 5, 0);
    for (let i = 0; i < 30; i++) run(0.1);
    expect(world.getBlock(3, 5, 0)).toBe(BLOCK_WATER);

    // Remove the source and let it drain.
    fluid.setLevel(0, 5, 0, 0);
    fluid.disturb(0, 5, 0);
    for (let i = 0; i < 30; i++) run(0.1);

    for (let x = -8; x <= 8; x++)
      expect(world.getBlock(x, 5, 0)).not.toBe(BLOCK_WATER);
  });
});

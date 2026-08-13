import { LEVELS, REFERENCE_ROAD_WIDTH } from './constants'

// live, level-driven world state. A plain mutable object (not constants)
// so the scene can retune it as the player progresses — and tween it:
// the road width eases between levels instead of snapping
export const world = {
  // the road's current half-width in world units
  roadWidth: LEVELS[0].roadWidth,
  // relative spawn weights per vehicle texture (see VEHICLES)
  trafficMix: LEVELS[0].trafficMix,
  // how many NPC vehicles share the road at once
  trafficCount: LEVELS[0].trafficCount,
  // fraction of MAX_SPEED the player's engine can currently reach
  maxSpeedFactor: LEVELS[0].maxSpeedFactor,
  // which decal variant set newly spawned scenery uses (see DECALS
  // variants); '' = the base grass sheets
  sceneryTheme: LEVELS[0].scenery ?? '',
}

// physical-size compensation: lane-unit sizes (collision boxes, steering
// forces, wheel spreads) are authored at the reference road width and
// scale up as the road narrows, so they stay constant in world units
export const laneScale = () => REFERENCE_ROAD_WIDTH / world.roadWidth

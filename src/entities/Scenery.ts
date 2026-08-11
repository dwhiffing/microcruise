import { LANE_SCALE } from '../constants'
import { Road } from './Road'
import { RoadObject } from './RoadObject'

// average world units between decals; each actual gap rolls 0.5x-1.5x of
// it, so lower = denser roadside
const INTERVAL = 100
// default lateral band, in road-relative lane units from the centre: the
// road's edge is 1 and the bumpers end around 1.2
const DIST_MIN = 2.5
const DIST_MAX = 6
// shapes where in the band a decal lands: >1 clusters them against the
// road, <1 pushes them out toward DIST_MAX, 1 = uniform
const DIST_BIAS = 0.5
// keep the world populated this far ahead of the camera
const SPAWN_AHEAD = 800
// true: ignore the pre-drawn size frames and smoothly scale each sheet's
// first (largest) frame with distance instead — softer/resampled pixels,
// but perfectly continuous growth. false: crisp native-size frame steps
const SCALE_FIRST_FRAME = false

// what can sprout beside the road. weight = relative frequency (only the
// ratios matter); worldWidth = physical size in world units (the player
// car reads as ~25); dist overrides the default lateral band for that
// decal. sizeFrames are each sheet's measured art widths + per-frame
// seat-down offsets (the art shrinks toward the frame centre)
export interface DecalSpec {
  texture: string
  weight: number
  worldWidth: number
  sizeFrames: { frame: number; width: number; yOffset?: number }[]
  dist?: [number, number]
  // solid decals (trees): collision box half-extents — z along the track
  // in world units, lane across it (same convention as the sign boxes).
  // Omitted = drive-through (bushes)
  collide?: { z: number; lane: number }
}

export const DECALS: DecalSpec[] = [
  {
    texture: 'bush',
    weight: 4,
    worldWidth: 10,
    sizeFrames: [
      { frame: 0, width: 12, yOffset: 5 },
      { frame: 1, width: 9, yOffset: 5 },
      { frame: 2, width: 6, yOffset: 6 },
      { frame: 3, width: 5, yOffset: 6 },
      { frame: 4, width: 3, yOffset: 7 },
      { frame: 5, width: 1, yOffset: 7 },
    ],
  },
  {
    texture: 'bush2',
    weight: 4,
    worldWidth: 32,
    sizeFrames: [
      { frame: 0, width: 40, yOffset: 3 },
      { frame: 1, width: 29, yOffset: 6 },
      { frame: 2, width: 19, yOffset: 9 },
      { frame: 3, width: 14, yOffset: 11 },
      { frame: 4, width: 9, yOffset: 13 },
      { frame: 5, width: 5, yOffset: 14 },
      { frame: 6, width: 3, yOffset: 15 },
    ],
  },
  {
    texture: 'tree',
    weight: 1,
    worldWidth: 45,
    // trees sit a little farther back so their canopies don't crowd the
    // shoulder
    // the trunk is solid
    dist: [5, 6],
    collide: { z: 10, lane: 0.15 * LANE_SCALE },
    sizeFrames: [
      { frame: 0, width: 46 },
      { frame: 1, width: 41, yOffset: 2 },
      { frame: 2, width: 37, yOffset: 5 },
      { frame: 3, width: 30, yOffset: 9 },
      { frame: 4, width: 25, yOffset: 13 },
      { frame: 5, width: 18, yOffset: 15 },
      { frame: 6, width: 11, yOffset: 17 },
      { frame: 7, width: 5, yOffset: 19 },
      { frame: 8, width: 3, yOffset: 20 },
      { frame: 9, width: 2, yOffset: 21 },
      { frame: 10, width: 2, yOffset: 22 },
    ],
  },
  {
    texture: 'tree2',
    weight: 1,
    worldWidth: 30,
    dist: [5, 6],
    collide: { z: 10, lane: 0.15 * LANE_SCALE },
    sizeFrames: [
      { frame: 0, width: 28, yOffset: 2 },
      { frame: 1, width: 25, yOffset: 4 },
      { frame: 2, width: 22, yOffset: 6 },
      { frame: 3, width: 16, yOffset: 10 },
      { frame: 4, width: 11, yOffset: 14 },
      { frame: 5, width: 8, yOffset: 16 },
      { frame: 6, width: 5, yOffset: 18 },
      { frame: 7, width: 3, yOffset: 20 },
      { frame: 8, width: 1, yOffset: 21 },
    ],
  },
]

// the endless roadside: decals spawn just past the draw distance as the
// camera advances and are culled once they pass behind it. Purely
// cosmetic — nothing here collides
export class Scenery {
  private scene: Phaser.Scene
  private decals: { obj: RoadObject; spec: DecalSpec }[] = []
  private nextZ = 0

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  private pick(): DecalSpec {
    let roll = Math.random() * DECALS.reduce((sum, d) => sum + d.weight, 0)
    for (const d of DECALS) {
      roll -= d.weight
      if (roll <= 0) return d
    }
    return DECALS[DECALS.length - 1]
  }

  // call every frame with the camera's position (menu cruise included)
  update(road: Road, position: number) {
    if (this.nextZ < position) this.nextZ = position
    while (this.nextZ < position + SPAWN_AHEAD) {
      const spec = this.pick()
      const side = Math.random() < 0.5 ? -1 : 1
      const [min, max] = spec.dist ?? [DIST_MIN, DIST_MAX]
      const dist = min + Math.pow(Math.random(), DIST_BIAS) * (max - min)
      this.decals.push({
        spec,
        obj: new RoadObject(this.scene, spec.texture, this.nextZ, side * dist, {
          worldWidth: spec.worldWidth,
          maxScale: 1,
          scaleExponent: 0.8,
          // free variety
          flipX: Math.random() < 0.5,
          // the crest-occlusion flag is unreliable for static objects
          // (same as signs/coins), but do hold a decal back until its
          // ground is actually in view, so it can't float over the
          // horizon when it first enters range
          ignoreOcclusion: true,
          ...(SCALE_FIRST_FRAME
            ? {
                // anchor at the largest frame's art bottom (its seat
                // offset as a fraction of the frame height), so the art
                // stays planted at every scale
                originY:
                  1 -
                  (spec.sizeFrames[0].yOffset ?? 0) /
                    this.scene.textures.get(spec.texture).get(0).height,
              }
            : { sizeFrames: spec.sizeFrames }),
        }),
      })
      this.nextZ += INTERVAL * (0.5 + Math.random())
    }
    this.decals = this.decals.filter((decal) => {
      if (decal.obj.z < position) {
        decal.obj.destroy()
        return false
      }
      decal.obj.update(road)
      return true
    })
  }

  // every solid decal's box, for the scene's collision pass
  forEachCollider(
    cb: (z: number, lane: number, halfZ: number, halfLane: number) => void,
  ) {
    for (const { obj, spec } of this.decals) {
      if (spec.collide)
        cb(obj.z, obj.laneOffset, spec.collide.z, spec.collide.lane)
    }
  }
}

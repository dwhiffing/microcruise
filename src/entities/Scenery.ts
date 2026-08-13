import { laneScale, world } from '../world'
import { multiplyColor, Road } from './Road'
import { RoadObject } from './RoadObject'

// average world units between decals; each actual gap rolls 0.5x-1.5x of
// it, so lower = denser roadside
const INTERVAL = 100
// default lateral band, in road-relative lane units from the centre: the
// road's edge is 1 and the bumpers end around 1.2
const DIST_MIN = 2.5
const DIST_MAX = 3
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
  // smashable decals (big bushes): driving through the box destroys the
  // decal in a burst of `color` pixels instead of a collision. Same
  // half-extent convention as collide
  smash?: { z: number; lane: number; color: number }
  // per-decal scaling overrides (see RoadObjectOptions): how the size
  // falls off with distance (<1 keeps far ones legible, 1 = true
  // perspective; default 0.8), and the floor/cap on the rendered scale
  // (defaults 0 / 1 = never above native size)
  scaleExponent?: number
  minScale?: number
  maxScale?: number
  // themed art swaps, keyed by the level's scenery theme (see
  // world.sceneryTheme): the variant's sheet replaces the base one on
  // newly spawned decals. Recolours that share the base sheet's layout
  // only name a texture; reshaped art brings its own measured frames
  // and physical size. Everything else (weight, band, collision,
  // scaling) is inherited from the base decal
  variants?: Record<string, DecalVariant>
}

export interface DecalVariant {
  texture: string
  worldWidth?: number
  sizeFrames?: { frame: number; width: number; yOffset?: number }[]
  // overrides the base decal's scaling for this variant only (e.g. a
  // reshaped tree that looms differently than the one it replaces)
  scaleExponent?: number
  minScale?: number
  maxScale?: number
  // overrides the base decal's spawn weight and lateral band for this
  // theme only (e.g. the snow drift spawning more often, tucked closer
  // to the road than the bush it replaces)
  weight?: number
  dist?: [number, number]
  // overrides the base decal's smash burst colour for this theme (sand
  // for the desert bush, powder for the snow drift)
  smashColor?: number
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
    // straight recolours of the base sheet
    variants: {
      desert: { texture: 'desert-bush' },
      snow: { texture: 'snow-bush' },
    },
  },
  {
    texture: 'bush2',
    weight: 4,
    worldWidth: 32,
    dist: [2, 2.5],
    // driving through the big bush smashes it into a leafy burst
    smash: { z: 10, lane: 0.4, color: 0x4a8f3c },
    sizeFrames: [
      { frame: 0, width: 40, yOffset: 3 },
      { frame: 1, width: 29, yOffset: 6 },
      { frame: 2, width: 19, yOffset: 9 },
      { frame: 3, width: 14, yOffset: 11 },
      { frame: 4, width: 9, yOffset: 13 },
      { frame: 5, width: 5, yOffset: 14 },
      { frame: 6, width: 3, yOffset: 15 },
    ],
    variants: {
      // recolour of the base sheet
      desert: { texture: 'desert-bush2', smashColor: 0xd8b56a },
      // its own smaller drift shape (18x23 frames)
      snow: {
        texture: 'snow-bush2',
        worldWidth: 14,
        scaleExponent: 0.35,
        weight: 0.25,
        smashColor: 0xeef4ff,
        sizeFrames: [
          { frame: 0, width: 18 },
          { frame: 1, width: 14, yOffset: 2 },
          { frame: 2, width: 11, yOffset: 5 },
          { frame: 3, width: 8, yOffset: 8 },
          { frame: 4, width: 5, yOffset: 9 },
          { frame: 5, width: 3, yOffset: 10 },
        ],
      },
    },
  },
  {
    texture: 'tree',
    weight: 1,
    worldWidth: 45,
    // trees sit a little farther back so their canopies don't crowd the
    // shoulder
    // the trunk is solid
    collide: { z: 10, lane: 0.15 },
    scaleExponent: 1.1,
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
    variants: {
      // cactus (48x48 frames) — physically narrower than the oak, so
      // worldWidth keeps the near-frame ratio (38/46 of the base art)
      desert: {
        texture: 'desert-tree',
        worldWidth: 37,
        scaleExponent: 0.7,
        sizeFrames: [
          { frame: 0, width: 38, yOffset: 1 },
          { frame: 1, width: 29, yOffset: 5 },
          { frame: 2, width: 24, yOffset: 10 },
          { frame: 3, width: 18, yOffset: 13 },
          { frame: 4, width: 14, yOffset: 16 },
          { frame: 5, width: 10, yOffset: 18 },
          { frame: 6, width: 5, yOffset: 20 },
          { frame: 7, width: 3, yOffset: 21 },
        ],
      },
      // tall skinny pine (32x64 frames)
      snow: {
        texture: 'snow-tree',
        worldWidth: 27,
        scaleExponent: 0.7,
        sizeFrames: [
          { frame: 0, width: 28, yOffset: 4 },
          { frame: 1, width: 23, yOffset: 9 },
          { frame: 2, width: 20, yOffset: 12 },
          { frame: 3, width: 15, yOffset: 17 },
          { frame: 4, width: 10, yOffset: 21 },
          { frame: 5, width: 7, yOffset: 24 },
          { frame: 6, width: 4, yOffset: 26 },
          { frame: 7, width: 3, yOffset: 28 },
          { frame: 8, width: 3, yOffset: 30 },
        ],
      },
    },
  },
  {
    texture: 'tree2',
    weight: 1,
    worldWidth: 30,
    collide: { z: 10, lane: 0.15 },
    scaleExponent: 1.1,
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
    variants: {
      // small cactus (32x32 frames)
      desert: {
        texture: 'desert-tree2',
        worldWidth: 19,
        dist: [2, 2.5],
        scaleExponent: 0.6,
        sizeFrames: [
          { frame: 0, width: 18, yOffset: 3 },
          { frame: 1, width: 14, yOffset: 5 },
          { frame: 2, width: 9, yOffset: 7 },
          { frame: 3, width: 8, yOffset: 9 },
          { frame: 4, width: 4, yOffset: 12 },
          { frame: 5, width: 3, yOffset: 14 },
          { frame: 6, width: 2, yOffset: 15 },
        ],
      },
      // second pine shape (32x64 frames)
      snow: {
        texture: 'snow-tree2',
        worldWidth: 29,
        scaleExponent: 0.8,
        sizeFrames: [
          { frame: 0, width: 27, yOffset: 5 },
          { frame: 1, width: 20, yOffset: 14 },
          { frame: 2, width: 15, yOffset: 19 },
          { frame: 3, width: 10, yOffset: 24 },
          { frame: 4, width: 7, yOffset: 26 },
          { frame: 5, width: 5, yOffset: 28 },
          { frame: 6, width: 2, yOffset: 30 },
          { frame: 7, width: 2, yOffset: 31 },
        ],
      },
    },
  },
]

// the endless roadside: decals spawn just past the draw distance as the
// camera advances and are culled once they pass behind it. Purely
// cosmetic — nothing here collides
export class Scenery {
  private scene: Phaser.Scene
  private decals: { obj: RoadObject; spec: DecalSpec; smashColor?: number }[] =
    []
  private nextZ = 0

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  // weight of a decal under the current theme: a variant's own weight
  // overrides its base decal's for spawn-frequency purposes
  private weightOf(d: DecalSpec): number {
    return d.variants?.[world.sceneryTheme]?.weight ?? d.weight
  }

  private pick(): DecalSpec {
    let roll =
      Math.random() * DECALS.reduce((sum, d) => sum + this.weightOf(d), 0)
    for (const d of DECALS) {
      roll -= this.weightOf(d)
      if (roll <= 0) return d
    }
    return DECALS[DECALS.length - 1]
  }

  // call every frame with the camera's position (menu cruise included)
  update(road: Road, position: number) {
    if (this.nextZ < position) this.nextZ = position
    while (this.nextZ < position + SPAWN_AHEAD) {
      const spec = this.pick()
      // the level's themed art, where the decal has it; base sheet
      // otherwise. Already-planted decals keep whatever they spawned as
      const variant = spec.variants?.[world.sceneryTheme]
      const texture = variant?.texture ?? spec.texture
      const sizeFrames = variant?.sizeFrames ?? spec.sizeFrames
      const side = Math.random() < 0.5 ? -1 : 1
      const [min, max] = variant?.dist ?? spec.dist ?? [DIST_MIN, DIST_MAX]
      const dist = min + Math.pow(Math.random(), DIST_BIAS) * (max - min)
      this.decals.push({
        spec,
        // burst colour resolved now, so a later theme change doesn't
        // recolour bushes already planted in the old theme's art
        smashColor: variant?.smashColor ?? spec.smash?.color,
        obj: new RoadObject(this.scene, texture, this.nextZ, side * dist, {
          worldWidth: variant?.worldWidth ?? spec.worldWidth,
          minScale: variant?.minScale ?? spec.minScale ?? 0,
          maxScale: variant?.maxScale ?? spec.maxScale ?? 1,
          scaleExponent: variant?.scaleExponent ?? spec.scaleExponent ?? 0.8,
          // free variety
          flipX: Math.random() < 0.5,
          // the crest-occlusion flag is unreliable for static objects
          // (same as signs/coins), but do hold a decal back until its
          // ground is actually in view, so it can't float over the
          // horizon when it first enters range
          ignoreOcclusion: false,
          ...(SCALE_FIRST_FRAME
            ? {
                // anchor at the largest frame's art bottom (its seat
                // offset as a fraction of the frame height), so the art
                // stays planted at every scale
                originY:
                  1 -
                  (sizeFrames[0].yOffset ?? 0) /
                    this.scene.textures.get(texture).get(0).height,
              }
            : { sizeFrames }),
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

  // every solid decal's box, for the scene's collision pass; lane
  // half-widths scale with the road so the boxes stay physically sized
  forEachCollider(
    cb: (z: number, lane: number, halfZ: number, halfLane: number) => void,
  ) {
    for (const { obj, spec } of this.decals) {
      if (spec.collide)
        cb(
          obj.z,
          obj.laneOffset,
          spec.collide.z,
          spec.collide.lane * laneScale(),
        )
    }
  }

  // soft scenery: any smashable decal overlapping the player's position
  // vanishes in a burst of its configured colour — no damage, no bounce.
  // Call once per live frame with the player's z and lane
  smashAt(road: Road, playerZ: number, playerLane: number) {
    this.decals = this.decals.filter((decal) => {
      const smash = decal.spec.smash
      if (!smash) return true
      if (
        Math.abs(decal.obj.z - playerZ) >= smash.z ||
        Math.abs(playerLane - decal.obj.laneOffset) >=
          smash.lane * laneScale()
      ) {
        return true
      }
      const p = road.project(decal.obj.z, decal.obj.laneOffset)
      this.burst(p.screenX, p.screenY, decal.smashColor ?? smash.color, road)
      decal.obj.destroy()
      return false
    })
  }

  // a puff of 1px squares thrown up and out from the smash point, arcing
  // down under gravity and gone in half a second
  private burst(x: number, y: number, color: number, road: Road) {
    const tint = multiplyColor(color, road.worldTint)
    const parts = Array.from({ length: 10 }, () => ({
      rect: this.scene.add
        .rectangle(x, y - 1 - Math.random() * 3, 1, 1, tint)
        .setDepth(3),
      vx: (Math.random() - 0.5) * 70,
      vy: -15 - Math.random() * 55,
    }))
    let last = 0
    this.scene.tweens.addCounter({
      from: 0,
      to: 0.55,
      duration: 550,
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0
        const dt = t - last
        last = t
        for (const p of parts) {
          p.vy += 260 * dt
          p.rect.x += p.vx * dt
          p.rect.y += p.vy * dt
        }
      },
      onComplete: () => parts.forEach((p) => p.rect.destroy()),
    })
  }
}

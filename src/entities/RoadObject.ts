import { GAME_WIDTH } from '../constants'
import { Road } from './Road'

// a newly picked size frame must beat the current one by this many px of
// projected width, so jitter at a boundary (e.g. traffic pacing the
// player) can't strobe between adjacent variants
// const SIZE_FRAME_HYSTERESIS = 1

export interface RoadObjectOptions {
  // the object's real-world width, in the same units as ROAD_WIDTH — it
  // renders at that width relative to the road at every distance
  worldWidth?: number
  flipX?: boolean
  ignoreOcclusion?: boolean
  // floor on the sprite's rendered scale (safety net so it never vanishes)
  minScale?: number
  // cap on the sprite's rendered scale, so near objects can't balloon
  // past a readable size on the 64px screen
  maxScale?: number
  // <1 compresses the perspective size falloff: the sprite still always
  // shrinks with distance, but far-off signage stays legible instead of
  // collapsing sub-pixel. 1 = true perspective (default)
  scaleExponent?: number
  // pre-drawn size variants, largest first: spritesheet frame + the width
  // (px) of the art drawn in it. When set, the sprite is never scaled —
  // the frame whose art width best matches the projected width is shown at
  // native size, so pixels stay crisp instead of distorting. yOffset (px)
  // seats an individual variant whose art doesn't share the sheet's
  // baseline (e.g. art centred in its frame)
  sizeFrames?: { frame: number; width: number; yOffset?: number }[]
  // with sizeFrames: when the projected width falls below even the
  // smallest variant, scale that frame down so the object grows in from
  // a dot (collectibles). Default off — the smallest variant holds at
  // native size, keeping pixels crisp (vehicles, signs)
  growFromDot?: boolean
  // screen-space px added to the projected y, to seat art that would
  // otherwise look like it floats above the road
  yOffset?: number
  // vertical anchor: 1 (default) plants the art's bottom edge at the
  // projected point; 0.5 centres it there, for art centred in its frame
  originY?: number
}

// any sprite fixed to a point in the world (roadside prop, traffic, ...)
// that scales/positions itself like it's sitting on the track, using the
// same projection the road is drawn with.
//
// project()'s `scale` is a raw perspective factor (screen px per world unit
// at depth z) — the same factor the road multiplies by ROAD_WIDTH for its
// half-width. A texture is sized in pixels, not world units, so the sprite's
// Phaser scale is derived from worldWidth: scale * (halfW * worldWidth) px
// of desired on-screen width, divided by the texture's native width.
export class RoadObject {
  private sprite: Phaser.GameObjects.Sprite
  private pixelsPerWorldUnit: number
  private ignoreOcclusion: boolean
  private minScale: number
  private maxScale: number
  private scaleExponent: number
  private sizeFrames?: { frame: number; width: number; yOffset?: number }[]
  private growFromDot: boolean
  private yOffset: number
  // height above the road in world units, projected like everything else
  // (a hovering object's gap shrinks with distance) — unlike yOffset,
  // which is flat screen px. Callers may animate it every frame
  worldYOffset = 0
  // index into sizeFrames chosen by the last update(); 0 = the nearest,
  // full-detail frame (the only one callers may override, e.g. for lean)
  sizeIndex = -1

  constructor(
    scene: Phaser.Scene,
    texture: string,
    public z: number,
    public laneOffset: number,
    opts: RoadObjectOptions = {},
  ) {
    const {
      worldWidth = 6,
      flipX = false,
      ignoreOcclusion = false,
      minScale = 0,
      maxScale = Infinity,
      scaleExponent = 1,
      originY = 1,
    } = opts
    this.sprite = scene.add
      .sprite(0, 0, texture)
      .setOrigin(0.5, originY)
      .setFlipX(flipX)
    this.pixelsPerWorldUnit =
      ((GAME_WIDTH / 2) * worldWidth) / this.sprite.width
    this.ignoreOcclusion = ignoreOcclusion
    this.minScale = minScale
    this.maxScale = maxScale
    this.scaleExponent = scaleExponent
    this.sizeFrames = opts.sizeFrames
    this.growFromDot = opts.growFromDot ?? false
    this.yOffset = opts.yOffset ?? 0
  }

  update(road: Road) {
    const { screenX, screenY, scale, visible } = road.project(
      this.z,
      this.laneOffset,
    )

    if ((!visible && !this.ignoreOcclusion) || scale <= 0) {
      this.sprite.setVisible(false)
      return
    }

    this.sprite.setVisible(true)
    this.sprite.setTint(road.worldTint)
    this.sprite.setPosition(
      screenX,
      screenY + this.yOffset - this.worldYOffset * scale * (GAME_WIDTH / 2),
    )
    let spriteScale = scale * this.pixelsPerWorldUnit
    if (this.scaleExponent !== 1) {
      // compress relative to the cap so the curve passes through maxScale
      // unchanged and flattens the far end without ever inverting
      const ref = this.maxScale === Infinity ? 1 : this.maxScale
      spriteScale = ref * Math.pow(spriteScale / ref, this.scaleExponent)
    }
    spriteScale = Phaser.Math.Clamp(spriteScale, this.minScale, this.maxScale)

    if (this.sizeFrames) {
      // show the pre-drawn variant closest to the projected art width, at
      // native scale — no resampling distortion
      const desired = spriteScale * this.sizeFrames[0].width
      const smallest = this.sizeFrames[this.sizeFrames.length - 1]
      if (desired < smallest.width && this.growFromDot) {
        // farther than even the smallest variant represents: shrink that
        // one, so the object grows in from a dot instead of popping in
        // at native size
        const shrink = desired / smallest.width
        this.sizeIndex = this.sizeFrames.length - 1
        this.sprite.setFrame(smallest.frame)
        this.sprite.setScale(shrink)
        this.sprite.y += (smallest.yOffset ?? 0) * shrink
      } else {
        let best = 0
        for (let i = 1; i < this.sizeFrames.length; i++) {
          if (
            Math.abs(this.sizeFrames[i].width - desired) <
            Math.abs(this.sizeFrames[best].width - desired)
          ) {
            best = i
          }
        }
        // // sticky: hold the current variant unless the new pick is
        // // decisively closer
        // const cur = this.sizeFrames[this.sizeIndex]
        // if (
        //   best !== this.sizeIndex &&
        //   cur &&
        //   Math.abs(cur.width - desired) <
        //     Math.abs(this.sizeFrames[best].width - desired) +
        //       SIZE_FRAME_HYSTERESIS
        // ) {
        //   best = this.sizeIndex
        // }
        this.sizeIndex = best
        this.sprite.setFrame(this.sizeFrames[best].frame)
        this.sprite.setScale(1)
        this.sprite.y += this.sizeFrames[best].yOffset ?? 0
      }
    } else {
      this.sprite.setScale(spriteScale)
    }
    // nearer objects (bigger scale) draw over farther ones
    this.sprite.setDepth(scale)
  }

  // play a one-shot animation on the sprite (crash effects, etc.)
  play(key: string, onComplete?: () => void) {
    this.sprite.play(key)
    if (onComplete) this.sprite.once('animationcomplete', onComplete)
  }

  setFrame(frame: number, flipX?: boolean) {
    this.sprite.setFrame(frame)
    if (flipX !== undefined) this.sprite.setFlipX(flipX)
  }

  destroy() {
    this.sprite.destroy()
  }
}

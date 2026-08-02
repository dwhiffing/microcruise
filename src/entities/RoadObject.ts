import { GAME_WIDTH } from '../constants'
import { Road } from './Road'

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
    } = opts
    this.sprite = scene.add.sprite(0, 0, texture).setOrigin(0.5, 1).setFlipX(flipX)
    this.pixelsPerWorldUnit = ((GAME_WIDTH / 2) * worldWidth) / this.sprite.width
    this.ignoreOcclusion = ignoreOcclusion
    this.minScale = minScale
    this.maxScale = maxScale
    this.scaleExponent = scaleExponent
  }

  update(road: Road) {
    const { screenX, screenY, scale, visible } = road.project(this.z, this.laneOffset)

    if ((!visible && !this.ignoreOcclusion) || scale <= 0) {
      this.sprite.setVisible(false)
      return
    }

    this.sprite.setVisible(true)
    this.sprite.setPosition(screenX, screenY)
    let spriteScale = scale * this.pixelsPerWorldUnit
    if (this.scaleExponent !== 1) {
      // compress relative to the cap so the curve passes through maxScale
      // unchanged and flattens the far end without ever inverting
      const ref = this.maxScale === Infinity ? 1 : this.maxScale
      spriteScale = ref * Math.pow(spriteScale / ref, this.scaleExponent)
    }
    this.sprite.setScale(Phaser.Math.Clamp(spriteScale, this.minScale, this.maxScale))
    // nearer objects (bigger scale) draw over farther ones
    this.sprite.setDepth(scale)
  }

  setFrame(frame: number, flipX?: boolean) {
    this.sprite.setFrame(frame)
    if (flipX !== undefined) this.sprite.setFlipX(flipX)
  }

  destroy() {
    this.sprite.destroy()
  }
}

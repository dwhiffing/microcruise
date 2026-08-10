import {
  CAMERA_DEPTH,
  COIN_HOVER,
  COIN_WORLD_WIDTH,
  GAME_WIDTH,
} from '../constants'
import { Road } from './Road'
import { RoadObject } from './RoadObject'

// the ground shadow only appears within this many world units of the
// camera (same convention as the checkpoint gantries)
const SHADOW_RANGE = 150
const SHADOW_ALPHA = 0.3
// px between the coin's bottom edge and the shadow
const SHADOW_GAP = 1

// coin.png layout: pre-drawn distance sizes, largest first, each coin
// centred in its 32x32 frame. The widths are each frame's drawn art
// width in px, so the closest match to the projected size shows at
// native scale — same scheme as the turn signs
const SIZE_FRAMES = [
  { frame: 0, width: 18 },
  { frame: 1, width: 15 },
  { frame: 2, width: 13 },
  { frame: 3, width: 10 },
  { frame: 4, width: 8 },
  { frame: 5, width: 6 },
  { frame: 6, width: 5 },
  { frame: 7, width: 4 },
  { frame: 8, width: 3 },
  { frame: 9, width: 2 },
]

// a collectible floating over a lane, projected like any road object
export class Coin extends RoadObject {
  private shadow: Phaser.GameObjects.Rectangle

  constructor(scene: Phaser.Scene, z: number, laneOffset: number) {
    super(scene, 'coin', z, laneOffset, {
      worldWidth: COIN_WORLD_WIDTH,
      // the crest-occlusion flag is unreliable for static on-road points
      // (signs and checkpoints bypass it too) — without this, coins are
      // culled virtually every frame
      ignoreOcclusion: true,
      // floor on the projected size: keeps the farthest coins a ~2px
      // dot instead of vanishing entirely
      minScale: 0.1,
      maxScale: 1,
      scaleExponent: 1,
      sizeFrames: SIZE_FRAMES,
      // far coins ease in from a scaled-down dot instead of popping in
      // at the smallest frame's native size
      growFromDot: true,
      // the art is centred in its frame, not sitting on its bottom edge,
      // so anchor the middle and let the hover offset carry it upward
      originY: 0.5,
    })
    this.worldYOffset = COIN_HOVER
    this.shadow = scene.add
      .rectangle(0, 0, 1, 1, 0x000000, SHADOW_ALPHA)
      .setVisible(false)
  }

  // after the coin itself, place its shadow below it. The art is
  // legibility-oversized versus true perspective, so a shadow projected
  // onto the actual road surface ends up hidden behind the sprite —
  // anchor it just under the art's bottom edge instead
  update(road: Road) {
    super.update(road)
    const p = road.project(this.z, this.laneOffset)
    const show = p.scale > CAMERA_DEPTH / SHADOW_RANGE && this.sizeIndex >= 0
    this.shadow.setVisible(show)
    if (!show) return
    // the coin's centre, mirroring the sprite placement, then down half
    // the (square) art's height to its bottom edge
    const artW = SIZE_FRAMES[this.sizeIndex].width
    const coinY = p.screenY - this.worldYOffset * p.scale * (GAME_WIDTH / 2)
    this.shadow
      .setPosition(p.screenX, coinY + artW / 2 + SHADOW_GAP)
      .setDisplaySize(artW, Math.max(1, artW * 0.15))
      // nudged under the coin's own depth so it never draws over it
      .setDepth(p.scale - 0.0001)
  }

  destroy() {
    this.shadow.destroy()
    super.destroy()
  }
}

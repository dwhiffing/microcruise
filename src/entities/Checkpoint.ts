import { CAMERA_DEPTH, GAME_WIDTH } from '../constants'
import { Road } from './Road'

// posts sit off the road edges (a bit beyond the turn signs' shoulder)
const POST_LANE = 1.15
// how wide one post is in world units
const POST_WORLD_WIDTH = 14
// draw the poles skinnier than the art without affecting gantry height
const POST_WIDTH_FACTOR = 0.6
// the ground shadow only appears within this many world units
const SHADOW_RANGE = 150

// a checkpoint gantry built from three pieces: two posts projected
// independently onto the shoulders (so they track the road through curves
// and hills) and a banner stretched between their tops — its width always
// matches the actual on-screen road width. Uses the 'post' and 'banner'
// frames Boot carves out of flag.png.
export class Checkpoint {
  private left: Phaser.GameObjects.Image
  private right: Phaser.GameObjects.Image
  private banner: Phaser.GameObjects.Image
  private shadow: Phaser.GameObjects.Rectangle
  private postPxPerWorld: number

  constructor(
    scene: Phaser.Scene,
    public z: number,
  ) {
    this.left = scene.add
      .image(0, 0, 'flag', 'post')
      .setOrigin(0.5, 1)
      .setVisible(false)
    this.right = scene.add
      .image(0, 0, 'flag', 'post')
      .setOrigin(0.5, 1)
      .setVisible(false)
    this.banner = scene.add
      .image(0, 0, 'flag', 'banner')
      .setOrigin(0.5, 1)
      .setVisible(false)
    // the banner's shadow, cast on the ground at the poles' feet
    this.shadow = scene.add
      .rectangle(0, 0, 1, 1, 0x000000, 0.3)
      .setOrigin(0.5, 1)
      .setVisible(false)
    this.postPxPerWorld =
      ((GAME_WIDTH / 2) * POST_WORLD_WIDTH) / this.left.width
  }

  update(road: Road) {
    const left = road.project(this.z, -POST_LANE)
    const right = road.project(this.z, POST_LANE)
    // like the turn signs, ignore crest occlusion — on rolling terrain the
    // strict visibility test hides the gantry for most of the approach
    const visible = left.scale > 0
    this.left.setVisible(visible)
    this.right.setVisible(visible)
    this.banner.setVisible(visible)
    this.shadow.setVisible(visible && left.scale > CAMERA_DEPTH / SHADOW_RANGE)
    if (!visible) return

    this.left.setTint(road.worldTint)
    this.right.setTint(road.worldTint)
    this.banner.setTint(road.worldTint)

    const s = left.scale * this.postPxPerWorld
    // width stays true to the projected road, but the vertical falloff is
    // compressed (and post width floored to ~1px) so the gantry reads as a
    // landmark from far away instead of collapsing sub-pixel
    const sy = s >= 1 ? s : Math.pow(s, 1.2)
    const sx = Math.max(s * POST_WIDTH_FACTOR, 0.12)
    this.left
      .setPosition(left.screenX, left.screenY)
      .setScale(sx, sy)
      .setDepth(left.scale)
    this.right
      .setPosition(right.screenX, right.screenY)
      .setScale(sx, sy)
      .setDepth(right.scale)

    // the banner bridges the post tops, stretched to span their outer
    // edges; posts can sit at slightly different heights on a crest, so it
    // rests on their average
    const postW = this.left.width * sx
    const topY = (left.screenY + right.screenY) / 2 - this.left.height * sy
    const span = right.screenX - left.screenX + postW
    this.banner
      .setPosition((left.screenX + right.screenX) / 2, topY)
      .setScale(span / this.banner.width, sy)
      .setDepth(left.scale)

    // shadow lies on the ground at the poles' feet, pole to pole
    this.shadow
      .setPosition(
        (left.screenX + right.screenX) / 2,
        (left.screenY + right.screenY) / 2,
      )
      .setDisplaySize(span, Math.max(1, 2 * sy))
      .setDepth(left.scale)
  }

  destroy() {
    this.left.destroy()
    this.right.destroy()
    this.banner.destroy()
    this.shadow.destroy()
  }
}

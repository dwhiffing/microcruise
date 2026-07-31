import { GAME_HEIGHT, GAME_WIDTH } from '../constants'

export class Car {
  private sprite: Phaser.GameObjects.Sprite
  private currentFrame = 0

  constructor(scene: Phaser.Scene) {
    this.sprite = scene.add.sprite(GAME_WIDTH / 2, GAME_HEIGHT - 10, 'car', 0)
  }

  // steerValue: wheel position -1..1, used only for facing direction.
  // holdTime: seconds the current direction has been held — frame is gated
  // on this directly so brief taps (micro-adjustments) stay on frames 0/1
  // no matter how strong the visual lean would otherwise suggest.
  draw(steerValue: number, holdTime: number) {
    const mag = Math.abs(steerValue)
    let target: number
    if (mag < 0.1) target = 0
    else if (holdTime < 0.4) target = 1
    else if (holdTime < 0.9) target = 2
    else target = holdTime < 1.4 ? 3 : 4

    // step at most one frame per call, so the animation always passes
    // through every intermediate lean instead of popping
    if (target > this.currentFrame) this.currentFrame++
    else if (target < this.currentFrame) this.currentFrame--

    this.sprite.setFrame(this.currentFrame)
    // only flip facing once fully back at center, so a turn the other way
    // doesn't mirror mid-lean
    if (this.currentFrame === 0) this.sprite.setFlipX(false)
    else if (mag >= 0.15) this.sprite.setFlipX(steerValue < 0)
  }

  destroy() {
    this.sprite.destroy()
  }
}

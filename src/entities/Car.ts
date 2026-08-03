import { GAME_HEIGHT, GAME_WIDTH } from '../constants'

export class Car {
  private sprite: Phaser.GameObjects.Sprite
  private currentFrame = 0

  constructor(scene: Phaser.Scene) {
    // depth 1 keeps the player above traffic, whose projected depth is < 1
    this.sprite = scene.add.sprite(GAME_WIDTH / 2, GAME_HEIGHT - 10, 'car', 0).setDepth(1)
  }

  // steerValue: wheel position -1..1; lean frame follows how far the wheel
  // is turned (frames 0-5, 5 = full lock)
  draw(steerValue: number) {
    const mag = Math.abs(steerValue)
    const target =
      mag < 0.1 ? 0 : Math.min(5, 1 + Math.floor(((mag - 0.1) / 0.9) * 5))

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

import { GAME_HEIGHT, GAME_WIDTH } from '../constants'

// while drifting, the lean advances one frame every this many ticks
// (~60/s), so the ramp to full lock is visible rather than near-instant
const DRIFT_LEAN_EVERY = 4

export class Car {
  private sprite: Phaser.GameObjects.Sprite
  private currentFrame = 0
  private driftTick = 0

  constructor(scene: Phaser.Scene) {
    // depth 1 keeps the player above traffic, whose projected depth is < 1
    this.sprite = scene.add.sprite(GAME_WIDTH / 2, GAME_HEIGHT - 10, 'car', 0).setDepth(1)
  }

  // steerValue: wheel position -1..1; lean frame follows how far the wheel
  // is turned (frames 0-5, 5 = full lock). steerInput: the raw held
  // direction (-1/0/1) — pressing a key shows the first lean frame
  // immediately, without waiting for the wheel to ramp up. driftDir:
  // while drifting the car snaps straight to full lock in that direction
  draw(steerValue: number, steerInput: number, driftDir: number) {
    // drifting ramps through the lean frames to full lock (frame 5) at a
    // visible pace instead of snapping there
    if (driftDir !== 0) {
      this.sprite.setFlipX(driftDir < 0)
      this.driftTick++
      if (this.currentFrame < 5 && this.driftTick % DRIFT_LEAN_EVERY === 0) {
        this.currentFrame++
      }
      this.sprite.setFrame(this.currentFrame)
      return
    }
    this.driftTick = 0

    // normal turns cap at frame 4 — frame 5 (full lock) is drift-only
    const mag = Math.abs(steerValue)
    let target =
      mag < 0.1 ? 0 : Math.min(4, 1 + Math.floor(((mag - 0.1) / 0.9) * 4))
    // pressing a direction holds at least the first lean frame — but only
    // while the wheel isn't still on the opposite side, so a direction
    // switch rests on the straight frame until the wheel crosses over
    if (steerInput !== 0 && target === 0 && steerInput * steerValue >= 0) {
      target = 1
    }

    // facing can only change while the car is centred, so a switch never
    // mirrors a lean — it passes through straight, flips, and climbs back
    if (this.currentFrame === 0) {
      this.sprite.setFlipX((steerInput || steerValue) < 0)
    }

    // step at most one frame per call, so the animation always passes
    // through every intermediate lean instead of popping
    if (target > this.currentFrame) this.currentFrame++
    else if (target < this.currentFrame) this.currentFrame--

    this.sprite.setFrame(this.currentFrame)
  }

  destroy() {
    this.sprite.destroy()
  }
}

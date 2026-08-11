import { GAME_HEIGHT, GAME_WIDTH, MAX_HEALTH } from '../constants'
import { lerpColor, multiplyColor } from './Road'

// while drifting, the lean advances one frame every this many ticks
// (~60/s), so the ramp to full lock is visible rather than near-instant;
// the unwind back to straight afterwards is slower still
const DRIFT_LEAN_EVERY = 4
const DRIFT_UNWIND_EVERY = 8

// the car's racing position, and its parking spot below the frame while
// the menu is up
const HOME_Y = GAME_HEIGHT - 10
const OFFSCREEN_Y = GAME_HEIGHT + 20

// hit feedback: body-coloured debris shards and yellow sparks
const DEBRIS_COLOR = 0x6b4fc0
const SPARK_COLOR = 0xffec27
// the body flashes this colour when a coin is collected; strength is how
// far from no-tint toward the full colour the wash goes (0-1)
const COIN_FLASH_COLOR = 0x5959b3
const COIN_FLASH_STRENGTH = 0.45
const COIN_FLASH_MS = 60
// crossing a checkpoint: green body wash plus a confetti burst — bits
// stay untinted like the sparks, so they pop at night
const CHECKPOINT_FLASH_COLOR = 0x191970
const CHECKPOINT_FLASH_STRENGTH = 0.6
const CHECKPOINT_FLASH_MS = 100
const CONFETTI_COLORS = [0xff3b3b, 0xffec27, 0x29adff, 0x00e436, 0xff77a8]
const CONFETTI_COUNT = 14

// where tire smoke spawns, relative to the sprite centre, for each lean
// frame 0-5 (the art faces right; a left-facing car mirrors the x's):
// left/right are the rear wheels' x offsets, y is shared
const TIRE_SMOKE_OFFSETS = [
  { left: -15, right: 15, y: 2 }, // 0 straight
  { left: -16, right: 14, y: 2 },
  { left: -17, right: 13, y: 2 },
  { left: -18, right: 12, y: 2 },
  { left: -19, right: 11, y: 2 },
  { left: -20, right: 10, y: 2 }, // 5 full lock
]

interface Debris {
  rect: Phaser.GameObjects.Rectangle
  vx: number
  vy: number
  spin: number
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  trail: { x: number; y: number }[]
}

export class Car {
  private scene: Phaser.Scene
  private sprite: Phaser.GameObjects.Sprite
  private smoke: Phaser.GameObjects.Sprite
  private fire: Phaser.GameObjects.Sprite
  private explosion: Phaser.GameObjects.Sprite
  private sparkGfx: Phaser.GameObjects.Graphics
  private debris: Debris[] = []
  private sparks: Spark[] = []
  private currentFrame = 0
  private facing = 1 // 1 = right-lean art, -1 = left (+6 within the row)
  private damageOffset = 0 // +12/+24 car-frame rows as health drops
  private driftTick = 0
  private unwinding = false // easing back down from a drift's full lock
  // day/night multiply from the sky cycle
  private dayTint = 0xffffff
  private flashing = false // damage flash owns the sprite's tint while true
  private lastTireSmoke = 0 // rate limit on burnout puffs (ms timestamp)
  private shakeAmount = 0 // continuous rattle (px), set every live frame
  private impactJolt = 0 // decaying rattle kicked off by a collision
  private braking = false // swaps to the lit-taillight sheet

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    // depth 1 keeps the player above traffic, whose projected depth is < 1
    this.sprite = scene.add.sprite(GAME_WIDTH / 2, HOME_Y, 'car', 0).setDepth(1)

    for (const size of ['small', 'med', 'large']) {
      scene.anims.create({
        key: `${size}-smoke`,
        frames: scene.anims.generateFrameNumbers(`${size}-smoke`),
        frameRate: 10,
        repeat: -1,
      })
      scene.anims.create({
        key: `${size}-fire`,
        frames: scene.anims.generateFrameNumbers(`${size}-fire`),
        frameRate: 12,
        repeat: -1,
      })
    }
    scene.anims.create({
      key: 'explode',
      frames: scene.anims.generateFrameNumbers('explode'),
      frameRate: 14,
    })
    // one tire-smoke / kicked-up-dirt puff, played through once per
    // particle
    scene.anims.create({
      key: 'tire-smoke',
      frames: scene.anims.generateFrameNumbers('smoke'),
      frameRate: 14,
    })
    scene.anims.create({
      key: 'tire-dirt',
      frames: scene.anims.generateFrameNumbers('dirt'),
      frameRate: 14,
    })
    // coin pickup flash: loops while the coin floats up out of the car
    scene.anims.create({
      key: 'coin-spin',
      frames: scene.anims.generateFrameNumbers('coin-spin'),
      frameRate: 32,
      repeat: -1,
    })

    // damage effects anchored to the car: flames sit on the body, the
    // smoke plume rises above it, the explosion covers it
    const cx = this.sprite.x
    this.fire = scene.add
      .sprite(cx + 1, this.sprite.y - 5, 'fire-small', 0)
      .setOrigin(0.5, 1)
      .setDepth(0.6)
      .setVisible(false)
    this.smoke = scene.add
      .sprite(cx + 1, this.sprite.y - 1, 'smoke-small', 0)
      .setOrigin(0.5, 1)
      .setDepth(0.5)
      .setVisible(false)
    this.explosion = scene.add
      .sprite(cx, this.sprite.y + 8, 'explode', 0)
      .setOrigin(0.5, 1)
      .setDepth(2)
      .setVisible(false)

    this.sparkGfx = scene.add.graphics().setDepth(3)
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.updateParticles, this)
  }

  // hit feedback: white flash for a frame, debris shards arcing off both
  // sides, and a burst of streaking sparks over the car
  onDamage(count = 1 + Math.floor(Math.random() * 2)) {
    this.sprite.setTintFill(0xffffff)
    this.flashing = true
    this.scene.time.delayedCall(40, () => {
      this.flashing = false
      this.sprite.setTint(this.dayTint)
    })

    // 1-2 body-coloured 2x5 shards per side, spinning, launched diagonally
    // up and out; they vanish once they fall past the car's bottom
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        const rect = this.scene.add
          .rectangle(
            this.sprite.x + side * 6,
            this.sprite.y - 4,
            2,
            5,
            multiplyColor(DEBRIS_COLOR, this.dayTint),
          )
          .setDepth(3)
        this.debris.push({
          rect,
          vx: side * (20 + Math.random() * 30),
          vy: -(30 + Math.random() * 40),
          spin: (Math.random() - 0.5) * 20,
        })
      }
    }

    // 5 sparks from random points across the car's top, random headings,
    // gone in 200-300ms
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 40 + Math.random() * 50
      this.sparks.push({
        x: this.sprite.x - 12 + Math.random() * 24,
        y: this.sprite.y - 6 + Math.random() * 4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.2 + Math.random() * 0.1,
        maxLife: 0.3,
        trail: [],
      })
    }
  }

  // checkpoint crossed: the body flashes green and confetti flutters up
  // off the car — the pieces ride the debris system, launched upward,
  // arcing back down under its gravity and culled below the car
  onCheckpoint() {
    const wash = lerpColor(
      0xffffff,
      CHECKPOINT_FLASH_COLOR,
      CHECKPOINT_FLASH_STRENGTH,
    )
    this.sprite.setTintFill(multiplyColor(wash, this.dayTint))
    this.flashing = true
    this.scene.time.delayedCall(CHECKPOINT_FLASH_MS, () => {
      this.flashing = false
      this.sprite.setTintFill(this.dayTint)
    })

    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const rect = this.scene.add
        .rectangle(
          this.sprite.x - 10 + Math.random() * 20,
          this.sprite.y - 2,
          1,
          2,
          CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        )
        .setDepth(3)
      this.debris.push({
        rect,
        vx: (Math.random() - 0.5) * 70,
        vy: -(50 + Math.random() * 60),
        spin: (Math.random() - 0.5) * 30,
      })
    }
  }

  // true while still easing back down from a drift's full lock — the
  // skid marks/smoke/shake keep running until the car straightens out
  isUnwinding() {
    return this.unwinding && this.currentFrame > 0
  }

  // continuous shake amplitude (burnout, off-road), refreshed every frame
  setShake(amount: number) {
    this.shakeAmount = amount
  }

  // a collision rattles the car hard for a moment
  jolt(strength = 1.5) {
    this.impactJolt = strength
  }

  private updateParticles(_time: number, delta: number) {
    const dt = delta / 1000
    this.impactJolt = Math.max(0, this.impactJolt - 12 * dt)

    // debris arcs under gravity, spinning; killed below the car sprite
    const carBottom = this.sprite.y + 8
    this.debris = this.debris.filter((d) => {
      d.vy += 150 * dt
      d.rect.x += d.vx * dt
      d.rect.y += d.vy * dt
      d.rect.rotation += d.spin * dt
      if (d.vy > 0 && d.rect.y > carBottom) {
        d.rect.destroy()
        return false
      }
      return true
    })

    // sparks streak along their heading with a short fading trail
    this.sparkGfx.clear()
    this.sparks = this.sparks.filter((spark) => {
      spark.life -= dt
      if (spark.life <= 0) return false
      spark.trail.unshift({ x: spark.x, y: spark.y })
      if (spark.trail.length > 4) spark.trail.pop()
      spark.x += spark.vx * dt
      spark.y += spark.vy * dt
      const alpha = spark.life / spark.maxLife
      this.sparkGfx.fillStyle(SPARK_COLOR, alpha)
      this.sparkGfx.fillRect(spark.x, spark.y, 1, 1)
      spark.trail.forEach((p, i) => {
        this.sparkGfx.fillStyle(SPARK_COLOR, alpha * (1 - (i + 1) / 5))
        this.sparkGfx.fillRect(p.x, p.y, 1, 1)
      })
      return true
    })
  }

  // burnout: a puff kicked up behind each rear wheel, drifting out and
  // back as its animation plays through — tire smoke on tarmac, dirt in
  // the grass. Call every frame while the tires should be spinning; the
  // rate limit spaces the puffs out
  emitTireSmoke(dirt = false) {
    const now = this.scene.time.now
    if (now - this.lastTireSmoke < 150) return
    this.lastTireSmoke = now
    // wheel anchors follow the current lean frame, mirrored when the art
    // faces left
    const { left, right, y } = TIRE_SMOKE_OFFSETS[this.currentFrame]
    const wheelX = this.facing < 0 ? [-right, -left] : [left, right]
    for (const side of [-1, 1]) {
      const puff = this.scene.add
        .sprite(
          this.sprite.x + wheelX[side < 0 ? 0 : 1],
          this.sprite.y + y,
          dirt ? 'dirt' : 'smoke',
          0,
        )
        .setDepth(1.5) // under the car body, over the damage effects
        .setTint(this.dayTint)
      puff.play(dirt ? 'tire-dirt' : 'tire-smoke')
      this.scene.tweens.add({
        targets: puff,
        x: puff.x + side * (3 + Math.random() * 4),
        y: puff.y + 1 + Math.random() * 1,
        duration: 300,
      })
      puff.once('animationcomplete', () => puff.destroy())
    }
  }

  // coin collected: the body flashes the coin's colour and a spinning
  // coin pops out of the car and floats up, hanging for a beat before it
  // fades. Day-tinted like the smoke, so night pickups don't glow
  emitCoin() {
    // a partial-strength wash: blend the flash colour in from white so
    // only a fraction of the red cast lands, then multiply with the day
    // tint so night-time flashes don't glow
    const wash = lerpColor(0xffffff, COIN_FLASH_COLOR, COIN_FLASH_STRENGTH)
    this.sprite.setTint(multiplyColor(wash, this.dayTint))
    this.flashing = true
    this.scene.time.delayedCall(COIN_FLASH_MS, () => {
      this.flashing = false
      this.sprite.setTint(this.dayTint)
    })

    const coin = this.scene.add
      .sprite(this.sprite.x, this.sprite.y - 10, 'coin-spin', 0)
      .setDepth(2)
      .setTint(this.dayTint)
    coin.play('coin-spin')
    this.scene.tweens.add({
      targets: coin,
      y: coin.y - 10,
      duration: 350,
      ease: 'Cubic.easeOut',
    })
    this.scene.tweens.add({
      targets: coin,
      alpha: 0,
      delay: 200,
      duration: 150,
      onComplete: () => coin.destroy(),
    })
  }

  // apply the day/night world multiply to the car and its smoke. Fire,
  // sparks, the explosion, and the damage flash stay untinted — they're
  // light sources
  setDayTint(tint: number) {
    this.dayTint = tint
    if (!this.flashing) this.sprite.setTint(tint)
    this.smoke.setTint(tint)
  }

  setHealth(health: number) {
    this.damageOffset = health < 70 ? 24 : health < 95 ? 12 : 0
    this.applyFrame()

    const smokeSize =
      health < 30 ? 'large' : health < 40 ? 'med' : health < 50 ? 'small' : null
    const fireSize =
      health < 10 ? 'large' : health < 20 ? 'med' : health < 30 ? 'small' : null

    const smoking = health > 0 && smokeSize !== null
    this.smoke.setVisible(smoking)
    if (smoking) this.smoke.play(`${smokeSize}-smoke`, true)
    else this.smoke.stop()

    const burning = health > 0 && fireSize !== null
    this.fire.setVisible(burning)
    if (burning) this.fire.play(`${fireSize}-fire`, true)
    else this.fire.stop()
  }

  // the car is done: hide it (and its damage effects), play the explosion
  // once, then hand control back
  explode(onComplete: () => void) {
    this.sprite.setVisible(false)
    this.smoke.setVisible(false).stop()
    this.fire.setVisible(false).stop()
    this.explosion.setVisible(true).play('explode')
    this.explosion.once('animationcomplete', () => {
      this.explosion.setVisible(false)
      onComplete()
    })
  }

  // menu state: park the car below the frame
  park() {
    this.sprite.y = OFFSCREEN_Y
  }

  // drive in from below and brake into the starting position: the ease
  // overshoots past the mark and settles back, reading as a hard stop.
  // The car swings in at a slight angle (random side) and straightens
  // through the lean frames as it brakes.
  enter(onComplete: () => void, onSkid?: (wheelY: number) => void) {
    this.currentFrame = 2
    this.facing = Math.random() < 0.5 ? -1 : 1
    this.applyFrame()
    this.scene.tweens.add({
      targets: this.sprite,
      y: HOME_Y,
      duration: 700,
      ease: 'Back.easeOut',
      onUpdate: (tween) => {
        const frame = tween.progress > 0.85 ? 0 : tween.progress > 0.6 ? 1 : 2
        if (frame !== this.currentFrame) {
          this.currentFrame = frame
          this.applyFrame()
        }
        // the tires bite once the braking phase of the entrance begins;
        // the hook lets the scene lay skid marks under the rear wheels
        this.emitTireSmoke()
        onSkid?.(this.sprite.y + 8)
      },
      onComplete,
    })
  }

  // drive off the bottom of the frame as the menu comes back; the damage
  // smoke/fire only track the car during live frames, so they'd hover in
  // place — hide them instead
  exit() {
    this.smoke.setVisible(false).stop()
    this.fire.setVisible(false).stop()
    this.scene.tweens.add({
      targets: this.sprite,
      y: OFFSCREEN_Y,
      duration: 400,
      ease: 'Sine.easeIn',
    })
  }

  // fresh run: car back, straightened, effects and leftover particles off
  reset() {
    this.braking = false
    this.unwinding = false
    this.driftTick = 0
    this.currentFrame = 0
    this.facing = 1
    this.sprite.setVisible(true)
    this.flashing = false
    this.sprite.setTint(this.dayTint)
    this.explosion.setVisible(false)
    this.setHealth(MAX_HEALTH)
    this.debris.forEach((d) => d.rect.destroy())
    this.debris = []
    this.sparks = []
    this.sparkGfx.clear()
  }

  // steerValue: wheel position -1..1; lean frame follows how far the wheel
  // is turned (frames 0-5, 5 = full lock). steerInput: the raw held
  // direction (-1/0/1) — pressing a key shows the first lean frame
  // immediately, without waiting for the wheel to ramp up. driftDir:
  // while drifting the car snaps straight to full lock in that direction.
  // launching: hard low-speed acceleration — the car sits on frame 1
  // instead of the neutral frame while pulling away
  draw(
    steerValue: number,
    steerInput: number,
    driftDir: number,
    launching = false,
  ) {
    // the car rattles in place instead of the camera: burnout/off-road
    // jitter or a collision jolt, whichever is stronger, around its
    // fixed racing position
    const shake = Math.max(this.shakeAmount, this.impactJolt)
    this.sprite.x = GAME_WIDTH / 2 + (Math.random() - 0.5) * shake
    this.sprite.y = HOME_Y + (Math.random() - 0.5) * shake

    // drifting ramps through the lean frames to full lock (frame 5) at a
    // visible pace instead of snapping there
    if (driftDir !== 0) {
      this.facing = driftDir
      this.driftTick++
      if (this.currentFrame < 5 && this.driftTick % DRIFT_LEAN_EVERY === 0) {
        this.currentFrame++
      }
      this.unwinding = true
      this.applyFrame()
      this.positionEffects()
      return
    }

    // normal turns cap at frame 4 — frame 5 (full lock) is drift-only
    const mag = Math.abs(steerValue)
    let target =
      mag < 0.1 ? 0 : Math.min(4, 1 + Math.floor(((mag - 0.1) / 0.9) * 4))
    // pressing a direction holds at least the first lean frame — but only
    // while the wheel isn't still on the opposite side AND the art is
    // already facing that way. Otherwise (direction switch, or a launch
    // squat leaning the wrong side) the frame must rest on straight so
    // the facing can flip there
    if (
      steerInput !== 0 &&
      target === 0 &&
      steerInput * steerValue >= 0 &&
      steerInput === this.facing
    ) {
      target = 1
    }
    // launching off the line never rests on the flat neutral frame — but
    // only while no direction is held, so a turn can still pass through
    // neutral to flip the car's facing instead of being pinned on the
    // old side's lean
    if (launching && target === 0 && steerInput === 0) target = 1

    // coming off a drift, unwind the lock gently — one frame every
    // DRIFT_UNWIND_EVERY ticks — so every lean frame shows on the way
    // back down and the recovery reads slower than the ramp-in
    if (this.unwinding) {
      if (this.currentFrame <= target) {
        this.unwinding = false
        this.driftTick = 0
      } else {
        this.driftTick++
        if (this.driftTick % DRIFT_UNWIND_EVERY === 0) this.currentFrame--
        this.applyFrame()
        this.positionEffects()
        return
      }
    }
    this.driftTick = 0

    // facing can only change while the car is centred, so a switch never
    // mirrors a lean — it passes through straight, turns, and climbs back
    if (this.currentFrame === 0) {
      this.facing = (steerInput || steerValue) < 0 ? -1 : 1
    }

    // step at most one frame per call, so the animation always passes
    // through every intermediate lean instead of popping
    if (target > this.currentFrame) this.currentFrame++
    else if (target < this.currentFrame) this.currentFrame--

    this.applyFrame()
    this.positionEffects()
  }

  // the sheet is 12 frames per row: 0-5 lean right, 6-11 the same leans
  // drawn facing left (no sprite flipping), with damage rows at +12/+24
  private applyFrame() {
    const left = this.facing < 0 && this.currentFrame > 0 ? 6 : 0
    this.sprite.setTexture(
      this.braking ? 'car-brake' : 'car',
      this.currentFrame + left + this.damageOffset,
    )
  }

  // light the taillights (recoloured sheet) while the brake is held
  setBraking(braking: boolean) {
    if (braking === this.braking) return
    this.braking = braking
    this.applyFrame()
  }

  // smoke/fire ride the car's rear, which swings 1px per lean frame away
  // from the direction of the turn
  private positionEffects() {
    const rear = (this.facing < 0 ? -1 : 1) * this.currentFrame
    this.fire.x = this.sprite.x + 1 + rear
    this.smoke.x = this.sprite.x + rear
  }

  destroy() {
    this.sprite.destroy()
  }
}

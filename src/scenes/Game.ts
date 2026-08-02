import { Scene, Types } from 'phaser'
import {
  ACCEL,
  BRAKE,
  CENTRIFUGAL,
  COAST_DECEL,
  MAX_SPEED,
  MICRO_STEER,
  MIN_LEAN_SPEED,
  OFFROAD_ACCEL_FACTOR,
  OFFROAD_DECEL,
  OFFROAD_MAX_SPEED,
  OFFROAD_SHAKE,
  PLAYER_Z,
  REFERENCE_SPEED,
  SLOPE_DRAG,
  STEER_RAMP,
  STEER_RETURN,
  STEER_REVERSE_RETURN,
  STEER_SPEED,
} from '../constants'
import { Car } from '../entities/Car'
import { Road } from '../entities/Road'
import { RoadObject } from '../entities/RoadObject'
import { UI } from '../entities/UI'

// turn-warning chevrons: how many repeats lead into a big turn, how far
// apart they're spaced, and how far before the bend the first one sits
const TURN_SIGN_REPEATS = 12
const TURN_SIGN_GAP = 80
const TURN_SIGN_LEAD = 2000

export class Game extends Scene {
  public ui!: UI
  public music: Phaser.Sound.BaseSound
  private cursors!: Types.Input.Keyboard.CursorKeys
  private keyZ!: Phaser.Input.Keyboard.Key
  private road!: Road
  private car!: Car
  private turnSigns: RoadObject[] = []
  private speed = 0
  private playerX = 0 // -1..1 = on road, beyond that = grass
  private steerValue = 0 // wheel position, -1 (full left) .. 1 (full right)
  private steerHoldTime = 0 // seconds the current direction has been held
  private distance = 0

  constructor() {
    super('Game')
  }

  create(): void {
    this.cameras.main.fadeFrom(500, 0, 0, 0)
    this.music = this.sound.add('music', { loop: true, volume: 0.3 })

    this.road = new Road(this)
    this.car = new Car(this)
    this.ui = new UI(this)
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.keyZ = this.input.keyboard!.addKey('Z')

    this.data.set('paused', 1)
    this.data.set('gameover', 1)
    const highScore = Number(localStorage.getItem('highScore') ?? '0')
    this.data.set('highScore', highScore)
    if (highScore > 0) {
      this.ui.scoreText.setText(`HIGH SCORE\n${highScore}`)
      this.ui.title.y = 14
    }

    this.input.keyboard!.on('keydown-M', () => {
      const newMute = !this.game.sound.mute
      this.game.sound.setMute(newMute)
      localStorage.setItem('mute', String(newMute))
    })

    const muteStatus = localStorage.getItem('mute')
    if (muteStatus !== null) {
      this.game.sound.setMute(muteStatus === 'true')
    }

    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      if (!e.key.includes('Arrow') && e.key.toLowerCase() !== 'z') return
      this.startGame()
    })
    this.input.on('pointerdown', this.startGame)
  }

  startGame = () => {
    if (this.data.get('gameover') === 0) return

    this.speed = 0
    this.playerX = 0
    this.steerValue = 0
    this.distance = 0
    this.road.reset()
    this.turnSigns.forEach((sign) => sign.destroy())
    this.turnSigns = []

    this.data.set('gameover', 0)
    this.data.set('score', 0)
    this.music.play()
    this.ui.titleTextTween?.pause()
    this.tweens.add({
      targets: [this.ui.titleText, this.ui.scoreText, this.ui.title],
      alpha: 0,
      duration: 500,
      onComplete: () => {
        this.data.set('paused', 0)
      },
    })
  }

  gameOver = () => {
    this.data.set('paused', 1)
    this.music.pause()

    const score = this.data.get('score') ?? 0
    const prevHighScore = Number(localStorage.getItem('highScore') ?? '0')
    if (score > prevHighScore) {
      localStorage.setItem('highScore', String(score))
      this.data.set('highScore', score)
    }

    this.ui.title.y = 14
    this.ui.scoreText.setText(`HIGH SCORE\n${this.data.get('highScore') ?? 0}`)
    this.tweens.add({
      targets: [this.ui.scoreText, this.ui.title, this.ui.titleText],
      alpha: 1,
      duration: 1500,
      onComplete: () => {
        this.ui.titleTextTween?.restart()
        this.data.set('gameover', 1)
      },
    })
  }

  update(_time: number, delta: number): void {
    if (this.data.get('paused')) return

    const dt = delta / 1000
    const offRoad = Math.abs(this.playerX) > 1

    if (this.cursors.up.isDown || this.keyZ.isDown) {
      this.speed += ACCEL * (offRoad ? OFFROAD_ACCEL_FACTOR : 1) * dt
    } else if (this.cursors.down.isDown) {
      this.speed -= BRAKE * dt
    } else {
      this.speed -= COAST_DECEL * dt
    }
    if (offRoad && this.speed > OFFROAD_MAX_SPEED) {
      this.speed -= OFFROAD_DECEL * dt
    }
    // climbing bleeds speed, dropping returns it
    this.speed -= this.road.slopeAt(this.distance + PLAYER_Z) * SLOPE_DRAG * dt
    this.speed = Phaser.Math.Clamp(this.speed, 0, MAX_SPEED)

    // quick taps give an immediate, responsive nudge (micro-adjustments);
    // reaching full lock still requires holding the same direction for
    // ~1.5s. steerHoldTime tracks how long the current direction has been
    // held; MICRO_STEER is available the instant a key is pressed, and the
    // remaining travel to full lock ramps in on top of it over the hold.
    // below this speed steering still works, but is capped to a micro
    // adjustment — the hold ramp toward full lock doesn't build up
    const canSteer = this.speed >= MIN_LEAN_SPEED
    const steerTarget =
      (this.cursors.left.isDown ? -1 : 0) + (this.cursors.right.isDown ? 1 : 0)
    if (steerTarget !== 0 && steerTarget * this.steerValue >= 0) {
      if (canSteer) this.steerHoldTime += dt
      const t = Math.min(1, this.steerHoldTime / STEER_RAMP)
      this.steerValue =
        steerTarget * (canSteer ? MICRO_STEER + (1 - MICRO_STEER) * t * t : MICRO_STEER)
    } else {
      // released — or counter-steering, which decays slower so direction
      // switches take longer and always pass back through center. Hold
      // progress is lost either way.
      const counter = steerTarget !== 0
      const decay = (counter ? STEER_REVERSE_RETURN : STEER_RETURN) * dt
      this.steerValue =
        Math.abs(this.steerValue) <= decay
          ? 0
          : this.steerValue - Math.sign(this.steerValue) * decay
      if (counter || this.steerValue === 0) this.steerHoldTime = 0
    }

    // steering and centrifugal pull scale with absolute speed against a fixed
    // reference, so curves push equally hard at a given real speed no matter
    // the top speed. Steering authority is clamped (floor: recovering from
    // grass isn't tedious; cap: no hyper-twitch at max), while the pull is
    // uncapped — every curve has a max speed it can be held at.
    const speedFactor = this.speed / REFERENCE_SPEED
    const steerAuthority =
      this.speed > 0 ? Phaser.Math.Clamp(speedFactor, 0.35, 1.2) : 0
    this.playerX += this.steerValue * STEER_SPEED * steerAuthority * dt
    this.playerX -=
      this.road.curveAt(this.distance + PLAYER_Z) *
      CENTRIFUGAL *
      speedFactor *
      dt
    this.playerX = Phaser.Math.Clamp(this.playerX, -5, 5)

    this.distance += this.speed * dt

    this.road.update(this.distance, this.playerX)
    // below this speed steerHoldTime never grows, so draw() naturally stays
    // capped to the micro-adjustment frames
    this.car.draw(this.steerValue, this.steerHoldTime)

    // spawn a repeated run of chevrons on the outside shoulder just before
    // each big turn the road generator flags; direction picks which way the
    // chevron points and which shoulder it sits on
    for (const turn of this.road.drainTurnWarnings()) {
      const laneOffset = turn.direction > 0 ? -1.15 : 1.15
      for (let i = 0; i < TURN_SIGN_REPEATS; i++) {
        this.turnSigns.push(
          new RoadObject(
            this,
            'turn-sign',
            turn.z - TURN_SIGN_LEAD + i * TURN_SIGN_GAP,
            laneOffset,
            {
              worldWidth: 20,
              flipX: turn.direction > 0,
              ignoreOcclusion: true,
              minScale: 0.01,
              maxScale: 1,
              scaleExponent: 0.8,
            },
          ),
        )
      }
    }
    this.turnSigns = this.turnSigns.filter((sign) => {
      if (sign.z < this.distance) {
        sign.destroy()
        return false
      }
      sign.update(this.road)
      return true
    })

    // shake the camera while off-road, scaled by how fast the grass is
    // rumbling underneath — stronger at speed, absent once slowed down
    if (offRoad && this.speed > 0) {
      const shake = Math.min(1, this.speed / OFFROAD_MAX_SPEED) * OFFROAD_SHAKE
      this.cameras.main.setScroll(
        (Math.random() - 0.5) * shake,
        (Math.random() - 0.5) * shake,
      )
    } else {
      this.cameras.main.setScroll(0, 0)
    }

    this.data.set('score', Math.floor(this.distance / 10))
  }
}

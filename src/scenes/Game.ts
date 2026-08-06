import { Scene, Types } from 'phaser'
import {
  ACCEL,
  AUTO_SHIFT,
  BRAKE,
  CAR_COLLIDE_LANE,
  CAR_COLLIDE_Z,
  CENTRIFUGAL,
  CHECKPOINT_BONUS,
  CHECKPOINT_INTERVAL,
  COAST_DECEL,
  DRIFT_ACCEL,
  DRIFT_GRIP,
  DRIFT_MIN_SPEED,
  DRIFT_MIN_STEER,
  ENGINE_BRAKE,
  GEAR_ACCEL,
  GEAR_MAX,
  LANES,
  MAX_SCORE,
  MAX_SPEED,
  MAX_TIME,
  OFFROAD_ACCEL_FACTOR,
  OFFROAD_DECEL,
  OFFROAD_MAX_SPEED,
  OFFROAD_SHAKE,
  OFFROAD_SHAKE_MIN_SPEED,
  PLAYER_Z,
  RACE_TIME,
  REFERENCE_SPEED,
  RPM_CURVE,
  SIGN_COLLIDE_LANE,
  SIGN_COLLIDE_Z,
  SLOPE_DRAG,
  STEER_RATE,
  STEER_RETURN,
  STEER_SPEED,
  TOP_SPEED_MPH,
  TRAFFIC_COUNT,
  TRAFFIC_MAX_SPEED,
  TRAFFIC_MIN_SPEED,
  TURN_SIGN_GAP,
  TURN_SIGN_LEAD,
  TURN_SIGN_REPEATS,
} from '../constants'
import { Car } from '../entities/Car'
import { Checkpoint } from '../entities/Checkpoint'
import { NpcCar } from '../entities/NpcCar'
import { Road } from '../entities/Road'
import { RoadObject } from '../entities/RoadObject'
import { UI } from '../entities/UI'

// turn-sign.png layout: 9 frames, largest first, each 2px narrower than
// the last down to a final 1px sliver — pre-drawn distance sizes so signs
// never scale-distort
const SIGN_SIZE_FRAMES = Array.from({ length: 9 }, (_, i) => ({
  frame: i,
  width: Math.max(1, 16 - i * 2),
}))

export class Game extends Scene {
  public ui!: UI
  public music: Phaser.Sound.BaseSound
  private cursors!: Types.Input.Keyboard.CursorKeys
  private keyZ!: Phaser.Input.Keyboard.Key
  private keyX!: Phaser.Input.Keyboard.Key
  private road!: Road
  private car!: Car
  private turnSigns: RoadObject[] = []
  private checkpoints: Checkpoint[] = []
  private nextCheckpointZ = CHECKPOINT_INTERVAL
  private traffic: NpcCar[] = []
  private speed = 0
  private playerX = 0 // -1..1 = on road, beyond that = grass
  private steerValue = 0 // wheel position, -1 (full left) .. 1 (full right)
  private steerInput = 0 // raw held direction this frame: -1, 0, or 1
  private driftDir = 0 // -1/1 while drifting in that direction, 0 otherwise
  private gear = 1 // current gear, 1-6
  private timeScale = 1 // debug slow-motion factor (keys 1-5)
  private bounceVx = 0 // lateral knockback from collisions, decays quickly
  private distance = 0
  private timeLeft = RACE_TIME
  private paused = true
  private isGameOver = true
  private highScore = 0

  constructor() {
    super('Game')
  }

  private get score() {
    return Math.min(MAX_SCORE, Math.floor(this.distance / 100))
  }

  create(): void {
    this.cameras.main.fadeFrom(500, 0, 0, 0)
    this.music = this.sound.add('music', { loop: true, volume: 0.3 })
    this.music.pause()

    this.road = new Road(this)
    this.car = new Car(this)
    this.traffic = Array.from({ length: TRAFFIC_COUNT }, () => {
      const car = new NpcCar(this, 0, 0, 0)
      this.respawnCar(car)
      return car
    })
    this.ui = new UI(this)
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.keyZ = this.input.keyboard!.addKey('Z')
    this.keyX = this.input.keyboard!.addKey('X')

    this.highScore = Number(localStorage.getItem('highScore') ?? '0')
    if (this.highScore > 0) {
      this.ui.scoreText.setText(`HIGH SCORE\n${this.highScore}`)
      this.ui.title.y = 14
    }
    ;['ONE', 'TWO', 'THREE'].forEach((key, i) => {
      this.input.keyboard!.on(`keydown-${key}`, () => {
        this.timeScale = 1 / 2 ** i
      })
    })

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

  // drop a traffic car onto a random lane centre, somewhere ahead of the
  // player, with a fresh cruising speed and rubber-band personality
  private respawnCar(car: NpcCar) {
    car.z = this.distance + 800 + Math.random() * 1500
    car.laneOffset = ((Math.floor(Math.random() * LANES) + 0.5) / LANES) * 2 - 1
    car.baseSpeed =
      TRAFFIC_MIN_SPEED +
      Math.random() * (TRAFFIC_MAX_SPEED - TRAFFIC_MIN_SPEED)
    car.rubberBand = 0.6 + Math.random() * 0.3
  }

  // box-collide the player with something at (z, lane) moving at objSpeed
  // (0 for static props). Bounce direction comes from the collision normal:
  // the axis with the shallower overlap. Overlap is resolved immediately
  // (snap out) plus a decaying lateral impulse.
  private collide(
    z: number,
    lane: number,
    halfZ: number,
    halfLane: number,
    objSpeed: number,
  ) {
    const dz = z - (this.distance + PLAYER_Z)
    const dLane = this.playerX - lane
    if (Math.abs(dz) >= halfZ || Math.abs(dLane) >= halfLane) return

    const side = dLane >= 0 ? 1 : -1
    const zPen = 1 - Math.abs(dz) / halfZ
    const lanePen = 1 - Math.abs(dLane) / halfLane
    if (lanePen < zPen) {
      // side swipe: shove the player out laterally, mild speed scrub
      this.playerX = lane + side * halfLane
      this.bounceVx = side * 2
      this.speed *= 0.9
    } else if (dz > 0) {
      // hit it head-on: snap just behind, hard speed loss, deflect toward
      // whichever side the player was already offset
      this.distance = z - halfZ - PLAYER_Z
      this.speed = Math.min(this.speed, objSpeed) * 0.5
      this.bounceVx = side * 1.2
    } else {
      // clipped from behind by something faster: shoved forward
      this.speed = Math.max(this.speed, objSpeed)
      this.bounceVx = side * 1.2
    }
    this.cameras.main.shake(120, 0.02)
  }

  startGame = () => {
    if (!this.isGameOver) return

    this.speed = 0
    this.playerX = 0
    this.steerValue = 0
    this.driftDir = 0
    this.gear = 1
    this.bounceVx = 0
    this.distance = 0
    this.timeLeft = RACE_TIME
    this.ui.setTimer(RACE_TIME)
    this.road.reset()
    this.turnSigns.forEach((sign) => sign.destroy())
    this.turnSigns = []
    this.checkpoints.forEach((gantry) => gantry.destroy())
    this.checkpoints = []
    this.nextCheckpointZ = CHECKPOINT_INTERVAL
    this.traffic.forEach((car) => this.respawnCar(car))

    this.isGameOver = false
    // TODO: re-enable music
    // this.music.play()
    this.ui.titleTextTween?.pause()
    this.tweens.add({
      targets: [this.ui.titleText, this.ui.scoreText, this.ui.title],
      alpha: 0,
      duration: 500,
      onComplete: () => {
        this.paused = false
      },
    })
  }

  gameOver = () => {
    this.paused = true
    this.ui.hideHud()
    this.music.pause()

    const score = this.score
    if (score > this.highScore) {
      this.highScore = score
      localStorage.setItem('highScore', String(score))
    }

    this.ui.title.y = 14
    this.ui.scoreText.setText(`HIGH SCORE\n${this.highScore}`)
    this.tweens.add({
      targets: [this.ui.scoreText, this.ui.title, this.ui.titleText],
      alpha: 1,
      duration: 1500,
      onComplete: () => {
        this.ui.titleTextTween?.restart()
        this.isGameOver = true
      },
    })
  }

  update(_time: number, delta: number): void {
    if (this.paused) return

    const dt = (delta / 1000) * this.timeScale
    const offRoad = Math.abs(this.playerX) > 1

    // the clock shows 0 for a full second before the run actually ends
    this.timeLeft -= dt
    if (this.timeLeft <= -1) {
      this.gameOver()
      return
    }
    this.ui.setTimer(Math.max(0, Math.ceil(this.timeLeft)))

    this.updateSteering(dt)
    this.updateDrift()
    this.updateGears()
    this.updateSpeed(dt, offRoad)
    this.ui.setSpeed((this.speed / MAX_SPEED) * TOP_SPEED_MPH)
    // RPM follows an exponential curve of speed against the gear's max:
    // an upshift drops the revs to mid-band, then they surge to redline
    this.ui.setGearHud(
      this.gear,
      Math.pow(this.speed / (GEAR_MAX[this.gear - 1] * MAX_SPEED), RPM_CURVE),
      this.score,
    )
    this.updatePlayerX(dt)
    this.distance += this.speed * dt

    this.road.update(this.distance, this.playerX)
    this.car.draw(this.steerValue, this.steerInput, this.driftDir)

    this.updateTurnSigns()
    this.updateCheckpoints()
    this.updateTraffic(dt)
    this.handleCollisions()
    this.updateOffroadShake(offRoad)
  }

  // tap the brake while fast and turned hard to kick into a drift: the car
  // snaps to full lean and gains speed until the drift direction is
  // released
  private updateDrift() {
    if (this.driftDir !== 0) {
      if (this.steerInput !== this.driftDir) this.driftDir = 0
      return
    }
    if (
      Phaser.Input.Keyboard.JustDown(this.keyX) &&
      this.speed >= DRIFT_MIN_SPEED &&
      Math.abs(this.steerValue) >= DRIFT_MIN_STEER &&
      Math.sign(this.steerValue) === this.steerInput
    ) {
      this.driftDir = this.steerInput
    }
  }

  // gears 1-6: automatic (shift up at redline under throttle, down as
  // speed falls) or instant manual shifts on up/down
  private updateGears() {
    if (AUTO_SHIFT) {
      const gearMax = GEAR_MAX[this.gear - 1] * MAX_SPEED
      if (
        this.gear < 6 &&
        this.speed >= gearMax - 0.5 &&
        (this.keyZ.isDown || this.driftDir !== 0)
      ) {
        this.gear++
      }
      // downshift once speed falls a bit below the lower gear's max — the
      // 0.9 hysteresis keeps it from bouncing between gears
      while (
        this.gear > 1 &&
        this.speed < GEAR_MAX[this.gear - 2] * MAX_SPEED * 0.9
      ) {
        this.gear--
      }
      return
    }

    if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
      this.gear = Math.min(6, this.gear + 1)
    }
    if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
      this.gear = Math.max(1, this.gear - 1)
    }
  }

  private updateSpeed(dt: number, offRoad: boolean) {
    // each gear tops out at its own speed, with low gears accelerating
    // hardest; above the cap (after a downshift) the engine drags speed
    // back down toward it
    const gearMax = GEAR_MAX[this.gear - 1] * MAX_SPEED
    const gearAccel = ACCEL * GEAR_ACCEL[this.gear - 1]
    if (this.speed > gearMax) {
      this.speed = Math.max(gearMax, this.speed - ENGINE_BRAKE * dt)
    } else if (this.driftDir !== 0) {
      // drifting: the boost overrides throttle and brake
      this.speed += DRIFT_ACCEL * (offRoad ? OFFROAD_ACCEL_FACTOR : 1) * dt
      this.speed = Math.min(this.speed, gearMax)
    } else if (this.keyZ.isDown) {
      this.speed += gearAccel * (offRoad ? OFFROAD_ACCEL_FACTOR : 1) * dt
      this.speed = Math.min(this.speed, gearMax)
    } else if (this.keyX.isDown) {
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
  }

  // while held, the wheel covers a fraction of its REMAINING travel each
  // second — quick taps bite immediately, and the growth falls off as it
  // nears full lock. Releasing recenters at a constant rate.
  private updateSteering(dt: number) {
    this.steerInput =
      (this.cursors.left.isDown ? -1 : 0) + (this.cursors.right.isDown ? 1 : 0)
    if (this.steerInput !== 0) {
      this.steerValue +=
        (this.steerInput - this.steerValue) * Math.min(1, STEER_RATE * dt)
    } else {
      const maxStep = STEER_RETURN * dt
      this.steerValue += Phaser.Math.Clamp(-this.steerValue, -maxStep, maxStep)
    }
  }

  // steering and centrifugal pull scale with absolute speed against a fixed
  // reference, so curves push equally hard at a given real speed no matter
  // the top speed. Steering authority is proportional to speed (slow car
  // turns little, parked car not at all) up to a cap so there's no
  // hyper-twitch at max, while the pull is uncapped — every curve has a
  // max speed it can be held at.
  private updatePlayerX(dt: number) {
    const speedFactor = this.speed / REFERENCE_SPEED
    const steerAuthority = Math.min(speedFactor, 1.2)
    this.playerX += this.steerValue * STEER_SPEED * steerAuthority * dt
    // drifting slides with the curve: only a fraction of the pull applies
    this.playerX -=
      this.road.curveAt(this.distance + PLAYER_Z) *
      CENTRIFUGAL *
      (this.driftDir !== 0 ? DRIFT_GRIP : 1) *
      speedFactor *
      dt
    // collision knockback: a decaying lateral shove away from the hit
    this.playerX += this.bounceVx * dt
    this.bounceVx *= Math.max(0, 1 - 6 * dt)
    this.playerX = Phaser.Math.Clamp(this.playerX, -5, 5)
  }

  // spawn a repeated run of chevrons on the outside shoulder just before
  // each big turn the road generator flags; direction picks which way the
  // chevron points and which shoulder it sits on. Signs that fall behind
  // the camera are destroyed.
  private updateTurnSigns() {
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
              maxScale: 1,
              scaleExponent: 0.9,
              sizeFrames: SIGN_SIZE_FRAMES,
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
  }

  // checkpoint gantries appear at fixed track intervals; driving under one
  // adds bonus seconds to the clock
  private updateCheckpoints() {
    if (this.nextCheckpointZ - this.distance < 2000) {
      this.checkpoints.push(new Checkpoint(this, this.nextCheckpointZ))
      this.nextCheckpointZ += CHECKPOINT_INTERVAL
    }
    this.checkpoints = this.checkpoints.filter((gantry) => {
      if (gantry.z < this.distance) {
        this.timeLeft = Math.min(MAX_TIME, this.timeLeft + CHECKPOINT_BONUS)
        this.sound.play('coin-hit', { volume: 0.5 })
        gantry.destroy()
        return false
      }
      gantry.update(this.road)
      return true
    })
  }

  // traffic drives itself; recycle a car onto the road ahead once it falls
  // behind the camera or escapes far beyond the draw distance
  private updateTraffic(dt: number) {
    for (const car of this.traffic) {
      if (car.z < this.distance - 100 || car.z > this.distance + 4000) {
        this.respawnCar(car)
      }
      car.update(this.road, dt, this.speed)
    }
  }

  // collisions: cars and roadside signs both bounce the player
  private handleCollisions() {
    for (const car of this.traffic) {
      this.collide(
        car.z,
        car.laneOffset,
        CAR_COLLIDE_Z,
        CAR_COLLIDE_LANE,
        car.speed,
      )
    }
    for (const sign of this.turnSigns) {
      this.collide(
        sign.z,
        sign.laneOffset,
        SIGN_COLLIDE_Z,
        SIGN_COLLIDE_LANE,
        0,
      )
    }
  }

  // shake the camera while off-road, but only when actually moving fast —
  // ramping in above the threshold, calm once slowed to a crawl
  private updateOffroadShake(offRoad: boolean) {
    if (offRoad && this.speed > OFFROAD_SHAKE_MIN_SPEED) {
      const shake =
        Math.min(1, this.speed / OFFROAD_SHAKE_MIN_SPEED - 1) * OFFROAD_SHAKE
      this.cameras.main.setScroll(
        (Math.random() - 0.5) * shake,
        (Math.random() - 0.5) * shake,
      )
    } else {
      this.cameras.main.setScroll(0, 0)
    }
  }
}

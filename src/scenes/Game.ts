import { Scene, Types } from 'phaser'
import {
  ACCEL,
  BRAKE,
  CAR_COLLIDE_LANE,
  CAR_COLLIDE_Z,
  CENTRIFUGAL,
  COAST_DECEL,
  LANES,
  MAX_SPEED,
  OFFROAD_ACCEL_FACTOR,
  OFFROAD_DECEL,
  OFFROAD_MAX_SPEED,
  OFFROAD_SHAKE,
  OFFROAD_SHAKE_MIN_SPEED,
  PLAYER_Z,
  RACE_TIME,
  REFERENCE_SPEED,
  SIGN_COLLIDE_LANE,
  SIGN_COLLIDE_Z,
  SLOPE_DRAG,
  STEER_RATE,
  STEER_RETURN,
  STEER_SPEED,
  TRAFFIC_COUNT,
  TRAFFIC_MAX_SPEED,
  TRAFFIC_MIN_SPEED,
  TURN_SIGN_GAP,
  TURN_SIGN_LEAD,
  TURN_SIGN_REPEATS,
} from '../constants'
import { Car } from '../entities/Car'
import { NpcCar } from '../entities/NpcCar'
import { Road } from '../entities/Road'
import { RoadObject } from '../entities/RoadObject'
import { UI } from '../entities/UI'

// turn-sign.png layout: 8 frames, largest first, each 2px narrower than
// the last — pre-drawn distance sizes so signs never scale-distort
const SIGN_SIZE_FRAMES = Array.from({ length: 8 }, (_, i) => ({
  frame: i,
  width: 16 - i * 2,
}))

export class Game extends Scene {
  public ui!: UI
  public music: Phaser.Sound.BaseSound
  private cursors!: Types.Input.Keyboard.CursorKeys
  private keyZ!: Phaser.Input.Keyboard.Key
  private road!: Road
  private car!: Car
  private turnSigns: RoadObject[] = []
  private traffic: NpcCar[] = []
  private speed = 0
  private playerX = 0 // -1..1 = on road, beyond that = grass
  private steerValue = 0 // wheel position, -1 (full left) .. 1 (full right)
  private bounceVx = 0 // lateral knockback from collisions, decays quickly
  private distance = 0
  private timeLeft = RACE_TIME
  private paused = true
  private isGameOver = true
  private highScore = 0

  constructor() {
    super('Game')
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

    this.highScore = Number(localStorage.getItem('highScore') ?? '0')
    if (this.highScore > 0) {
      this.ui.scoreText.setText(`HIGH SCORE\n${this.highScore}`)
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
    this.bounceVx = 0
    this.distance = 0
    this.timeLeft = RACE_TIME
    this.ui.setTimer(RACE_TIME)
    this.road.reset()
    this.turnSigns.forEach((sign) => sign.destroy())
    this.turnSigns = []
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
    this.ui.hideTimer()
    this.music.pause()

    const score = Math.floor(this.distance / 10)
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

    const dt = delta / 1000
    const offRoad = Math.abs(this.playerX) > 1

    this.timeLeft -= dt
    if (this.timeLeft <= 0) {
      this.gameOver()
      return
    }
    this.ui.setTimer(Math.ceil(this.timeLeft))

    this.updateSpeed(dt, offRoad)
    this.updateSteering(dt)
    this.updatePlayerX(dt)
    this.distance += this.speed * dt

    this.road.update(this.distance, this.playerX)
    this.car.draw(this.steerValue)

    this.updateTurnSigns()
    this.updateTraffic(dt)
    this.handleCollisions()
    this.updateOffroadShake(offRoad)
  }

  private updateSpeed(dt: number, offRoad: boolean) {
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
  }

  // wheel moves linearly toward the held direction and recenters faster
  // when released
  private updateSteering(dt: number) {
    const steerTarget =
      (this.cursors.left.isDown ? -1 : 0) + (this.cursors.right.isDown ? 1 : 0)
    const maxStep = (steerTarget !== 0 ? STEER_RATE : STEER_RETURN) * dt
    this.steerValue += Phaser.Math.Clamp(
      steerTarget - this.steerValue,
      -maxStep,
      maxStep,
    )
  }

  // steering and centrifugal pull scale with absolute speed against a fixed
  // reference, so curves push equally hard at a given real speed no matter
  // the top speed. Steering authority is clamped (floor: recovering from
  // grass isn't tedious; cap: no hyper-twitch at max), while the pull is
  // uncapped — every curve has a max speed it can be held at.
  private updatePlayerX(dt: number) {
    const speedFactor = this.speed / REFERENCE_SPEED
    const steerAuthority =
      this.speed > 0 ? Phaser.Math.Clamp(speedFactor, 0.35, 1.2) : 0
    this.playerX += this.steerValue * STEER_SPEED * steerAuthority * dt
    this.playerX -=
      this.road.curveAt(this.distance + PLAYER_Z) *
      CENTRIFUGAL *
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
              scaleExponent: 0.8,
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

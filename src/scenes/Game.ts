import { Scene, Types } from 'phaser'
import {
  ACCEL,
  AUTO_SHIFT,
  BRAKE,
  BURN_DPS,
  BURN_THRESHOLD,
  BURNOUT_SHAKE,
  CAMERA_DEPTH,
  CAMERA_HEIGHT,
  CAR_COLLIDE_Z,
  CENTRIFUGAL,
  CHECKPOINT_BONUS,
  CHECKPOINT_INTERVAL,
  CHECKPOINT_REPAIR,
  COAST_DECEL,
  COIN_COLLIDE_LANE,
  COIN_COLLIDE_Z,
  COIN_GAP,
  COIN_INTERVAL,
  COIN_POINTS,
  COIN_ROW_COUNT,
  COLLISION_DAMAGE,
  DAMAGE_COOLDOWN,
  DRAW_SEGMENTS,
  DRIFT_ACCEL,
  DRIFT_COUNTERSTEER_TIME,
  DRIFT_GRIP,
  DRIFT_MAX_TIME,
  DRIFT_MIN_SPEED,
  DRIFT_MIN_STEER,
  DRIFT_RELEASE_TIME,
  ENGINE_BRAKE,
  GAME_HEIGHT,
  GEAR_ACCEL,
  GEAR_MAX,
  HORIZON_Y,
  IMPACT_SKID_TIME,
  LANE_SCALE,
  LANES,
  MAX_HEALTH,
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
  SEGMENT_LENGTH,
  SIGN_COLLIDE_LANE,
  SIGN_COLLIDE_Z,
  SKIP_COUNTDOWN,
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
import { Coin } from '../entities/Coin'
import { NpcCar, VEHICLES } from '../entities/NpcCar'
import { Road } from '../entities/Road'
import { RoadObject } from '../entities/RoadObject'
import { Scenery } from '../entities/Scenery'
import { SkidMarks } from '../entities/SkidMarks'
import { UI } from '../entities/UI'

// turn-sign.png layout: 9 frames, largest first, each 2px narrower than
// the last down to a final 1px sliver — pre-drawn distance sizes so signs
// never scale-distort
const SIGN_SIZE_FRAMES = Array.from({ length: 9 }, (_, i) => ({
  frame: i,
  width: Math.max(1, 16 - i * 2),
}))

// the camera's fixed pace along the road while the menu is up (a second
// start press skips the drive-in and jumps straight to the run start)
const MENU_DRIVE_SPEED = 400
// how quickly the cruise pace ramps up, and the constant deceleration of
// its brake into the run-start straightaway
const MENU_DRIVE_ACCEL = 300
const MENU_BRAKE_DECEL = 900

// traffic car-following: an NPC closing on a slower one in its lane
// matches its speed once within this many world units, instead of
// driving through it (also the spacing respawns keep clear)
const FOLLOW_GAP = 60

export class Game extends Scene {
  public ui!: UI
  public music: Phaser.Sound.BaseSound
  private cursors!: Types.Input.Keyboard.CursorKeys
  private keyZ!: Phaser.Input.Keyboard.Key
  private keyX!: Phaser.Input.Keyboard.Key
  private keyC!: Phaser.Input.Keyboard.Key
  private road!: Road
  private car!: Car
  private skidMarks!: SkidMarks
  private scenery!: Scenery
  private turnSigns: RoadObject[] = []
  private checkpoints: Checkpoint[] = []
  private nextCheckpointZ = CHECKPOINT_INTERVAL
  private coins: Coin[] = []
  private nextCoinZ = 0
  private coinScore = 0 // points banked from coins this run
  private traffic: NpcCar[] = []
  private speed = 0
  private playerX = 0 // -1..1 = on road, beyond that = grass
  private steerValue = 0 // wheel position, -1 (full left) .. 1 (full right)
  private steerInput = 0 // raw held direction this frame: -1, 0, or 1
  private driftDir = 0 // -1/1 while drifting in that direction, 0 otherwise
  private driftReleaseTime = 0 // seconds since the drift direction was held
  private driftCounterTime = 0 // seconds the opposite direction has been held
  private driftTime = 0 // seconds the current drift has been running
  private gear = 1 // current gear, 1-6
  private timeScale = 1 // debug slow-motion factor (keys 1-5)
  private bounceVx = 0 // lateral knockback from collisions, decays quickly
  private distance = 0
  private timeLeft = RACE_TIME
  private outOfTime = false // clock at 0: controls cut, car coasting
  private health = MAX_HEALTH
  private damageCooldown = 0 // seconds of post-hit invulnerability left
  private impactSkidTime = 0 // seconds of post-hit tire scrub left
  private paused = true
  private isGameOver = true
  private menuCruising = false // camera rolling along the road at the menu
  private startPending = false // start pressed: cruising to the aligned straight
  private menuTarget = 0 // z where the pre-run straightaway begins
  private cruisePace = MENU_DRIVE_SPEED // stateful, so speed never steps
  private runStartDistance = 0 // the score counts from here
  private highScore = 0

  constructor() {
    super('Game')
  }

  private get score() {
    return Phaser.Math.Clamp(
      Math.floor((this.distance - this.runStartDistance) / 1000) +
        this.coinScore,
      0,
      MAX_SCORE,
    )
  }

  create(): void {
    this.cameras.main.fadeFrom(500, 0, 0, 0)
    this.music = this.sound.add('music', { loop: true, volume: 0.3 })
    this.music.pause()

    // a struck motorcycle tips over and slides out, holding its final
    // wrecked frame until it scrolls behind the camera
    this.anims.create({
      key: 'motorcycle-fall',
      frames: this.anims.generateFrameNumbers('motorcycle-fall'),
      frameRate: 14,
    })

    this.road = new Road(this)
    this.scenery = new Scenery(this)
    this.skidMarks = new SkidMarks(this)
    this.car = new Car(this)
    this.road.onWorldTint = (tint) => this.car.setDayTint(tint)
    this.car.park()
    this.traffic = Array.from({ length: TRAFFIC_COUNT }, () => {
      const car = new NpcCar(this, 0, 0, 0)
      this.respawnCar(car)
      return car
    })
    this.ui = new UI(this)
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.keyZ = this.input.keyboard!.addKey('Z')
    this.keyX = this.input.keyboard!.addKey('X')
    this.keyC = this.input.keyboard!.addKey('C')

    this.highScore = Number(localStorage.getItem('highScore') ?? '0')
    if (this.highScore > 0) {
      this.ui.scoreText.setText(`HIGH SCORE\n${this.highScore}`)
    }
    ;['Q', 'W', 'E', 'R', 'T'].forEach((key, i) => {
      if (i === 0)
        this.input.keyboard!.on(`keydown-${key}`, () => {
          this.timeScale = 0.1
        })
      if (i === 1)
        this.input.keyboard!.on(`keydown-${key}`, () => {
          this.timeScale = 0.5
        })
      if (i === 2)
        this.input.keyboard!.on(`keydown-${key}`, () => {
          this.timeScale = 1
        })
      if (i === 3)
        this.input.keyboard!.on(`keydown-${key}`, () => {
          this.timeScale = 2
        })
      if (i === 4)
        this.input.keyboard!.on(`keydown-${key}`, () => {
          this.timeScale = 8
        })
    })

    // debug: take a hit on demand
    this.input.keyboard!.on('keydown-V', () => {
      this.takeDamage(this.speed)
    })

    // debug: set the clock to 15 seconds
    this.input.keyboard!.on('keydown-B', () => {
      this.timeLeft = 15
    })

    // debug: 1-4 drops a specific vehicle type onto the road ahead by
    // repurposing whichever traffic car is farthest from the player
    ;['ONE', 'TWO', 'THREE', 'FOUR'].forEach((key, i) => {
      this.input.keyboard!.on(`keydown-${key}`, () => {
        const spec = VEHICLES[i]
        if (!spec) return
        let car = this.traffic[0]
        for (const other of this.traffic) {
          if (
            Math.abs(other.z - this.distance) > Math.abs(car.z - this.distance)
          ) {
            car = other
          }
        }
        car.setVehicle(spec)
        car.z = this.distance + 500
        car.laneOffset =
          ((Math.floor(Math.random() * LANES) + 0.5) / LANES) * 2 - 1
        car.baseSpeed = TRAFFIC_MIN_SPEED
        car.speed = TRAFFIC_MIN_SPEED
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
      const key = e.key.toLowerCase()
      if (!e.key.includes('Arrow') && key !== 'z' && key !== 'x') return
      this.startGame()
    })

    // the menu opens over a road already rolling by
    this.menuCruising = true
  }

  // drop a traffic car onto a random lane centre, somewhere ahead of the
  // player, with a fresh cruising speed and rubber-band personality; the
  // spot is re-rolled if it lands on top of another NPC's lane slot
  private respawnCar(car: NpcCar) {
    for (let tries = 0; tries < 6; tries++) {
      car.z = this.distance + 800 + Math.random() * 1500
      car.laneOffset =
        ((Math.floor(Math.random() * LANES) + 0.5) / LANES) * 2 - 1
      if (!this.laneBlocked(car, FOLLOW_GAP * 2)) break
    }
    // it respawns beyond the horizon, so it can come back as anything
    car.randomizeVehicle()
    car.baseSpeed =
      TRAFFIC_MIN_SPEED +
      Math.random() * (TRAFFIC_MAX_SPEED - TRAFFIC_MIN_SPEED)
    car.rubberBand = 0.6 + Math.random() * 0.3
  }

  // is another NPC within `gap` (either direction) of this one's lane slot?
  private laneBlocked(car: NpcCar, gap: number): boolean {
    return this.traffic.some(
      (other) =>
        other !== car &&
        Math.abs(other.laneOffset - car.laneOffset) < 0.1 &&
        Math.abs(other.z - car.z) < gap,
    )
  }

  // the speed of the slower NPC this one is about to rear-end in its own
  // lane, or Infinity when the road ahead is clear — NPCs hold their
  // lane, so the follower matches pace instead of driving through
  private followCap(car: NpcCar): number {
    let cap = Infinity
    for (const other of this.traffic) {
      if (other === car) continue
      if (Math.abs(other.laneOffset - car.laneOffset) > 0.1) continue
      const dz = other.z - car.z
      if (dz > 0 && dz < FOLLOW_GAP) cap = Math.min(cap, other.speed)
    }
    return cap
  }

  // box-collide the player with something at (z, lane) moving at objSpeed
  // (0 for static props). Bounce direction comes from the collision normal:
  // the axis with the shallower overlap. Overlap is resolved immediately
  // (snap out) plus a decaying lateral impulse. Returns which side of the
  // object the player was on (-1/1), or null for no contact
  private collide(
    z: number,
    lane: number,
    halfZ: number,
    halfLane: number,
    objSpeed: number,
    // scales the health cost of this hit (heavy vehicles hurt more)
    damageFactor = 1,
  ): number | null {
    const dz = z - (this.distance + PLAYER_Z)
    const dLane = this.playerX - lane
    if (Math.abs(dz) >= halfZ || Math.abs(dLane) >= halfLane) return null

    // any impact breaks a drift and sets the tires scrubbing for a beat
    this.driftDir = 0
    this.impactSkidTime = IMPACT_SKID_TIME

    const side = dLane >= 0 ? 1 : -1
    const zPen = 1 - Math.abs(dz) / halfZ
    const lanePen = 1 - Math.abs(dLane) / halfLane
    if (lanePen < zPen) {
      // side swipe: shove the player out laterally, mild speed scrub
      this.playerX = lane + side * halfLane
      this.bounceVx = side * 2
      this.takeDamage(this.speed * 0.5, damageFactor)
      this.speed *= 0.9
    } else if (dz > 0) {
      // hit it head-on: snap just behind, hard speed loss, deflect toward
      // whichever side the player was already offset
      this.distance = z - halfZ - PLAYER_Z
      this.takeDamage(Math.max(0, this.speed - objSpeed) * 2, damageFactor)
      this.speed = Math.min(this.speed, objSpeed) * 0.5
      this.bounceVx = side * 1.2
    } else {
      // clipped from behind by something faster: shoved forward
      this.takeDamage(Math.max(0, objSpeed - this.speed), damageFactor)
      this.speed = Math.max(this.speed, objSpeed)
      this.bounceVx = side * 1.2
    }
    this.car.jolt()
    return side
  }

  // impact speed -> health loss: a hit at MAX_SPEED relative speed costs
  // COLLISION_DAMAGE. At zero health the car explodes and the run ends.
  // factor scales the final cost (after the minimum-impact floor, so a
  // soft target stays cheap even on low-speed clips)
  private takeDamage(_impactSpeed: number, factor = 1) {
    const impactSpeed = Math.max(75, _impactSpeed * 0.5) * factor
    if (
      this.paused ||
      this.health <= 0 ||
      impactSpeed <= 0 ||
      this.damageCooldown > 0
    ) {
      return
    }
    this.damageCooldown = DAMAGE_COOLDOWN
    this.health = Math.max(
      0,
      this.health - (impactSpeed / MAX_SPEED) * COLLISION_DAMAGE,
    )
    this.car.setHealth(this.health)
    this.car.onDamage()
    console.log(
      `damage taken: ${impactSpeed.toFixed(1)} impact, health now ${this.health.toFixed()}`,
    )
    if (this.health <= 0) this.die()
  }

  // freeze the world while the explosion plays, then show the menu
  private die() {
    this.paused = true
    this.car.explode(this.gameOver)
  }

  // start pressed at the menu: hide the UI and lay a straightaway just
  // past the horizon — the cruise keeps rolling until the camera is in
  // it (aligned with the first-boot view), then beginRun() takes over
  startGame = () => {
    if (!this.isGameOver || !this.menuCruising) return
    if (this.startPending) {
      // pressing again skips ahead: teleport 95% of the way there and
      // let the cruise's brake ease out the last stretch
      this.distance += (this.menuTarget - this.distance) * 0.85
      return
    }
    this.startPending = true

    this.ui.cancelMenu()
    this.tweens.add({
      targets: [this.ui.titleText, this.ui.scoreText, this.ui.title],
      alpha: 0,
      duration: 500,
    })

    this.menuTarget = this.road.straightenAhead()
    // clear the road: whisk all traffic out past the horizon, spread
    // ahead of the run start — anything visible vanishes immediately
    for (const car of this.traffic) {
      this.respawnCar(car)
      car.z += this.menuTarget - this.distance
    }
    // the sunrise roll is timed to the default approach pace; a hurried
    // approach just parks a little before the sky finishes settling
    this.road.resetDayCycle(
      ((this.menuTarget - this.distance) / MENU_DRIVE_SPEED) * 1000,
    )
    // signs pointing at turns that were just cut away would float over
    // the straight road as we pass them
    const cutoff = this.distance + DRAW_SEGMENTS * SEGMENT_LENGTH
    this.turnSigns = this.turnSigns.filter((sign) => {
      if (sign.z < cutoff) return true
      sign.destroy()
      return false
    })
  }

  // the camera has parked in the straightaway: reset the run state and
  // play the intro (car drives in, countdown), continuing from this spot
  private beginRun() {
    this.speed = 0
    this.playerX = 0
    this.steerValue = 0
    this.driftDir = 0
    this.gear = 1
    this.bounceVx = 0
    this.health = MAX_HEALTH
    this.damageCooldown = 0
    this.impactSkidTime = 0
    this.car.reset()
    this.timeLeft = RACE_TIME
    this.outOfTime = false
    this.ui.setTimer(RACE_TIME)
    this.runStartDistance = this.distance
    this.nextCheckpointZ = this.distance + CHECKPOINT_INTERVAL
    this.checkpoints.forEach((gantry) => gantry.destroy())
    this.checkpoints = []
    this.coinScore = 0
    this.nextCoinZ = this.distance + COIN_INTERVAL
    this.coins.forEach((coin) => coin.destroy())
    this.coins = []

    this.isGameOver = false
    // TODO: re-enable music
    // this.music.play()
    // the whole HUD fades in with fresh values while the car drives in
    this.ui.setSpeed(0)
    this.ui.setGearHud(1, 0, 0)
    this.ui.showHud()

    // the car drives in from below the frame and brakes into its starting
    // spot, then the 3-2-1 countdown runs; the clock and controls only
    // come alive once it finishes
    this.car.enter(
      () => {
        if (SKIP_COUNTDOWN) {
          this.paused = false
          return
        }
        this.ui.countdown(() => {
          this.paused = false
        })
      },
      (wheelY) => {
        // the world is frozen during the entrance, so map the wheels'
        // screen row back to a world depth on the flat straightaway —
        // the marks land under the car and scroll away once it's driving
        const scale = (wheelY - HORIZON_Y) / (CAMERA_HEIGHT * (GAME_HEIGHT / 2))
        if (scale <= 0) return
        this.skidMarks.add(this.distance + CAMERA_DEPTH / scale, this.playerX)
        this.skidMarks.update(this.road, this.distance)
      },
    )
  }

  gameOver = () => {
    this.paused = true
    this.ui.hideHud()
    this.car.exit()
    this.music.pause()

    const score = this.score
    if (score > this.highScore) {
      this.highScore = score
      localStorage.setItem('highScore', String(score))
    }

    this.ui.playTitleAnimation()
    this.ui.scoreText.setText(`HIGH SCORE\n${this.highScore}`)
    this.tweens.add({
      targets: [this.ui.title],
      alpha: 1,
      duration: 1500,
    })

    // after a beat, the camera pulls back onto the road and the menu
    // cruise resumes; start is accepted from then on
    this.time.delayedCall(1000, () => {
      this.isGameOver = true
      this.menuCruising = true
    })
  }

  // the menu backdrop: roll along the endless road at a fixed pace,
  // easing back to the centre lane. After start is pressed this keeps
  // going until the camera reaches the aligned straightaway, clamps onto
  // it exactly (band phase, lane — the first-boot view), and hands off
  private updateMenuCruise(dt: number) {
    // ramp toward the desired pace instead of stepping to it
    let pace = Math.min(
      this.cruisePace + MENU_DRIVE_ACCEL * dt,
      MENU_DRIVE_SPEED,
    )
    if (this.startPending) {
      // constant-deceleration brake: hold the speed that stops exactly at
      // the target — one long smooth squeeze, no kink at the end (the
      // small floor covers the last half-pixel)
      const remaining = Math.max(0, this.menuTarget - this.distance)
      pace = Math.min(
        pace,
        Math.max(30, Math.sqrt(2 * MENU_BRAKE_DECEL * remaining)),
      )
    }
    this.cruisePace = pace
    this.distance += pace * dt
    const arrived = this.startPending && this.distance >= this.menuTarget
    if (arrived) {
      this.distance = this.menuTarget
      this.playerX = 0
    } else {
      this.playerX += (0 - this.playerX) * Math.min(1, 2 * dt)
    }
    this.road.update(this.distance, this.playerX, dt)
    this.skidMarks.update(this.road, this.distance)
    this.scenery.update(this.road, this.distance)
    // spawns signs for freshly generated turns and culls passed ones
    this.updateTurnSigns()
    // leftover gantries scroll by without paying out their bonus
    this.checkpoints = this.checkpoints.filter((gantry) => {
      if (gantry.z < this.distance) {
        gantry.destroy()
        return false
      }
      gantry.update(this.road)
      return true
    })
    // leftover coins scroll by too — the camera isn't the car, so
    // nothing gets collected
    this.scrollCoins(false)
    for (const car of this.traffic) {
      if (car.z < this.distance - 100 || car.z > this.distance + 4000) {
        this.respawnCar(car)
      }
      car.update(this.road, dt, MENU_DRIVE_SPEED, this.followCap(car))
    }
    if (arrived) {
      this.menuCruising = false
      this.startPending = false
      this.beginRun()
    }
  }

  update(_time: number, delta: number): void {
    if (this.menuCruising) {
      this.updateMenuCruise((delta / 1000) * this.timeScale)
      return
    }
    if (this.paused) return

    const dt = (delta / 1000) * this.timeScale
    const offRoad = Math.abs(this.playerX) > 1
    this.damageCooldown = Math.max(0, this.damageCooldown - dt)
    this.impactSkidTime = Math.max(0, this.impactSkidTime - dt)

    // on fire: health bleeds away and the car can burn out completely
    if (this.health < BURN_THRESHOLD) {
      this.health = Math.max(0, this.health - BURN_DPS * dt)
      this.car.setHealth(this.health)
      if (this.health <= 0) {
        this.die()
        return
      }
    }

    // out of time: the clock floors at 0 and the controls cut out — the
    // car just coasts. Rolling through a checkpoint refunds time (and
    // with it control); coming to a stop ends the run
    this.timeLeft = Math.max(0, this.timeLeft - dt)
    this.outOfTime = this.timeLeft <= 0
    if (this.outOfTime && this.speed <= 0) {
      this.gameOver()
      return
    }
    this.ui.setTimer(Math.ceil(this.timeLeft))

    this.updateSteering(dt)
    this.updateDrift(dt)
    this.updateGears()
    this.updateSpeed(dt, offRoad)
    const mph = (this.speed / MAX_SPEED) * TOP_SPEED_MPH
    this.ui.setSpeed(mph)

    // tire puffs: spinning the wheels off the line (throttle under
    // 25 mph), or scrubbing speed off under braking — smoke on tarmac,
    // dirt when off in the grass
    const throttle = !this.outOfTime && (this.keyZ.isDown || this.keyX.isDown)
    const braking = !this.outOfTime && this.keyC.isDown && this.speed > 30
    const tiresSmoking =
      (throttle && mph < 25 && mph > 1) ||
      braking ||
      this.driftDir !== 0 ||
      this.car.isUnwinding() ||
      this.impactSkidTime > 0
    const wheelsSpinning = tiresSmoking || (offRoad && mph > 0)
    if (wheelsSpinning) this.car.emitTireSmoke(offRoad)
    // taillights light up whenever the brake is held
    this.car.setBraking(!this.outOfTime && this.keyC.isDown)
    // RPM follows an exponential curve of speed against the gear's max:
    // an upshift drops the revs to mid-band, then they surge to redline
    this.ui.setGearHud(
      this.gear,
      Math.pow(this.speed / (GEAR_MAX[this.gear - 1] * MAX_SPEED), RPM_CURVE),
      this.score,
    )
    this.updatePlayerX(dt)
    this.distance += this.speed * dt

    this.road.update(this.distance, this.playerX, dt)
    // the tires always leave a trail: barely-there while rolling, dark
    // skid strips while spinning. Stamped after the distance advance so
    // the newest mark sits exactly under the car, not a frame behind
    if (this.speed > 0) {
      this.skidMarks.add(
        this.distance + PLAYER_Z,
        this.playerX,
        offRoad,
        wheelsSpinning,
        this.steerValue,
        this.driftDir,
      )
    }
    this.skidMarks.update(this.road, this.distance)
    const rolling = this.speed > 0
    this.car.draw(
      rolling ? this.steerValue : 0,
      rolling ? this.steerInput : 0,
      this.driftDir,
      throttle && mph < 25 && !offRoad,
    )

    this.scenery.update(this.road, this.distance)
    this.updateTurnSigns()
    this.updateCheckpoints()
    this.updateCoins()
    this.updateTraffic(dt)
    this.handleCollisions()
    this.updateCarShake(offRoad, tiresSmoking)
  }

  // tap the brake while fast and turned hard to kick into a drift: the car
  // snaps to full lean and gains speed until the drift direction is
  // released
  private updateDrift(dt: number) {
    if (this.driftDir !== 0) {
      // taps of countersteer are tolerated — holding the opposite
      // direction long enough ends the drift; so does going too long
      // without pressing the drift direction at all; and no drift
      // outlasts the hard time cap
      this.driftTime += dt
      this.driftCounterTime =
        this.steerInput === -this.driftDir ? this.driftCounterTime + dt : 0
      this.driftReleaseTime =
        this.steerInput === this.driftDir ? 0 : this.driftReleaseTime + dt
      if (
        this.driftTime >= DRIFT_MAX_TIME ||
        this.driftCounterTime >= DRIFT_COUNTERSTEER_TIME ||
        this.driftReleaseTime >= DRIFT_RELEASE_TIME
      ) {
        this.driftDir = 0
      }
      return
    }
    this.driftReleaseTime = 0
    this.driftCounterTime = 0
    if (
      !this.outOfTime &&
      Phaser.Input.Keyboard.JustDown(this.keyC) &&
      this.speed >= DRIFT_MIN_SPEED &&
      Math.abs(this.steerValue) >= DRIFT_MIN_STEER &&
      Math.sign(this.steerValue) === this.steerInput
    ) {
      this.driftDir = this.steerInput
      this.driftTime = 0
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
        (this.keyZ.isDown || this.keyX.isDown || this.driftDir !== 0)
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
    } else {
      const throttle = !this.outOfTime && (this.keyZ.isDown || this.keyX.isDown)
      const brake = !this.outOfTime && this.keyC.isDown
      if (throttle || brake) {
        // throttle and brake are independent forces, so dragging the
        // brake while accelerating nets out to losing speed — the brake
        // is far stronger than any gear's pull
        if (throttle) {
          this.speed += gearAccel * (offRoad ? OFFROAD_ACCEL_FACTOR : 1) * dt
          this.speed = Math.min(this.speed, gearMax)
        }
        if (brake) this.speed -= BRAKE * dt
      } else {
        this.speed -= COAST_DECEL * dt
      }
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
    this.steerInput = this.outOfTime
      ? 0
      : (this.cursors.left.isDown ? -1 : 0) +
        (this.cursors.right.isDown ? 1 : 0)
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
    // every lateral force is scaled by LANE_SCALE: playerX is a fraction
    // of the road's half-width, so without it a wider road would make the
    // same physical motion cover more ground
    this.playerX +=
      this.steerValue * STEER_SPEED * steerAuthority * LANE_SCALE * dt
    // drifting slides with the curve: only a fraction of the pull applies
    this.playerX -=
      this.road.curveAt(this.distance + PLAYER_Z) *
      CENTRIFUGAL *
      (this.driftDir !== 0 ? DRIFT_GRIP : 1) *
      speedFactor *
      LANE_SCALE *
      dt
    // collision knockback: a decaying lateral shove away from the hit
    this.playerX += this.bounceVx * LANE_SCALE * dt
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
        this.health = Math.min(MAX_HEALTH, this.health + CHECKPOINT_REPAIR)
        this.car.setHealth(this.health)
        this.sound.play('coin-hit', { volume: 0.5 })
        gantry.destroy()
        return false
      }
      gantry.update(this.road)
      return true
    })
  }

  // coin rows appear over a random lane at fixed track intervals; driving
  // through a coin banks its points onto the score
  private updateCoins() {
    if (this.nextCoinZ - this.distance < 2000) {
      const lane = ((Math.floor(Math.random() * LANES) + 0.5) / LANES) * 2 - 1
      for (let i = 0; i < COIN_ROW_COUNT; i++) {
        this.coins.push(new Coin(this, this.nextCoinZ + i * COIN_GAP, lane))
      }
      this.nextCoinZ += COIN_INTERVAL
    }
    this.scrollCoins(true)
  }

  // cull coins that fall behind the camera, collect any the car is
  // touching (skipped during the menu cruise), and animate the rest
  private scrollCoins(collect: boolean) {
    this.coins = this.coins.filter((coin) => {
      if (coin.z < this.distance) {
        coin.destroy()
        return false
      }
      if (
        collect &&
        Math.abs(coin.z - (this.distance + PLAYER_Z)) < COIN_COLLIDE_Z &&
        Math.abs(this.playerX - coin.laneOffset) < COIN_COLLIDE_LANE
      ) {
        this.coinScore += COIN_POINTS
        this.sound.play('coin-hit', { volume: 0.5 })
        this.car.emitCoin()
        coin.destroy()
        return false
      }
      coin.update(this.road)
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
      car.update(this.road, dt, this.speed, this.followCap(car))
    }
  }

  // collisions: cars and roadside signs both bounce the player
  private handleCollisions() {
    for (const car of this.traffic) {
      // a downed bike lies flat — nothing left to hit
      if (car.fallen) continue
      const side = this.collide(
        car.z,
        car.laneOffset,
        CAR_COLLIDE_Z,
        car.collideLane,
        car.speed,
        car.damageFactor,
      )
      // knocking over a motorcycle: it goes down where it was struck,
      // toppling away from the player and carried on by the impact
      if (side !== null && car.vehicle.texture === 'motorcycle') {
        car.fall(-side, this.speed)
      }
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
    // solid scenery (tree trunks) hits like the static signs do
    this.scenery.forEachCollider((z, lane, halfZ, halfLane) => {
      this.collide(z, lane, halfZ, halfLane, 0)
    })
  }

  // rattle the car (not the camera) while off-road at speed — ramping in
  // above the threshold, calm once slowed to a crawl — or while the
  // tires are smoking under a burnout or hard braking
  private updateCarShake(offRoad: boolean, tiresSmoking: boolean) {
    let shake = 0
    if (offRoad && this.speed > OFFROAD_SHAKE_MIN_SPEED) {
      shake =
        Math.min(1, this.speed / OFFROAD_SHAKE_MIN_SPEED - 1) * OFFROAD_SHAKE
    }
    if (tiresSmoking) shake = Math.max(shake, BURNOUT_SHAKE)
    this.car.setShake(shake)
  }
}

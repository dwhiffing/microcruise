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
  CAR_COLLIDE_LANE,
  CAR_COLLIDE_Z,
  CENTRIFUGAL,
  CHECKPOINT_BONUS,
  CHECKPOINT_REPAIR,
  CHECKPOINTS_PER_LEVEL,
  COAST_DECEL,
  COIN_COLLIDE_LANE,
  COIN_COLLIDE_Z,
  COLLIDE_CLEARANCE,
  COLLISION_DAMAGE,
  DAMAGE_COOLDOWN,
  DEBUG_KEYS,
  DRAW_SEGMENTS,
  DRIFT_ACCEL_FACTOR,
  DRIFT_COUNTERSTEER_TIME,
  DRIFT_GRIP,
  DRIFT_MAX_TIME,
  DRIFT_MIN_SPEED,
  DRIFT_MIN_STEER,
  DRIFT_RELEASE_TIME,
  ENGINE_BRAKE,
  ENGINE_RATE_MAX,
  ENGINE_RATE_MIN,
  ENGINE_VOLUME,
  GAME_HEIGHT,
  GEAR_ACCEL,
  GEAR_MAX,
  HORIZON_Y,
  IMPACT_SKID_TIME,
  LANES,
  LEVELS,
  MAX_HEALTH,
  MAX_SCORE,
  MAX_SPEED,
  MAX_TIME,
  NITRO_ACCEL_FACTOR,
  NITRO_LIFT,
  NITRO_LIFT_RATE,
  NITRO_MAX_MS,
  NITRO_PER_COIN_MS,
  NITRO_SHAKE,
  NITRO_VOLUME,
  OFFROAD_ACCEL_FACTOR,
  OFFROAD_DECEL,
  OFFROAD_MAX_SPEED,
  OFFROAD_SHAKE,
  OFFROAD_SHAKE_MIN_SPEED,
  OUT_OF_TIME_DECEL_FACTOR,
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
import { SpeedLines } from '../entities/SpeedLines'
import { UI } from '../entities/UI'
import { laneScale, world } from '../world'

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
const DRIFT_SOUND_VOLUME = 0.9
const BRAKE_SOUND_RATE = 0.85
const ENTER_BRAKE_MS = 80
// the transmission picker ignores input for this long after opening, so
// the press that opened it (or a quick double-tap) can't instantly
// toggle or confirm
const GEAR_MENU_INPUT_DELAY_MS = 400
const COIN_RATE_EMPTY = 1
const COIN_RATE_FULL = 2

// traffic car-following: an NPC closing on a slower one in its lane
// matches its speed once within this many world units, instead of
// driving through it (also the spacing respawns keep clear)
const FOLLOW_GAP = 60
// an overtaker starts its dodge around the player once it's within this
// many world units behind them
const OVERTAKE_GAP = 250
// every so often a car drifts to another lane on its own, like real
// traffic — each waits a random 4-9s between changes
const LANE_WANDER_MIN_S = 4
const LANE_WANDER_MAX_S = 9

export class Game extends Scene {
  public ui!: UI
  public music: Phaser.Sound.BaseSound
  // the engine loop: pitch rides the same RPM value the tach shows
  private engineSound!: Phaser.Sound.WebAudioSound
  // the nitro whoosh: plays on engage, fades out on release
  private nitroSound!: Phaser.Sound.WebAudioSound
  private nitroSoundOn = false
  // the drift screech: attack marker once, sustain marker looping
  private driftSound!: Phaser.Sound.WebAudioSound
  private driftSoundOn = false
  // the brake chirp: its own instance of the screech, so it can be cut
  // early once the car has shed its speed
  private brakeSound!: Phaser.Sound.WebAudioSound
  private wasChirping = false // for the once-per-event brake/launch chirp
  // the ignition turn-over: its completion cues the engine loop
  private ignitionSound!: Phaser.Sound.WebAudioSound
  private cursors!: Types.Input.Keyboard.CursorKeys
  private keyZ!: Phaser.Input.Keyboard.Key
  private keyX!: Phaser.Input.Keyboard.Key
  private keyC!: Phaser.Input.Keyboard.Key
  private road!: Road
  private car!: Car
  private skidMarks!: SkidMarks
  private scenery!: Scenery
  private speedLines!: SpeedLines
  private turnSigns: RoadObject[] = []
  private checkpoints: Checkpoint[] = []
  private nextCheckpointZ = LEVELS[0].checkpointInterval
  private checkpointInterval = LEVELS[0].checkpointInterval
  private checkpointsCrossed = 0 // this run; every 5th advances the level
  private level = 0 // index into LEVELS
  private coins: Coin[] = []
  private nextCoinZ = 0
  private traffic: NpcCar[] = []
  private speed = 0
  private nitroMs = 0 // remaining nitro budget (ms), refilled by coins
  private nitroActive = false // boosting this frame (held, moving, fuelled)
  private carLift = 0 // eased px the car rides up the screen under nitro
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
  private gearMenuOpen = false // picking manual/automatic before the run
  private gearMenuOpenedAt = 0 // for the picker's input-ignore window
  private autoShift = AUTO_SHIFT // transmission choice, from the gear menu
  private startPending = false // start pressed: cruising to the aligned straight
  private menuTarget = 0 // z where the pre-run straightaway begins
  private cruisePace = MENU_DRIVE_SPEED // stateful, so speed never steps
  private runStartDistance = 0 // the score counts from here
  private highScore = 0

  constructor() {
    super('Game')
  }

  // the level-scaled speed cap on the player's engine
  private get maxSpeed() {
    return MAX_SPEED * world.maxSpeedFactor
  }

  // progression: apply a level's world parameters. The road width eases
  // over a couple of seconds; track generation, traffic mix, checkpoint
  // spacing, and the speed cap apply to everything new from here —
  // whatever is already on the road is untouched
  private setLevel(index: number, snap = false, duration = 2000) {
    this.level = index
    const spec = LEVELS[index]
    this.tweens.killTweensOf(world)
    if (snap) {
      world.roadWidth = spec.roadWidth
    } else {
      this.tweens.add({
        targets: world,
        roadWidth: spec.roadWidth,
        duration,
        ease: 'Sine.easeInOut',
      })
    }
    world.trafficMix = spec.trafficMix
    world.trafficCount = spec.trafficCount
    world.maxSpeedFactor = spec.maxSpeedFactor
    world.sceneryTheme = spec.scenery ?? ''
    this.checkpointInterval = spec.checkpointInterval
    this.road.setGenProfile(spec)
    this.road.setLevelColors(spec.colors ?? {}, snap ? 0 : duration * 2.25)
    this.road.setSkyline(spec.skyFg ?? 'sky-fg', snap ? 0 : duration * 2.25)
  }

  private get score() {
    return Phaser.Math.Clamp(
      Math.floor((this.distance - this.runStartDistance) / 1000),
      0,
      MAX_SCORE,
    )
  }

  create(): void {
    this.cameras.main.fadeFrom(500, 0, 0, 0)
    this.music = this.sound.add('music', { loop: true, volume: 0.3 })
    this.music.pause()
    this.engineSound = this.sound.add('engine', {
      loop: true,
      volume: ENGINE_VOLUME,
    }) as Phaser.Sound.WebAudioSound
    this.nitroSound = this.sound.add('nitro', {
      loop: false,
      volume: NITRO_VOLUME,
    }) as Phaser.Sound.WebAudioSound
    // the screech is split into two markers: the bite at the start
    // plays once, then the steady middle loops while the drift holds
    this.driftSound = this.sound.add('drift') as Phaser.Sound.WebAudioSound
    const DRIFT_SOUND_ATTACK = 0.07
    this.driftSound.addMarker({
      name: 'attack',
      start: 0,
      duration: DRIFT_SOUND_ATTACK,
      config: { volume: DRIFT_SOUND_VOLUME },
    })
    this.driftSound.addMarker({
      name: 'sustain',
      start: DRIFT_SOUND_ATTACK,
      duration: this.driftSound.totalDuration - DRIFT_SOUND_ATTACK,
      config: { volume: DRIFT_SOUND_VOLUME, loop: true },
    })
    this.brakeSound = this.sound.add('drift', {
      volume: DRIFT_SOUND_VOLUME,
      rate: BRAKE_SOUND_RATE,
    }) as Phaser.Sound.WebAudioSound
    this.ignitionSound = this.sound.add(
      'ignition',
    ) as Phaser.Sound.WebAudioSound

    // a struck motorcycle tips over and slides out, holding its final
    // wrecked frame until it scrolls behind the camera
    this.anims.create({
      key: 'motorcycle-fall',
      frames: this.anims.generateFrameNumbers('motorcycle-fall'),
      frameRate: 14,
    })

    this.road = new Road(this)
    this.setLevel(0, true)
    this.scenery = new Scenery(this)
    this.skidMarks = new SkidMarks(this)
    this.car = new Car(this)
    this.road.onWorldTint = (tint) => this.car.setDayTint(tint)
    this.car.park()
    this.traffic = Array.from({ length: world.trafficCount }, () => {
      const car = new NpcCar(this, 0, 0, 0)
      this.respawnCar(car)
      return car
    })
    this.ui = new UI(this)
    this.speedLines = new SpeedLines(this)
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.keyZ = this.input.keyboard!.addKey('Z')
    this.keyX = this.input.keyboard!.addKey('X')
    this.keyC = this.input.keyboard!.addKey('C')

    this.highScore = Number(
      localStorage.getItem('microcruise-highScore') ?? '0',
    )
    if (this.highScore > 0) {
      this.ui.scoreText.setText(`HIGH SCORE\n${this.highScore}`)
    }
    if (DEBUG_KEYS) {
      // debug: time scale presets
      ;['Q', 'W', 'E', 'R', 'T'].forEach((key, i) => {
        const scales = [0.1, 0.5, 1, 2, 8]
        this.input.keyboard!.on(`keydown-${key}`, () => {
          this.timeScale = scales[i]
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

      // debug: jump straight to the next level
      this.input.keyboard!.on('keydown-Y', () => {
        const next = Math.min(LEVELS.length - 1, this.level + 1)
        this.checkpointsCrossed = next * CHECKPOINTS_PER_LEVEL
        if (next !== this.level) this.setLevel(next)
      })

      // debug: collect a coin on demand (score + nitro top-up + chime)
      this.input.keyboard!.on('keydown-N', () => {
        if (!this.paused && !this.menuCruising) this.collectCoin()
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
              Math.abs(other.z - this.distance) >
              Math.abs(car.z - this.distance)
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
      const key = e.key.toLowerCase()
      const isArrow = e.key.includes('Arrow')
      if (!isArrow && key !== 'z' && key !== 'x') return
      // the picker swallows everything for a beat after opening
      if (
        this.gearMenuOpen &&
        this.time.now - this.gearMenuOpenedAt < GEAR_MENU_INPUT_DELAY_MS
      ) {
        return
      }
      // while the transmission picker is up, arrows switch the choice
      // (two options, so any arrow toggles); x/z confirm and start
      if (this.gearMenuOpen && isArrow) {
        this.autoShift = !this.autoShift
        this.sound.play('select')
        this.ui.setGearMenu(this.autoShift)
        return
      }
      this.startGame()
    })

    // the menu opens over a road already rolling by
    this.menuCruising = true

    // debug: boot straight into a run — no title screen or transmission
    // picker, automatic selected, the camera already pulling in and the
    // car driving up into view
    if (SKIP_COUNTDOWN) {
      this.autoShift = true
      this.startPending = true
      this.menuTarget = this.road.straightenAhead()
      for (const car of this.traffic) {
        this.respawnCar(car)
        car.z += this.menuTarget - this.distance
      }
      this.distance += Math.max(0, this.menuTarget - this.distance) * 0.85
      this.engineSound.play({ volume: ENGINE_VOLUME })
      this.launchRun()
    }
  }

  // drop a traffic car onto a random lane centre with a fresh cruising
  // speed and rubber-band personality; the spot is re-rolled if it lands
  // on top of another NPC's lane slot. Usually it lands ahead in the
  // minAhead..minAhead+spread band, but mid-run a car that rolled a
  // faster pace than the player can slot in just behind the camera
  // instead, so it comes up and overtakes
  private respawnCar(car: NpcCar, minAhead = 800, spread = 1500) {
    car.baseSpeed =
      TRAFFIC_MIN_SPEED +
      Math.random() * (TRAFFIC_MAX_SPEED - TRAFFIC_MIN_SPEED)
    car.rubberBand = 0.6 + Math.random() * 0.3
    const fromBehind =
      !this.menuCruising &&
      !this.paused &&
      car.baseSpeed > this.speed &&
      Math.random() < 0.4
    for (let tries = 0; tries < 6; tries++) {
      car.z = fromBehind
        ? this.distance - 20 - Math.random() * 60
        : this.distance + minAhead + Math.random() * spread
      car.laneOffset =
        ((Math.floor(Math.random() * LANES) + 0.5) / LANES) * 2 - 1
      if (!this.laneBlocked(car, FOLLOW_GAP * 2)) break
    }
    car.targetLane = car.laneOffset
    car.laneChangeIn =
      LANE_WANDER_MIN_S +
      Math.random() * (LANE_WANDER_MAX_S - LANE_WANDER_MIN_S)
    // it respawns out of view, so it can come back as anything
    car.randomizeVehicle()
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
      // hit it head-on: snap just behind with a clearance margin so the
      // car sits fully outside the hitbox (otherwise a static obstacle
      // like a sign leaves it grinding on the edge, re-hitting and
      // replaying the crash every time the damage cooldown lapses), hard
      // speed loss, deflect toward whichever side the player was offset
      this.distance = z - halfZ - PLAYER_Z - COLLIDE_CLEARANCE
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

    if (impactSpeed < 100) {
      this.sound.play('light-crash', { volume: 1 })
    } else {
      this.sound.play('crash', { volume: 1 })
    }
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
    this.sound.play('explode', { volume: 1 })
    this.car.explode(this.gameOver)
  }

  // start pressed at the menu: hide the UI and lay a straightaway just
  // past the horizon — the cruise keeps rolling until the camera is in
  // it (aligned with the first-boot view), then beginRun() takes over
  startGame = () => {
    if (!this.isGameOver || !this.menuCruising) return
    // first press: the transmission picker — the driver grabs their
    // keys, and the camera immediately starts braking into the aligned
    // straightaway while they choose (if it parks before they confirm,
    // it just waits there)
    if (!this.gearMenuOpen && !this.startPending) {
      this.gearMenuOpen = true
      this.gearMenuOpenedAt = this.time.now
      this.ui.showGearMenu(this.autoShift)
      this.sound.play('keys', { volume: 2 })
      this.startPending = true

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
      return
    }
    if (this.gearMenuOpen) {
      // transmission confirmed: the choice blinks for a beat with the
      // menu still up, then everything kicks off at once — the menu
      // clears, the skip-ahead jump fires, the ignition turns over and
      // the car drives in. The run proper still waits for the camera to
      // finish pulling in
      this.gearMenuOpen = false
      // the unpicked option drops away instantly; the confirm flash on
      // the chosen one follows on the ignition's timing below
      this.ui.dismissGearChoice(this.autoShift)

      // the ignition turns over, and the engine catches partway through:
      // fading in as the camera pulls into position; the entrance in
      // beginRun() then brakes it down to idle
      this.ignitionSound.play({ volume: 0.7 })
      this.time.delayedCall(500, () => {
        this.ui.flashGearChoice(this.autoShift, 7, 800)
        this.distance += Math.max(0, this.menuTarget - this.distance) * 0.85
      })
      this.time.delayedCall(this.ignitionSound.totalDuration * 350, () => {
        this.engineSound.play({ volume: 0.01 })
        this.time.delayedCall(50, () => {
          this.tweens.add({
            targets: this.engineSound,
            volume: ENGINE_VOLUME,
            duration: 250,
          })
        })
      })

      this.time.delayedCall(1300, () => this.launchRun())
      return
    }
    // confirmed and still rolling: pressing again skips ahead — teleport
    // most of the way there and let the cruise's brake ease out the rest
    this.distance += (this.menuTarget - this.distance) * 0.85
  }

  // the gear-confirm flash has played out: clear the menu and set the
  // run intro in motion (the camera may still be braking into position)
  private launchRun() {
    this.ui.hideGearMenu()

    this.ui.cancelMenu()
    this.tweens.add({
      targets: [this.ui.titleText, this.ui.scoreText, this.ui.title],
      alpha: 0,
      duration: 500,
    })

    // the car drives in right now, while the camera is still braking
    // into position; the run itself still waits in beginRun() for the
    // camera to park. Through the entrance's braking phase the revs
    // fall to idle, punctuated by the brake chirp as the tires bite
    this.car.reset()
    this.tweens.add({
      targets: this.engineSound,
      rate: ENGINE_RATE_MIN,
      delay: ENTER_BRAKE_MS,
      duration: 700 - ENTER_BRAKE_MS,
      ease: 'Sine.easeOut',
    })
    this.time.delayedCall(ENTER_BRAKE_MS, () => {
      this.tweens.killTweensOf(this.brakeSound)
      this.brakeSound.setVolume(DRIFT_SOUND_VOLUME)
      this.brakeSound.play()
    })
    // ...then the 3-2-1 countdown; the clock and controls only come
    // alive once it finishes AND the camera has parked (gameplay is
    // gated on menuCruising, so an early unpause just waits)
    this.car.enter(
      () => {
        if (true || SKIP_COUNTDOWN) {
          this.paused = false
          return
        }
        this.ui.countdown(() => {
          this.paused = false
        })
      },
      (wheelY) => {
        // map the wheels' screen row back to a world depth on the
        // straightaway — the marks land under the car and scroll away
        // once it's driving
        const scale = (wheelY - HORIZON_Y) / (CAMERA_HEIGHT * (GAME_HEIGHT / 2))
        if (scale <= 0) return
        this.skidMarks.add(this.distance + CAMERA_DEPTH / scale, this.playerX)
        this.skidMarks.update(this.road, this.distance)
      },
    )
  }

  // the camera has parked in the straightaway: reset the run state and
  // play the intro (car drives in, countdown), continuing from this spot
  private beginRun() {
    this.speed = 0
    this.carLift = 0
    this.nitroMs = 0
    this.nitroActive = false
    this.playerX = 0
    this.steerValue = 0
    this.driftDir = 0
    this.gear = 1
    this.bounceVx = 0
    this.health = MAX_HEALTH
    this.damageCooldown = 0
    this.impactSkidTime = 0
    // (the car was already reset and sent driving in at gear confirm)
    this.timeLeft = RACE_TIME
    this.outOfTime = false
    this.ui.setTimer(RACE_TIME)
    this.runStartDistance = this.distance
    this.checkpointsCrossed = 0
    if (this.level !== 0) this.setLevel(0)
    this.nextCheckpointZ = this.distance + this.checkpointInterval
    this.checkpoints.forEach((gantry) => gantry.destroy())
    this.checkpoints = []
    this.nextCoinZ = this.distance + COIN_INTERVAL
    this.coins.forEach((coin) => coin.destroy())
    this.coins = []

    this.isGameOver = false
    // TODO: re-enable music
    // this.music.play()
    // traffic re-scatters just behind the camera (inside the cull line
    // at -100), so the pack streams up past the player as the run gets
    // rolling instead of waiting somewhere over the horizon
    for (const car of this.traffic) {
      this.respawnCar(car, -90, 70)
    }
    // the whole HUD fades in with fresh values (the car entrance is
    // already underway — it started when the transmission was confirmed)
    this.ui.setSpeed(0)
    this.ui.setGearHud(1, 0, 0)
    this.ui.showHud()
  }

  gameOver = () => {
    this.paused = true
    this.ui.hideHud()
    this.car.exit()
    this.music.pause()
    this.engineSound.stop()
    if (this.driftSoundOn) this.stopDriftSound()
    if (this.nitroSoundOn) {
      this.nitroSoundOn = false
      this.stopNitroSound()
    }

    // reset the world back to level 1 right away, so the road/scenery/
    // skyline are already easing back to grass through the game-over
    // beat and the menu cruise, instead of snapping once a new run
    // begins. Faster than the in-run level transitions
    this.checkpointsCrossed = 0
    if (this.level !== 0) this.setLevel(0, false, 1500)

    const score = this.score
    if (score > this.highScore) {
      this.highScore = score
      localStorage.setItem('microcruise-highScore', String(score))
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
    this.resizeTraffic(dt, MENU_DRIVE_SPEED)
    // hand off only once the transmission is picked — the camera can
    // arrive early and sit parked while the gear menu is still up
    if (arrived && !this.gearMenuOpen) {
      this.menuCruising = false
      this.startPending = false
      this.beginRun()
    }
  }

  update(_time: number, delta: number): void {
    // the nitro speed lines run above the pause/menu early-outs so the
    // overlay can finish fading out (instead of freezing) when a run
    // ends mid-boost
    this.speedLines.update(
      (delta / 1000) * this.timeScale,
      !this.paused && !this.menuCruising && this.nitroActive,
    )
    if (this.menuCruising) {
      this.updateMenuCruise((delta / 1000) * this.timeScale)
      return
    }
    if (this.paused) return

    const dt = (delta / 1000) * this.timeScale
    const offRoad = Math.abs(this.playerX) > 1
    this.damageCooldown = Math.max(0, this.damageCooldown - dt)
    this.impactSkidTime = Math.max(0, this.impactSkidTime - dt)

    // nitro: boosting requires the key held, enough pace to sell it, and
    // fuel in the budget. Compute it once here so the physics, effects,
    // and sound all read the same flag; drain the budget while it burns
    this.nitroActive =
      !this.outOfTime &&
      this.cursors.space.isDown &&
      this.speed > 60 &&
      this.nitroMs > 0
    if (this.nitroActive) {
      this.nitroMs = Math.max(0, this.nitroMs - dt * 1000)
    }
    this.ui.setNitro(this.nitroMs)

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
    const braking = this.keyC.isDown && this.speed > 30
    // spinning the wheels off the line: throttle at low speed
    const launching = throttle && mph < 25 && mph > 1
    const tiresSmoking =
      launching ||
      braking ||
      this.driftDir !== 0 ||
      this.car.isUnwinding() ||
      this.impactSkidTime > 0
    const wheelsSpinning = tiresSmoking || (offRoad && mph > 0)
    if (wheelsSpinning) this.car.emitTireSmoke(offRoad)
    // taillights light up whenever the brake is held
    // taillights also light while the out-of-time auto-brake drags the
    // car to its stop
    this.car.setBraking(this.keyC.isDown)
    // RPM follows an exponential curve of speed against the gear's max:
    // an upshift drops the revs to mid-band, then they surge to redline
    const rpm = Math.pow(
      this.speed / (GEAR_MAX[this.gear - 1] * this.maxSpeed),
      RPM_CURVE,
    )
    this.ui.setGearHud(this.gear, rpm, this.score)
    // the engine loop's pitch rides the tach (engine braking past
    // redline can push the ratio over 1, so clamp)
    this.engineSound.setRate(
      ENGINE_RATE_MIN + Math.min(1, rpm) * (ENGINE_RATE_MAX - ENGINE_RATE_MIN),
    )
    // the looping screech follows drifts and launch burnouts alike,
    // sustaining as long as either holds — however it ends (release,
    // countersteer, timeout, an impact, or the tires gripping)
    const drifting = this.driftDir !== 0
    const screeching = drifting || launching
    if (screeching !== this.driftSoundOn) {
      // launches don't loop: the screech plays once and rings out
      screeching ? this.startDriftSound(drifting) : this.stopDriftSound()
    }
    // hard braking fires the whole screech once per press (no loop),
    // slightly lower-pitched — unless the loop owns the sound already
    if (braking && !this.wasChirping && !screeching) {
      this.tweens.killTweensOf(this.brakeSound)
      this.brakeSound.setVolume(DRIFT_SOUND_VOLUME)
      this.brakeSound.play()
    }
    this.wasChirping = braking
    // the chirp cuts as soon as the braking stops — the pedal released,
    // or the car slowed below the braking flag's speed floor
    if (
      this.brakeSound.isPlaying &&
      !braking &&
      !this.tweens.isTweening(this.brakeSound)
    ) {
      this.tweens.add({
        targets: this.brakeSound,
        volume: 0,
        duration: 150,
        onComplete: () => this.brakeSound.stop(),
      })
    }
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
    // nitro rides the car up the screen (eased) so the road appears to
    // rush past faster
    const nitro = this.nitroActive
    // whoosh on engage, fade out on release
    if (nitro !== this.nitroSoundOn) {
      this.nitroSoundOn = nitro
      if (nitro) this.startNitroSound()
      else this.stopNitroSound()
    }
    this.carLift +=
      ((nitro ? NITRO_LIFT : 0) - this.carLift) *
      Math.min(1, NITRO_LIFT_RATE * dt)
    this.car.setLift(this.carLift)
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
    this.updateCarShake(offRoad, tiresSmoking, nitro)
  }

  // the screech: play the bite once, chain into the sustain, and on
  // release fade out instead of cutting — a short drift chirps, a long
  // one sustains. Drifts loop the sustain for as long as they hold; a
  // launch plays it once through and lets it end
  private startDriftSound(loop = true) {
    this.driftSoundOn = true
    this.tweens.killTweensOf(this.driftSound)
    this.driftSound.setVolume(DRIFT_SOUND_VOLUME)
    this.driftSound.play('attack')
    this.driftSound.once('complete', () => {
      if (this.driftSoundOn) this.driftSound.play('sustain', { loop })
    })
  }

  private stopDriftSound() {
    this.driftSoundOn = false
    this.driftSound.off('complete')
    this.tweens.add({
      targets: this.driftSound,
      volume: 0,
      duration: 150,
      onComplete: () => this.driftSound.stop(),
    })
  }

  private startNitroSound() {
    this.tweens.killTweensOf(this.nitroSound)
    this.nitroSound.play({ loop: false, volume: NITRO_VOLUME })
  }

  private stopNitroSound() {
    this.tweens.add({
      targets: this.nitroSound,
      volume: 0,
      duration: 250,
      onComplete: () => this.nitroSound.stop(),
    })
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
  // speed falls) or instant manual shifts on up/down, per the
  // transmission picked at the start menu
  private updateGears() {
    if (this.autoShift) {
      const gearMax = GEAR_MAX[this.gear - 1] * this.maxSpeed
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
        this.speed < GEAR_MAX[this.gear - 2] * this.maxSpeed * 0.9
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
    // back down toward it. Nitro only boosts the pull, not the ceiling
    const nitro = this.nitroActive
    const gearMax = GEAR_MAX[this.gear - 1] * this.maxSpeed
    const gearAccel =
      ACCEL * GEAR_ACCEL[this.gear - 1] * (nitro ? NITRO_ACCEL_FACTOR : 1)
    if (this.speed > gearMax) {
      this.speed = Math.max(gearMax, this.speed - ENGINE_BRAKE * dt)
    } else if (this.driftDir !== 0) {
      // drifting: the tires are sideways, so the engine only puts down a
      // fraction of its normal pull (throttle/brake keys are overridden)
      this.speed +=
        gearAccel *
        DRIFT_ACCEL_FACTOR *
        (offRoad ? OFFROAD_ACCEL_FACTOR : 1) *
        dt
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
        // out of time, the car drags itself down harder than a coast
        this.speed -=
          COAST_DECEL * (this.outOfTime ? OUT_OF_TIME_DECEL_FACTOR : 1) * dt
      }
    }
    if (offRoad && this.speed > OFFROAD_MAX_SPEED) {
      this.speed -= OFFROAD_DECEL * dt
    }
    // climbing bleeds speed, dropping returns it
    this.speed -= this.road.slopeAt(this.distance + PLAYER_Z) * SLOPE_DRAG * dt
    this.speed = Phaser.Math.Clamp(this.speed, 0, this.maxSpeed)
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
    // every lateral force is scaled by laneScale(): playerX is a fraction
    // of the road's half-width, so without it a wider road would make the
    // same physical motion cover more ground
    this.playerX +=
      this.steerValue * STEER_SPEED * steerAuthority * laneScale() * dt
    // drifting slides with the curve: only a fraction of the pull applies
    this.playerX -=
      this.road.curveAt(this.distance + PLAYER_Z) *
      CENTRIFUGAL *
      (this.driftDir !== 0 ? DRIFT_GRIP : 1) *
      speedFactor *
      laneScale() *
      dt
    // collision knockback: a decaying lateral shove away from the hit
    this.playerX += this.bounceVx * laneScale() * dt
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
      this.nextCheckpointZ += this.checkpointInterval
    }
    this.checkpoints = this.checkpoints.filter((gantry) => {
      if (gantry.z < this.distance) {
        this.timeLeft = Math.min(MAX_TIME, this.timeLeft + CHECKPOINT_BONUS)
        this.health = Math.min(MAX_HEALTH, this.health + CHECKPOINT_REPAIR)
        this.sound.play('checkpoint', { volume: 1.5, rate: 1 })
        this.car.setHealth(this.health)
        this.car.onCheckpoint()
        this.ui.showTimeBonus(CHECKPOINT_BONUS)
        // progression: every CHECKPOINTS_PER_LEVEL crossings step up a
        // level, clamped at the last one
        this.checkpointsCrossed++
        const next = Math.min(
          LEVELS.length - 1,
          Math.floor(this.checkpointsCrossed / CHECKPOINTS_PER_LEVEL),
        )
        if (next !== this.level) this.setLevel(next)
        this.sound.play('select', { volume: 0.5 })
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
        Math.abs(this.playerX - coin.laneOffset) <
          COIN_COLLIDE_LANE * laneScale()
      ) {
        this.collectCoin()
        coin.destroy()
        return false
      }
      coin.update(this.road)
      return true
    })
  }

  private collectCoin() {
    // each coin also tops up the nitro budget, capped at the max
    this.nitroMs = Math.min(NITRO_MAX_MS, this.nitroMs + NITRO_PER_COIN_MS)
    // the chime's pitch reads the now-updated tank: fuller tank = higher
    // pitch, so filling up sweeps upward and a full tank always tops out
    const fill = this.nitroMs / NITRO_MAX_MS
    this.sound.play('coin', {
      volume: 0.5,
      rate: COIN_RATE_EMPTY + fill * (COIN_RATE_FULL - COIN_RATE_EMPTY),
    })
    this.car.emitCoin()
  }

  // traffic drives itself; recycle a car onto the road ahead once it falls
  // behind the camera or escapes far beyond the draw distance
  private updateTraffic(dt: number) {
    this.resizeTraffic(dt, this.speed, true)
  }

  // the shared fleet loop (run and menu cruise): recycle out-of-view
  // cars ahead, and ease the fleet toward the level's trafficCount —
  // new cars drop in beyond the horizon at once, surplus ones retire
  // when they leave the view instead of respawning. live = the player
  // car is on the road, so overtakers must dodge around it
  private resizeTraffic(dt: number, pace: number, live = false) {
    while (this.traffic.length < world.trafficCount) {
      const car = new NpcCar(this, 0, 0, 0)
      this.respawnCar(car)
      this.traffic.push(car)
    }
    let surplus = this.traffic.length - world.trafficCount
    this.traffic = this.traffic.filter((car) => {
      if (car.z < this.distance - 100 || car.z > this.distance + 4000) {
        if (surplus > 0) {
          surplus--
          car.destroy()
          return false
        }
        this.respawnCar(car)
      }
      car.laneChangeIn -= dt
      if (car.laneChangeIn <= 0) {
        car.laneChangeIn =
          LANE_WANDER_MIN_S +
          Math.random() * (LANE_WANDER_MAX_S - LANE_WANDER_MIN_S)
        this.wanderLane(car, live)
      }
      let cap = this.followCap(car)
      if (live) cap = Math.min(cap, this.dodgePlayer(car))
      car.update(this.road, dt, pace, cap)
      return true
    })
  }

  // a spontaneous lane change to a random other lane — skipped when the
  // new lane would drop the car onto another NPC's slot, or into the
  // player's line while anywhere near them
  private wanderLane(car: NpcCar, live: boolean) {
    if (car.fallen) return
    const options: number[] = []
    for (let i = 0; i < LANES; i++) {
      const lane = ((i + 0.5) / LANES) * 2 - 1
      if (Math.abs(lane - car.targetLane) < 0.1) continue
      const blocked = this.traffic.some(
        (other) =>
          other !== car &&
          Math.abs(other.laneOffset - lane) < 0.1 &&
          Math.abs(other.z - car.z) < FOLLOW_GAP * 2,
      )
      if (blocked) continue
      if (
        live &&
        Math.abs(lane - this.playerX) <
          CAR_COLLIDE_LANE * laneScale() + car.collideLane + 0.05 &&
        Math.abs(this.distance + PLAYER_Z - car.z) < OVERTAKE_GAP
      )
        continue
      options.push(lane)
    }
    if (options.length === 0) return
    car.targetLane = options[Math.floor(Math.random() * options.length)]
  }

  // a faster car closing in on the player from behind swerves toward
  // the lane centre farthest from them; as a hard guarantee, any car in
  // the player's line and close behind is capped to the player's pace —
  // regardless of relative speed, or a matched-pace car would un-cap
  // and creep forward frame by frame into the player's rear. Returns
  // the speed cap
  private dodgePlayer(car: NpcCar): number {
    const gap = this.distance + PLAYER_Z - car.z
    if (gap <= 0 || gap > OVERTAKE_GAP) return Infinity
    const clearance = CAR_COLLIDE_LANE * laneScale() + car.collideLane + 0.05
    if (
      car.speed > this.speed &&
      Math.abs(car.targetLane - this.playerX) < clearance
    ) {
      let best = car.targetLane
      let bestDist = -1
      for (let i = 0; i < LANES; i++) {
        const lane = ((i + 0.5) / LANES) * 2 - 1
        const d = Math.abs(lane - this.playerX)
        if (d > bestDist) {
          bestDist = d
          best = lane
        }
      }
      car.targetLane = best
    }
    if (gap < FOLLOW_GAP && Math.abs(car.laneOffset - this.playerX) < clearance)
      return this.speed
    return Infinity
  }

  // collisions: cars and roadside signs both bounce the player
  private handleCollisions() {
    for (const car of this.traffic) {
      // a downed bike lies flat — nothing left to hit
      if (car.fallen) continue
      // traffic behind the player can never hit them: collisions only
      // count against cars ahead (the player driving into their rear
      // or side) — anything coming up from behind passes untouchably
      if (car.z < this.distance + PLAYER_Z) continue
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
        SIGN_COLLIDE_LANE * laneScale(),
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
  private updateCarShake(
    offRoad: boolean,
    tiresSmoking: boolean,
    nitro: boolean,
  ) {
    let shake = 0
    if (offRoad && this.speed > OFFROAD_SHAKE_MIN_SPEED) {
      shake =
        Math.min(1, this.speed / OFFROAD_SHAKE_MIN_SPEED - 1) * OFFROAD_SHAKE
    }
    if (tiresSmoking) shake = Math.max(shake, BURNOUT_SHAKE)
    if (nitro) shake = Math.max(shake, NITRO_SHAKE)
    this.car.setShake(shake)
  }
}

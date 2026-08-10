import { CAR_COLLIDE_LANE, LANE_SCALE } from '../constants'
import { Road } from './Road'
import { RoadObject } from './RoadObject'

// one traffic vehicle type: its sheet, physical size, pre-drawn distance
// frames, and whether the sheet has lean art (frames 1-5 at the nearest
// size). Add a vehicle by loading its sheet in Boot and appending an
// entry here.
export interface VehicleSpec {
  texture: string
  // physical width in world units (the player car reads as ~25)
  worldWidth: number
  sizeFrames: { frame: number; width: number; yOffset?: number }[]
  hasLean: boolean
  // screen px the whole sprite is seated down by
  yOffset?: number
  // multiplier on the rolled traffic speed (and its rubber-banding) —
  // heavy vehicles lumber along below the flow. 1 = normal
  speedFactor?: number
  // size falloff compression (RoadObject scaleExponent): lower = the
  // vehicle reaches its big frames from farther away, so heavy vehicles
  // loom sooner. Defaults to the standard 0.8
  scaleExponent?: number
  // collision half-width in lane units (same convention as
  // CAR_COLLIDE_LANE, which is the default) — narrow vehicles get a
  // narrow box so brushing past them doesn't count as a hit
  collideLane?: number
}

export const VEHICLES: VehicleSpec[] = [
  {
    // car2.png: frames 0-5 are the near, full-detail car at increasing
    // lean; frames 7-13 are pre-shrunk straight cars for the distance.
    // The widths are each frame's drawn art width in px.
    texture: 'car2',
    worldWidth: 25,
    hasLean: true,
    yOffset: 1,
    sizeFrames: [
      { frame: 0, width: 24 },
      { frame: 7, width: 17 },
      { frame: 8, width: 16 },
      { frame: 9, width: 12 },
      { frame: 10, width: 8 },
      { frame: 11, width: 4 },
      { frame: 12, width: 2 },
      { frame: 13, width: 1 },
    ],
  },
  {
    // truck.png: no lean art, just 11 straight sizes. The art is centred
    // in its 32x32 frames rather than baseline-aligned, so each variant
    // carries its own seat-down offset (px from the frame's bottom edge
    // up to the art's)
    texture: 'truck',
    worldWidth: 28,
    hasLean: false,
    speedFactor: 0.8,
    scaleExponent: 0.7,
    sizeFrames: [
      { frame: 0, width: 22, yOffset: 7 },
      { frame: 1, width: 20, yOffset: 8 },
      { frame: 2, width: 18, yOffset: 9 },
      { frame: 3, width: 16, yOffset: 10 },
      { frame: 4, width: 14, yOffset: 11 },
      { frame: 5, width: 12, yOffset: 12 },
      { frame: 6, width: 10, yOffset: 12 },
      { frame: 7, width: 8, yOffset: 13 },
      { frame: 8, width: 6, yOffset: 13 },
      { frame: 9, width: 4, yOffset: 14 },
      { frame: 10, width: 2, yOffset: 15 },
    ],
  },
  {
    // semi.png: a big rig — no lean art, 12 straight sizes in 32x48
    // frames, art centred, so per-variant seat-down offsets again
    texture: 'semi',
    worldWidth: 30,
    hasLean: false,
    speedFactor: 0.65,
    scaleExponent: 0.62,
    sizeFrames: [
      { frame: 0, width: 31, yOffset: 3 },
      { frame: 1, width: 27, yOffset: 6 },
      { frame: 2, width: 25, yOffset: 9 },
      { frame: 3, width: 23, yOffset: 12 },
      { frame: 4, width: 19, yOffset: 14 },
      { frame: 5, width: 17, yOffset: 15 },
      { frame: 6, width: 15, yOffset: 16 },
      { frame: 7, width: 11, yOffset: 17 },
      { frame: 8, width: 9, yOffset: 19 },
      { frame: 9, width: 7, yOffset: 20 },
      { frame: 10, width: 5, yOffset: 21 },
      { frame: 11, width: 3, yOffset: 22 },
      { frame: 12, width: 2, yOffset: 23 },
    ],
  },
  {
    // motorcycle.png: 10 straight sizes in 16x20 frames. A bike from
    // behind shrinks mostly in height (its width barely changes), so the
    // size keys here are each frame's art HEIGHT, with worldWidth tuned
    // so the selection paces like the car's. Physically skinny: narrow
    // collision box to match
    texture: 'motorcycle',
    worldWidth: 12,
    hasLean: false,
    collideLane: 0.12 * LANE_SCALE,
    scaleExponent: 0.62,
    sizeFrames: [
      { frame: 0, width: 20 },
      { frame: 1, width: 18, yOffset: 1 },
      { frame: 2, width: 16, yOffset: 2 },
      { frame: 3, width: 14, yOffset: 3 },
      { frame: 4, width: 12, yOffset: 4 },
      { frame: 5, width: 10, yOffset: 5 },
      { frame: 6, width: 8, yOffset: 6 },
      { frame: 7, width: 6, yOffset: 6 },
      { frame: 8, width: 3, yOffset: 7 },
      { frame: 9, width: 2, yOffset: 8 },
    ],
  },
]

const randomVehicle = () =>
  VEHICLES[Math.floor(Math.random() * VEHICLES.length)]

// another vehicle driving along the track: it advances its own z each
// frame and rides a fixed lane offset, so the shared road projection
// makes it follow every curve and hill automatically
export class NpcCar {
  private scene: Phaser.Scene
  private obj!: RoadObject
  private spec!: VehicleSpec
  // live speed, eased toward the rubber-band target each frame
  speed = 0
  // fraction of the player's speed this car keeps up with
  rubberBand = 0.75

  constructor(
    scene: Phaser.Scene,
    public z: number,
    public laneOffset: number,
    public baseSpeed: number,
  ) {
    this.scene = scene
    this.speed = baseSpeed
    this.setVehicle(randomVehicle())
  }

  // swap what this NPC is driving; call while it's beyond the horizon
  // (recycling), since the sprite is rebuilt
  randomizeVehicle() {
    this.setVehicle(randomVehicle())
  }

  // collision half-width across the road, per vehicle type
  get collideLane() {
    return this.spec.collideLane ?? CAR_COLLIDE_LANE
  }

  setVehicle(spec: VehicleSpec) {
    if (this.spec === spec) return
    this.spec = spec
    this.obj?.destroy()
    // the compressed falloff (exponent < 1) brings vehicles close to full
    // size from mid-distance rather than only at point-blank range
    this.obj = new RoadObject(
      this.scene,
      spec.texture,
      this.z,
      this.laneOffset,
      {
        worldWidth: spec.worldWidth,
        maxScale: 1,
        scaleExponent: spec.scaleExponent ?? 0.8,
        sizeFrames: spec.sizeFrames,
        yOffset: spec.yOffset ?? 0,
      },
    )
  }

  update(road: Road, dt: number, playerSpeed: number, capSpeed = Infinity) {
    // rubber-band: never slower than its own cruise pace, but keeps up with
    // a fast player (at a per-car fraction < 1, so it can still be caught),
    // easing toward the target so speed changes read as driving. Heavy
    // vehicles scale the whole target down. capSpeed is the pace of a
    // slower vehicle just ahead in this one's lane — never asked to
    // exceed it, so NPCs queue up instead of overlapping
    const target = Math.min(
      Math.max(this.baseSpeed, playerSpeed * this.rubberBand) *
        (this.spec.speedFactor ?? 1),
      capSpeed,
    )
    this.speed += (target - this.speed) * Math.min(1, 2 * dt)
    if (this.speed > capSpeed) this.speed = capSpeed
    this.z += this.speed * dt
    this.obj.z = this.z
    this.obj.laneOffset = this.laneOffset

    this.obj.update(road)

    // lean into the road's bend at the vehicle's own position. Lean art
    // only exists at the nearest size — farther frames are pre-shrunk
    // straight vehicles, so the size frame picked by update() stands
    if (this.spec.hasLean && this.obj.sizeIndex === 0) {
      const curve = road.curveAt(this.z)
      const mag = Math.abs(curve)
      const frame = Math.min(5, Math.floor(mag / 0.12))
      this.obj.setFrame(frame, curve < 0)
    }
  }

  destroy() {
    this.obj.destroy()
  }
}

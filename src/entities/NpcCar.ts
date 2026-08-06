import { Road } from './Road'
import { RoadObject } from './RoadObject'

// worldWidth 25 makes an NPC the same on-screen size as the player car when
// it's right alongside (at the player's depth plane)
const CAR_WORLD_WIDTH = 25

// car2.png layout: frames 0-5 are the near, full-detail car at increasing
// lean; frames 7-13 are pre-shrunk straight cars for the distance. The
// widths are each frame's drawn art width in px.
const SIZE_FRAMES = [
  { frame: 0, width: 24 },
  { frame: 7, width: 17 },
  { frame: 8, width: 16 },
  { frame: 9, width: 12 },
  { frame: 10, width: 8 },
  { frame: 11, width: 4 },
  { frame: 12, width: 2 },
  { frame: 13, width: 1 },
]

// another car driving along the track: it advances its own z each frame and
// rides a fixed lane offset, so the shared road projection makes it follow
// every curve and hill automatically
export class NpcCar {
  private obj: RoadObject
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
    this.speed = baseSpeed
    // the compressed falloff (exponent < 1) brings cars close to full size
    // from mid-distance rather than only at point-blank range
    this.obj = new RoadObject(scene, 'car2', z, laneOffset, {
      worldWidth: CAR_WORLD_WIDTH,
      maxScale: 1,
      scaleExponent: 0.8,
      sizeFrames: SIZE_FRAMES,
      yOffset: 1,
    })
  }

  update(road: Road, dt: number, playerSpeed: number) {
    // rubber-band: never slower than its own cruise pace, but keeps up with
    // a fast player (at a per-car fraction < 1, so it can still be caught),
    // easing toward the target so speed changes read as driving
    const target = Math.max(this.baseSpeed, playerSpeed * this.rubberBand)
    this.speed += (target - this.speed) * Math.min(1, 2 * dt)
    this.z += this.speed * dt
    this.obj.z = this.z
    this.obj.laneOffset = this.laneOffset

    this.obj.update(road)

    // lean into the road's bend at the car's own position. Lean art only
    // exists at the nearest size — farther frames are pre-shrunk straight
    // cars, so the size frame picked by update() stands
    if (this.obj.sizeIndex === 0) {
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

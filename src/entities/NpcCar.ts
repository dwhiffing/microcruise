import { Road } from './Road'
import { RoadObject } from './RoadObject'

// worldWidth 25 makes an NPC the same on-screen size as the player car when
// it's right alongside (at the player's depth plane)
const CAR_WORLD_WIDTH = 25

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
      scaleExponent: 0.9,
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

    // lean into the road's bend at the car's own position
    const curve = road.curveAt(this.z)
    const mag = Math.abs(curve)
    const frame = mag < 0.15 ? 0 : mag < 0.3 ? 1 : mag < 0.45 ? 2 : 3
    this.obj.setFrame(frame, curve < 0)

    this.obj.update(road)
  }

  destroy() {
    this.obj.destroy()
  }
}

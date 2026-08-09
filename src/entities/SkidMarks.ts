import { GAME_WIDTH } from '../constants'
import { multiplyColor, Road } from './Road'

// rubber laid on tarmac, torn turf when the wheels are in the grass
const SKID_COLOR = 0x4d4d44
const DIRT_SKID_COLOR = 0x5b3a24
// how far the rear wheels sit either side of the car's lane position
// (road-relative units, like playerX)
const WHEEL_LANE = 0.11
// a mark's width in world units (same units as ROAD_WIDTH)
const MARK_WORLD_WIDTH = 4
// oldest strips are dropped past this many entries (2 per add())
const MAX_STRIPS = 240
// mark opacity: a hard skid (wheels spinning) vs the faint trail every
// rolling tire leaves
const STRONG_ALPHA = 0.6
const FAINT_ALPHA = 0.25
// stamps arrive every frame while the car rolls, so anything much older
// than a frame (ms) means the trail broke — start a new strip. Distance
// can't be the test: at speed (or debug fast-forward) one frame covers
// arbitrarily many world units
const CONNECT_MS = 250

// one wheel's trail between two consecutive stamps: world z and lane at
// each end
interface Strip {
  z1: number
  z2: number
  lane1: number
  lane2: number
  color: number
  alpha: number
}

// skid marks stamped onto the road: consecutive stamps are joined into
// world-space quads that get re-projected every frame, so the trails
// stay glued to the tarmac, follow the car's line through curves, and
// run all the way off the bottom of the screen as they pass under the
// camera
export class SkidMarks {
  private scene: Phaser.Scene
  private gfx: Phaser.GameObjects.Graphics

  private strips: Strip[] = []
  private prev: {
    z: number
    left: number
    right: number
    time: number
  } | null = null

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    // just above the road fill, below every projected sprite
    this.gfx = scene.add.graphics().setDepth(0.01)
  }

  // stamp the rear wheels at world depth z, straddling the car's lane
  // position; each call links back to the previous one to form strips.
  // strong = wheels spinning (dark skid); otherwise a faint rolling trail
  add(z: number, lane: number, dirt = false, strong = true) {
    const now = this.scene.time.now
    const left = lane - WHEEL_LANE
    const right = lane + WHEEL_LANE
    if (this.prev && z > this.prev.z && now - this.prev.time < CONNECT_MS) {
      const color = dirt ? DIRT_SKID_COLOR : SKID_COLOR
      const alpha = strong ? STRONG_ALPHA : FAINT_ALPHA
      const { z: pz, left: pl, right: pr } = this.prev
      this.strips.push({ z1: pz, z2: z, lane1: pl, lane2: left, color, alpha })
      this.strips.push({ z1: pz, z2: z, lane1: pr, lane2: right, color, alpha })
      if (this.strips.length > MAX_STRIPS) {
        this.strips.splice(0, this.strips.length - MAX_STRIPS)
      }
    }
    this.prev = { z, left, right, time: now }
  }

  // redraw against the current projection (call after road.update);
  // strips that fall behind the camera are dropped
  update(road: Road, position: number) {
    // the near clip plane: project() can't see anything closer
    const nearZ = position + 1.1
    this.gfx.clear()
    this.strips = this.strips.filter((s) => s.z2 > nearZ)
    for (const s of this.strips) {
      // clamp the near end to the clip plane (interpolating its lane) so
      // the quad projects below the frame instead of vanishing early
      const t = s.z1 < nearZ ? (nearZ - s.z1) / (s.z2 - s.z1) : 0
      const near = road.project(
        Math.max(s.z1, nearZ),
        s.lane1 + (s.lane2 - s.lane1) * t,
      )
      const far = road.project(s.z2, s.lane2)
      // the near end legitimately projects past the bottom edge, which
      // the crest test counts as hidden — only the far end decides
      if (!far.visible) continue
      const wNear = Math.max(
        1,
        near.scale * (GAME_WIDTH / 2) * MARK_WORLD_WIDTH,
      )
      const wFar = Math.max(1, far.scale * (GAME_WIDTH / 2) * MARK_WORLD_WIDTH)
      this.gfx.fillStyle(multiplyColor(s.color, road.worldTint), s.alpha)
      this.gfx.fillPoints(
        [
          { x: near.screenX - wNear / 2, y: near.screenY },
          { x: near.screenX + wNear / 2, y: near.screenY },
          { x: far.screenX + wFar / 2, y: far.screenY },
          { x: far.screenX - wFar / 2, y: far.screenY },
        ],
        true,
      )
    }
  }

  destroy() {
    this.gfx.destroy()
  }
}

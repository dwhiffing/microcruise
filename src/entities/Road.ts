import {
  CAMERA_DEPTH,
  CAMERA_HEIGHT,
  COLORS,
  CURVE_WORLD,
  DRAW_SEGMENTS,
  GAME_HEIGHT,
  GAME_WIDTH,
  HORIZON_Y,
  LANES,
  LENS_BEND,
  PLAYER_Z,
  ROAD_WIDTH,
  RUMBLE_LENGTH,
  SEGMENT_LENGTH,
  SKY_PARALLAX,
} from '../constants'

// one fixed-length slice of track; y1/y2 are world elevation at its near/far
// edge, curve is bend intensity (already eased along its section)
interface Segment {
  index: number
  y1: number
  y2: number
  curve: number
}

const easeIn = (a: number, b: number, p: number) => a + (b - a) * p * p
const easeInOut = (a: number, b: number, p: number) =>
  a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5)
const lerp = (a: number, b: number, p: number) => a + (b - a) * p

export class Road {
  private sky: Phaser.GameObjects.TileSprite
  private graphics: Phaser.GameObjects.Graphics
  private segments: Segment[] = []
  private firstIndex = 0
  private genY = 0
  private lastCurve = 0
  private prevPosition = 0

  constructor(scene: Phaser.Scene) {
    // tile sprite wraps the 128px-wide art, so curves can parallax the sky
    // sideways indefinitely
    const skyHeight = scene.textures.get('sky').get(0).height
    this.sky = scene.add
      .tileSprite(0, 0, GAME_WIDTH, skyHeight, 'sky')
      .setOrigin(0, 0)

    this.graphics = scene.add.graphics()
    this.reset()
  }

  reset() {
    this.segments = []
    this.firstIndex = 0
    this.genY = 0
    this.lastCurve = 0
    this.prevPosition = 0
    this.sky.tilePositionX = 0
    this.addStraightFlat(30)
    this.update(0, 0)
  }

  private segmentAt(z: number): Segment {
    const i = Math.floor(z / SEGMENT_LENGTH) - this.firstIndex
    return this.segments[Math.max(0, Math.min(i, this.segments.length - 1))]
  }

  // bend intensity at depth z: 0 = straight, +/- = right/left
  curveAt(z: number): number {
    return this.segmentAt(z).curve
  }

  // gradient at depth z: 0 = flat, +/- = climbing/dropping
  slopeAt(z: number): number {
    const s = this.segmentAt(z)
    return (s.y2 - s.y1) / SEGMENT_LENGTH
  }

  update(position: number, playerX: number) {
    // parallax: following a right-hand curve slides the scenery left,
    // proportional to ground actually covered this frame
    this.sky.tilePositionX +=
      this.curveAt(position + PLAYER_Z) *
      (position - this.prevPosition) *
      SKY_PARALLAX
    this.prevPosition = position

    const baseIndex = Math.floor(position / SEGMENT_LENGTH)

    while (
      this.firstIndex + this.segments.length <
      baseIndex + DRAW_SEGMENTS + 2
    ) {
      this.addSection()
    }
    while (this.segments.length && this.segments[0].index < baseIndex - 2) {
      this.segments.shift()
      this.firstIndex++
    }

    this.draw(position, playerX)
  }

  private pushSegment(curve: number, y1: number, y2: number) {
    this.segments.push({
      index: this.firstIndex + this.segments.length,
      y1,
      y2,
      curve,
    })
  }

  private addStraightFlat(count: number) {
    for (let n = 0; n < count; n++) {
      this.pushSegment(0, this.genY, this.genY)
    }
  }

  // one stretch of track: curve eases in, holds, eases out, while elevation
  // eases smoothly toward a new height. Curved and straight stretches
  // alternate; hills are rolled independently so all combinations occur.
  private addSection() {
    let curve = 0
    const isStraight = this.lastCurve === 0
    if (isStraight) {
      // curve sharpness: 50% gentle, 25% medium, 25% sharp
      const roll = Math.random()
      const [lo, hi] =
        roll < 0.5 ? [0.1, 0.2] : roll < 0.75 ? [0.2, 0.4] : [0.4, 0.7]
      curve = (Math.random() < 0.5 ? -1 : 1) * (lo + Math.random() * (hi - lo))
    }
    this.lastCurve = curve

    const hill =
      Math.random() < 0.6
        ? (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 50)
        : 0

    // straights run long and plain; curves ease in/out over a longer hold
    const enter = isStraight ? 0 : 8 + Math.floor(Math.random() * 10)
    const hold = isStraight
      ? 30 + Math.floor(Math.random() * 40)
      : 16 + Math.floor(Math.random() * 18)
    const leave = isStraight ? 0 : 8 + Math.floor(Math.random() * 10)
    const total = enter + hold + leave

    const startY = this.genY
    const endY = startY + hill

    for (let n = 0; n < total; n++) {
      let c: number
      if (n < enter) c = easeIn(0, curve, n / enter)
      else if (n < enter + hold) c = curve
      else c = easeInOut(curve, 0, (n - enter - hold) / leave)

      this.pushSegment(
        c,
        easeInOut(startY, endY, n / total),
        easeInOut(startY, endY, (n + 1) / total),
      )
    }
    this.genY = endY
  }

  private draw(position: number, playerX: number) {
    const g = this.graphics
    g.clear()

    const halfW = GAME_WIDTH / 2
    const halfH = GAME_HEIGHT / 2
    const baseIndex = Math.floor(position / SEGMENT_LENGTH)
    const baseSeg = this.segmentAt(position)
    const basePercent = (position % SEGMENT_LENGTH) / SEGMENT_LENGTH

    // camera height tracks the road under the player car
    const playerSeg = this.segmentAt(position + PLAYER_Z)
    const playerPercent =
      ((position + PLAYER_Z) % SEGMENT_LENGTH) / SEGMENT_LENGTH
    const camY = lerp(playerSeg.y1, playerSeg.y2, playerPercent) + CAMERA_HEIGHT
    const camX = playerX * ROAD_WIDTH

    // lens bend: near rows bow outward, with the current curve — strongest at
    // the bottom edge, fading out toward the horizon — a cheap
    // barrel-distortion feel
    const lensCurve = this.curveAt(position + PLAYER_Z)
    const nearRows = GAME_HEIGHT - HORIZON_Y
    const lensAt = (sy: number) => {
      const t = Math.max(0, (sy - HORIZON_Y) / nearRows)
      return lensCurve * LENS_BEND * t * t
    }

    // fake-curve accumulator: world-x offset grows quadratically with depth
    let x = 0
    let dx = -(baseSeg.curve * CURVE_WORLD * basePercent)
    let clipY = GAME_HEIGHT

    for (let n = 0; n < DRAW_SEGMENTS; n++) {
      const seg = this.segments[baseIndex - this.firstIndex + n]
      if (!seg) break

      const z1 = seg.index * SEGMENT_LENGTH - position
      const z2 = z1 + SEGMENT_LENGTH
      const cx1 = x - camX
      const cx2 = x + dx - camX

      x += dx
      dx += seg.curve * CURVE_WORLD

      if (z2 <= 1) continue // fully behind the camera

      // the segment straddling the camera gets its near edge clamped to a
      // near plane (instead of skipped), so the road always reaches the
      // bottom of the frame
      let z1c = z1
      let y1c = seg.y1
      let cx1c = cx1
      if (z1c < 1) {
        const tc = (1 - z1) / (z2 - z1)
        z1c = 1
        y1c = lerp(seg.y1, seg.y2, tc)
        cx1c = lerp(cx1, cx2, tc)
      }

      const scale1 = CAMERA_DEPTH / z1c
      const scale2 = CAMERA_DEPTH / z2
      const sy1 = HORIZON_Y - scale1 * (y1c - camY) * halfH
      const sy2 = HORIZON_Y - scale2 * (seg.y2 - camY) * halfH
      const sx1 = halfW + scale1 * cx1c * halfW + lensAt(sy1)
      const sx2 = halfW + scale2 * cx2 * halfW + lensAt(sy2)
      const sw1 = scale1 * ROAD_WIDTH * halfW
      const sw2 = scale2 * ROAD_WIDTH * halfW

      if (sy2 >= clipY || sy2 >= sy1) continue // hidden behind a nearer crest

      // clamp the near edge against already-drawn nearer segments
      let by = sy1
      let bx = sx1
      let bw = sw1
      if (by > clipY) {
        const t = (clipY - sy2) / (sy1 - sy2)
        bx = lerp(sx2, sx1, t)
        bw = lerp(sw2, sw1, t)
        by = clipY
      }

      const band = Math.floor(seg.index / RUMBLE_LENGTH) % 2

      // alt stripes are a 1px checkerboard of the alt color over the base —
      // never solid. Rows just below the horizon dither on every band so the
      // far distance shows a constant pattern instead of shimmering stripes.
      const farDitherY = HORIZON_Y + 2
      const rowTop = Math.max(0, Math.round(sy2))
      const rowBottom = Math.min(GAME_HEIGHT, Math.round(by))

      g.fillStyle(COLORS.grass)
      g.fillRect(0, sy2, GAME_WIDTH, by - sy2)
      g.fillStyle(COLORS.grassAlt)
      for (let py = rowTop; py < rowBottom; py++) {
        if (band && py >= farDitherY) continue
        for (let px = py & 1; px < GAME_WIDTH; px += 2) {
          g.fillRect(px, py, 1, 1)
        }
      }

      g.fillStyle(COLORS.road)
      g.fillPoints(
        [
          { x: bx - bw, y: by },
          { x: bx + bw, y: by },
          { x: sx2 + sw2, y: sy2 },
          { x: sx2 - sw2, y: sy2 },
        ],
        true,
      )
      g.fillStyle(COLORS.roadAlt)
      const spanH = by - sy2
      for (let py = rowTop; py < rowBottom; py++) {
        if (band && py >= farDitherY) continue
        // road left/right edge at this row, interpolated along the trapezoid
        const t = spanH > 0 ? (py + 0.5 - sy2) / spanH : 0
        const rcx = lerp(sx2, bx, t)
        const rw = lerp(sw2, bw, t)
        const xEnd = Math.min(GAME_WIDTH, rcx + rw)
        let px = Math.max(0, Math.round(rcx - rw))
        if ((px + py) & 1) px++
        for (; px < xEnd; px += 2) {
          g.fillRect(px, py, 1, 1)
        }
      }

      // all road lines stop short of the horizon; segments crossing that
      // boundary get their line trapezoids clipped at it
      const edgeTopY = HORIZON_Y + 1
      if (by > edgeTopY) {
        let ey2 = sy2
        let ex2 = sx2
        let esw2 = sw2
        if (ey2 < edgeTopY) {
          const t = (edgeTopY - sy2) / (by - sy2)
          ey2 = edgeTopY
          ex2 = lerp(sx2, bx, t)
          esw2 = lerp(sw2, bw, t)
        }
        const ew1 = Math.max(2, bw * 0.195)
        const ew2 = Math.max(2, esw2 * 0.195)
        g.fillStyle(band ? COLORS.edge : COLORS.edgeAlt)
        g.fillPoints(
          [
            { x: bx - bw, y: by },
            { x: bx - bw + ew1, y: by },
            { x: ex2 - esw2 + ew2, y: ey2 },
            { x: ex2 - esw2, y: ey2 },
          ],
          true,
        )
        g.fillPoints(
          [
            { x: bx + bw - ew1, y: by },
            { x: bx + bw, y: by },
            { x: ex2 + esw2, y: ey2 },
            { x: ex2 + esw2 - ew2, y: ey2 },
          ],
          true,
        )

        // dashed dividers between the lanes (LANES - 1 lines), drawn on the
        // plain (non-dithered) bands
        if (band === 1 && sw2 > 4) {
          const mw1 = Math.max(0.7, bw * 0.05)
          const mw2 = Math.max(0.7, esw2 * 0.05)
          g.fillStyle(COLORS.marking)
          for (let lane = 1; lane < LANES; lane++) {
            const f = (lane / LANES) * 2 - 1 // -0.5, 0, 0.5 for 4 lanes
            const lx1 = bx + f * bw
            const lx2 = ex2 + f * esw2
            g.fillPoints(
              [
                { x: lx1 - mw1, y: by },
                { x: lx1 + mw1, y: by },
                { x: lx2 + mw2, y: ey2 },
                { x: lx2 - mw2, y: ey2 },
              ],
              true,
            )
          }
        }
      }

      clipY = sy2
      if (clipY <= 0) break
    }
  }

  destroy() {
    this.sky.destroy()
    this.graphics.destroy()
  }
}

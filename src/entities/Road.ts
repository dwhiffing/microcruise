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

// one fixed-length slice of track. y1/y2 are world elevation at its near/far
// edge, curve is bend intensity (already eased along its section).
// bendX/clipY/frame are cached by draw() each frame so project() reuses the
// exact same sweep results instead of duplicating the math.
interface Segment {
  index: number
  y1: number
  y2: number
  curve: number
  bendX: number
  clipY: number
  frame: number
}

const easeIn = (a: number, b: number, p: number) => a + (b - a) * p * p
const easeInOut = (a: number, b: number, p: number) =>
  a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5)
const lerp = (a: number, b: number, p: number) => a + (b - a) * p

// a curved section sharp enough to warrant a turn-warning sign, with the
// world z where its bend begins (start of the ease-in) and its direction
export interface TurnWarning {
  z: number
  direction: -1 | 1
}

// curve magnitude (see addSection's tiers) above which a turn counts as
// "big" and gets warning signs placed before it
const BIG_TURN_THRESHOLD = 0.3

export class Road {
  private sky: Phaser.GameObjects.TileSprite
  private graphics: Phaser.GameObjects.Graphics
  private segments: Segment[] = []
  private firstIndex = 0
  private genY = 0
  private lastCurve = 0
  // big turns generated so far but not yet consumed by the caller
  private pendingTurns: TurnWarning[] = []
  // per-frame camera state, cached by draw() for project()
  private frame = 0
  private position = 0
  private camX = 0
  private camY = 0
  private lensCurve = 0

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
    this.position = 0
    this.pendingTurns = []
    this.sky.tilePositionX = 0
    for (let n = 0; n < 30; n++) this.pushSegment(0, this.genY, this.genY)
    this.update(0, 0)
  }

  // returns and clears any big-turn warnings generated since the last call
  drainTurnWarnings(): TurnWarning[] {
    const turns = this.pendingTurns
    this.pendingTurns = []
    return turns
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

  // lens bend: near rows bow outward with the current curve — strongest at
  // the bottom edge, fading toward the horizon — a cheap barrel distortion
  private lensAt(sy: number) {
    const t = Math.max(0, (sy - HORIZON_Y) / (GAME_HEIGHT - HORIZON_Y))
    return this.lensCurve * LENS_BEND * t * t
  }

  // project a world-space point onto the screen, for any road-relative
  // object (props, traffic, ...). z: absolute distance along the track.
  // laneOffset: -1..1 across the road (same convention as playerX).
  // groundHeight: extra world-y above the road surface. Reads the segment
  // projection draw() cached this frame, so objects sit exactly on the road
  // surface; visible goes false behind the camera, past the draw distance,
  // or hidden behind a nearer crest.
  project(
    z: number,
    laneOffset: number,
    groundHeight = 0,
  ): { screenX: number; screenY: number; scale: number; visible: boolean } {
    const objZ = z - this.position
    const seg = this.segmentAt(z)
    if (objZ <= 1 || objZ >= DRAW_SEGMENTS * SEGMENT_LENGTH || seg.frame !== this.frame) {
      return { screenX: 0, screenY: 0, scale: 0, visible: false }
    }

    const next = this.segments[seg.index - this.firstIndex + 1]
    const t = (z - seg.index * SEGMENT_LENGTH) / SEGMENT_LENGTH
    const bendX = next?.frame === this.frame ? lerp(seg.bendX, next.bendX, t) : seg.bendX
    const objCx = bendX - this.camX + laneOffset * ROAD_WIDTH
    const objY = lerp(seg.y1, seg.y2, t) + groundHeight

    const scale = CAMERA_DEPTH / objZ
    const screenY = HORIZON_Y - scale * (objY - this.camY) * (GAME_HEIGHT / 2)
    const screenX = GAME_WIDTH / 2 + scale * objCx * (GAME_WIDTH / 2) + this.lensAt(screenY)
    return { screenX, screenY, scale, visible: screenY < seg.clipY }
  }

  update(position: number, playerX: number) {
    // parallax: following a right-hand curve slides the scenery left,
    // proportional to ground actually covered this frame
    this.sky.tilePositionX +=
      this.curveAt(position + PLAYER_Z) * (position - this.position) * SKY_PARALLAX

    // generate well beyond the draw distance so upcoming turns get flagged
    // early enough for their warning signs to spawn beyond the horizon
    // instead of popping in near the camera
    const baseIndex = Math.floor(position / SEGMENT_LENGTH)
    while (this.firstIndex + this.segments.length < baseIndex + DRAW_SEGMENTS + 130) {
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
      bendX: 0,
      clipY: GAME_HEIGHT,
      frame: -1,
    })
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
    } else if (Math.abs(this.lastCurve) >= BIG_TURN_THRESHOLD) {
      // this section is the curve itself (lastCurve was rolled during the
      // preceding straight); flag it if sharp enough to warrant a sign
      const z = (this.firstIndex + this.segments.length) * SEGMENT_LENGTH
      this.pendingTurns.push({ z, direction: this.lastCurve > 0 ? 1 : -1 })
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

  // filled trapezoid: near edge centred on x1 (half-width w1) at row y1,
  // far edge (x2, w2) at y2
  private quad(x1: number, w1: number, y1: number, x2: number, w2: number, y2: number) {
    this.graphics.fillPoints(
      [
        { x: x1 - w1, y: y1 },
        { x: x1 + w1, y: y1 },
        { x: x2 + w2, y: y2 },
        { x: x2 - w2, y: y2 },
      ],
      true,
    )
  }

  // checkerboard pixels of the current fill colour across [x0, x1) on row
  // py; each 1px rect sits fully inside the span so nothing leaks past edges
  private dither(py: number, x0: number, x1: number) {
    const end = Math.min(GAME_WIDTH, x1) - 1
    let px = Math.max(0, Math.ceil(x0))
    if ((px + py) & 1) px++
    for (; px <= end; px += 2) this.graphics.fillRect(px, py, 1, 1)
  }

  private draw(position: number, playerX: number) {
    const g = this.graphics
    g.clear()

    // cache this frame's camera state for project(); camera height tracks
    // the road under the player car
    const playerSeg = this.segmentAt(position + PLAYER_Z)
    const playerPercent = ((position + PLAYER_Z) % SEGMENT_LENGTH) / SEGMENT_LENGTH
    this.frame++
    this.position = position
    this.camX = playerX * ROAD_WIDTH
    this.camY = lerp(playerSeg.y1, playerSeg.y2, playerPercent) + CAMERA_HEIGHT
    this.lensCurve = this.curveAt(position + PLAYER_Z)

    const halfW = GAME_WIDTH / 2
    const halfH = GAME_HEIGHT / 2
    const baseIndex = Math.floor(position / SEGMENT_LENGTH)
    const baseSeg = this.segmentAt(position)
    const basePercent = (position % SEGMENT_LENGTH) / SEGMENT_LENGTH

    // fake-curve accumulator: world-x offset grows quadratically with depth
    let x = 0
    let dx = -(baseSeg.curve * CURVE_WORLD * basePercent)
    let clipY = GAME_HEIGHT

    for (let n = 0; n < DRAW_SEGMENTS; n++) {
      const seg = this.segments[baseIndex - this.firstIndex + n]
      if (!seg) break

      seg.bendX = x
      seg.clipY = clipY
      seg.frame = this.frame

      const z1 = seg.index * SEGMENT_LENGTH - position
      const z2 = z1 + SEGMENT_LENGTH
      const cx1 = x - this.camX
      const cx2 = x + dx - this.camX

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
      const sy1 = HORIZON_Y - scale1 * (y1c - this.camY) * halfH
      const sy2 = HORIZON_Y - scale2 * (seg.y2 - this.camY) * halfH
      const sx1 = halfW + scale1 * cx1c * halfW + this.lensAt(sy1)
      const sx2 = halfW + scale2 * cx2 * halfW + this.lensAt(sy2)
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

      // alt stripes are a 1px checkerboard of the alt colour over the base —
      // never solid. Rows just below the horizon dither on every band so the
      // far distance shows a constant pattern instead of shimmering stripes.
      const farDitherY = HORIZON_Y + 2
      const rowTop = Math.max(0, Math.round(sy2))
      const rowBottom = Math.min(GAME_HEIGHT, Math.round(by))
      const spanH = by - sy2

      g.fillStyle(COLORS.grass)
      g.fillRect(0, sy2, GAME_WIDTH, spanH)
      g.fillStyle(COLORS.grassAlt)
      for (let py = rowTop; py < rowBottom; py++) {
        if (!band || py < farDitherY) this.dither(py, 0, GAME_WIDTH)
      }

      g.fillStyle(COLORS.road)
      this.quad(bx, bw, by, sx2, sw2, sy2)
      g.fillStyle(COLORS.roadAlt)
      for (let py = rowTop; py < rowBottom; py++) {
        if (band && py >= farDitherY) continue
        // road centre/half-width at this row, along the trapezoid
        const t = spanH > 0 ? (py + 0.5 - sy2) / spanH : 0
        const rcx = lerp(sx2, bx, t)
        const rw = lerp(sw2, bw, t)
        this.dither(py, rcx - rw, rcx + rw)
      }

      // road lines fade out once the road is too small on screen to hold
      // them (anti-shimmer). Size-based rather than an absolute screen row,
      // so climbs — where the road rises above the flat-ground horizon —
      // still get their lines
      if (sw2 > 3) {
        const ew1 = Math.max(2, bw * 0.195) / 2
        const ew2 = Math.max(2, sw2 * 0.195) / 2
        g.fillStyle(band ? COLORS.edge : COLORS.edgeAlt)
        this.quad(bx - bw + ew1, ew1, by, sx2 - sw2 + ew2, ew2, sy2)
        this.quad(bx + bw - ew1, ew1, by, sx2 + sw2 - ew2, ew2, sy2)

        // dashed dividers between the lanes (LANES - 1 lines), drawn on the
        // plain (non-dithered) bands
        if (band === 1 && sw2 > 4) {
          const mw1 = Math.max(0.7, bw * 0.05)
          const mw2 = Math.max(0.7, sw2 * 0.05)
          g.fillStyle(COLORS.marking)
          for (let lane = 1; lane < LANES; lane++) {
            const f = (lane / LANES) * 2 - 1 // -0.5, 0, 0.5 for 4 lanes
            this.quad(bx + f * bw, mw1, by, sx2 + f * sw2, mw2, sy2)
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

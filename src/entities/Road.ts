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
  PLAYER_Z,
  ROAD_WIDTH,
  RUMBLE_LENGTH,
  SEGMENT_LENGTH,
  SKY_PARALLAX,
} from '../constants'
import { Track, TurnWarning } from './Track'

const lerp = (a: number, b: number, p: number) => a + (b - a) * p

// one segment's on-screen trapezoid: edge centre x, half-width, and screen
// row for the near and far edges, plus which rumble band it belongs to
// (band 0 = dithered stripe, band 1 = plain)
interface SegQuad {
  nearX: number
  nearW: number
  nearY: number
  farX: number
  farW: number
  farY: number
  band: number
}

// renders the track as a pseudo-3D road: sweeps the visible segments each
// frame into filled trapezoids, scrolls the sky, and projects world-space
// points onto the screen for road-relative objects. Track generation and
// curve/slope queries live in Track; Road forwards the ones callers need.
export class Road {
  private sky: Phaser.GameObjects.TileSprite
  private graphics: Phaser.GameObjects.Graphics
  private track = new Track()
  // per-frame camera state, cached by draw() for project()
  private frame = 0
  private position = 0
  private camX = 0
  private camY = 0

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
    this.track.reset()
    this.position = 0
    this.sky.tilePositionX = 0
    this.update(0, 0)
  }

  curveAt(z: number): number {
    return this.track.curveAt(z)
  }

  slopeAt(z: number): number {
    return this.track.slopeAt(z)
  }

  drainTurnWarnings(): TurnWarning[] {
    return this.track.drainTurnWarnings()
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
    const seg = this.track.segmentAt(z)
    if (
      objZ <= 1 ||
      objZ >= DRAW_SEGMENTS * SEGMENT_LENGTH ||
      seg.frame !== this.frame
    ) {
      return { screenX: 0, screenY: 0, scale: 0, visible: false }
    }

    const next = this.track.at(seg.index + 1)
    const t = (z - seg.index * SEGMENT_LENGTH) / SEGMENT_LENGTH
    const bendX =
      next?.frame === this.frame ? lerp(seg.bendX, next.bendX, t) : seg.bendX
    const objCx = bendX - this.camX + laneOffset * ROAD_WIDTH
    const objY = lerp(seg.y1, seg.y2, t) + groundHeight

    const scale = CAMERA_DEPTH / objZ
    const screenY = HORIZON_Y - scale * (objY - this.camY) * (GAME_HEIGHT / 2)
    const screenX = GAME_WIDTH / 2 + scale * objCx * (GAME_WIDTH / 2)
    return { screenX, screenY, scale, visible: screenY < seg.clipY }
  }

  update(position: number, playerX: number) {
    // parallax: following a right-hand curve slides the scenery left,
    // proportional to ground actually covered this frame
    this.sky.tilePositionX +=
      this.track.curveAt(position + PLAYER_Z) *
      (position - this.position) *
      SKY_PARALLAX

    this.track.update(Math.floor(position / SEGMENT_LENGTH))
    this.draw(position, playerX)
  }

  // filled trapezoid: near edge centred on x1 (half-width w1) at row y1,
  // far edge (x2, w2) at y2
  private quad(
    x1: number,
    w1: number,
    y1: number,
    x2: number,
    w2: number,
    y2: number,
  ) {
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

  // cache this frame's camera state for project(); camera height tracks
  // the road under the player car
  private beginFrame(position: number, playerX: number) {
    const playerSeg = this.track.segmentAt(position + PLAYER_Z)
    const playerPercent =
      ((position + PLAYER_Z) % SEGMENT_LENGTH) / SEGMENT_LENGTH
    this.frame++
    this.position = position
    this.camX = playerX * ROAD_WIDTH
    this.camY = lerp(playerSeg.y1, playerSeg.y2, playerPercent) + CAMERA_HEIGHT
  }

  // sweep the visible segments front-to-back: accumulate the fake-curve
  // bend, project each segment's near/far edges, clip against nearer
  // crests, and hand every visible slice to drawSegment()
  private draw(position: number, playerX: number) {
    this.graphics.clear()
    this.beginFrame(position, playerX)

    const halfW = GAME_WIDTH / 2
    const halfH = GAME_HEIGHT / 2
    const baseIndex = Math.floor(position / SEGMENT_LENGTH)
    const baseSeg = this.track.segmentAt(position)
    const basePercent = (position % SEGMENT_LENGTH) / SEGMENT_LENGTH

    // fake-curve accumulator: world-x offset grows quadratically with depth
    let x = 0
    let dx = -(baseSeg.curve * CURVE_WORLD * basePercent)
    let clipY = GAME_HEIGHT

    for (let n = 0; n < DRAW_SEGMENTS; n++) {
      const seg = this.track.at(baseIndex + n)
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
      const sx1 = halfW + scale1 * cx1c * halfW
      const sx2 = halfW + scale2 * cx2 * halfW
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

      this.drawSegment({
        nearX: bx,
        nearW: bw,
        nearY: by,
        farX: sx2,
        farW: sw2,
        farY: sy2,
        band: Math.floor(seg.index / RUMBLE_LENGTH) % 2,
      })

      clipY = sy2
      if (clipY <= 0) break
    }
  }

  // paint one segment's slice of the frame: grass across the full width,
  // the road trapezoid on top, then edge/lane lines
  private drawSegment(q: SegQuad) {
    const g = this.graphics
    const { nearX, nearW, nearY, farX, farW, farY, band } = q

    // alt stripes are a 1px checkerboard of the alt colour over the base —
    // never solid. Rows just below the horizon dither on every band so the
    // far distance shows a constant pattern instead of shimmering stripes.
    const farDitherY = HORIZON_Y + 2
    const rowTop = Math.max(0, Math.round(farY))
    const rowBottom = Math.min(GAME_HEIGHT, Math.round(nearY))
    const spanH = nearY - farY

    g.fillStyle(COLORS.grass)
    g.fillRect(0, farY, GAME_WIDTH, spanH)
    g.fillStyle(COLORS.grassAlt)
    for (let py = rowTop; py < rowBottom; py++) {
      if (!band || py < farDitherY) this.dither(py, 0, GAME_WIDTH)
    }

    g.fillStyle(COLORS.road)
    this.quad(nearX, nearW, nearY, farX, farW, farY)
    g.fillStyle(COLORS.roadAlt)
    for (let py = rowTop; py < rowBottom; py++) {
      if (band && py >= farDitherY) continue
      // road centre/half-width at this row, along the trapezoid
      const t = spanH > 0 ? (py + 0.5 - farY) / spanH : 0
      const rcx = lerp(farX, nearX, t)
      const rw = lerp(farW, nearW, t)
      this.dither(py, rcx - rw, rcx + rw)
    }

    this.drawRoadLines(q)
  }

  // road lines fade out once the road is too small on screen to hold
  // them (anti-shimmer). Size-based rather than an absolute screen row,
  // so climbs — where the road rises above the flat-ground horizon —
  // still get their lines
  private drawRoadLines({ nearX, nearW, nearY, farX, farW, farY, band }: SegQuad) {
    if (farW <= 3) return
    const g = this.graphics

    const ew1 = Math.max(2, nearW * 0.195) / 2
    const ew2 = Math.max(2, farW * 0.195) / 2
    g.fillStyle(band ? COLORS.edge : COLORS.edgeAlt)
    this.quad(nearX - nearW + ew1, ew1, nearY, farX - farW + ew2, ew2, farY)
    this.quad(nearX + nearW - ew1, ew1, nearY, farX + farW - ew2, ew2, farY)

    // dashed dividers between the lanes (LANES - 1 lines), drawn on the
    // plain (non-dithered) bands
    if (band === 1 && farW > 4) {
      const mw1 = Math.max(0.7, nearW * 0.05)
      const mw2 = Math.max(0.7, farW * 0.05)
      g.fillStyle(COLORS.marking)
      for (let lane = 1; lane < LANES; lane++) {
        const f = (lane / LANES) * 2 - 1 // -0.5, 0, 0.5 for 4 lanes
        this.quad(nearX + f * nearW, mw1, nearY, farX + f * farW, mw2, farY)
      }
    }
  }

  destroy() {
    this.sky.destroy()
    this.graphics.destroy()
  }
}

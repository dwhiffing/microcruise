import {
  CAMERA_DEPTH,
  CAMERA_HEIGHT,
  COLORS,
  CURVE_WORLD,
  DAY_LENGTH,
  DRAW_SEGMENTS,
  GAME_HEIGHT,
  GAME_WIDTH,
  HORIZON_Y,
  LANES,
  PLAYER_Z,
  RUMBLE_LENGTH,
  SEGMENT_LENGTH,
  SKY_BG_FACTOR,
  SKY_PARALLAX,
  SKY_PHASES,
  STAR_FADE_EXP,
} from '../constants'
import { world } from '../world'
import { CoinRun, Track, TurnWarning } from './Track'

const lerp = (a: number, b: number, p: number) => a + (b - a) * p

export const lerpColor = (a: number, b: number, p: number) =>
  (Math.round(lerp((a >> 16) & 0xff, (b >> 16) & 0xff, p)) << 16) |
  (Math.round(lerp((a >> 8) & 0xff, (b >> 8) & 0xff, p)) << 8) |
  Math.round(lerp(a & 0xff, b & 0xff, p))

export const multiplyColor = (c: number, m: number) =>
  (Math.round((((c >> 16) & 0xff) * ((m >> 16) & 0xff)) / 255) << 16) |
  (Math.round((((c >> 8) & 0xff) * ((m >> 8) & 0xff)) / 255) << 8) |
  Math.round(((c & 0xff) * (m & 0xff)) / 255)

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

// slack (screen px) on the crest-occlusion test in project(). The margin
// between an on-road point's row and its clip line shrinks below float
// noise with distance, and is EXACTLY zero for points sitting on a
// segment boundary (coin runs start on one) — a strict comparison
// flickers far objects and permanently hides boundary-placed ones.
// Anything a quarter-pixel of slack wrongly reveals is within 0.25px of
// the terrain silhouette: invisible at this resolution
const OCCLUSION_SLACK = 0.25
// occlusion only applies to points at least this far (screen px) below
// the horizon row: everything nearer the horizon is always shown, so the
// distant dots clustered around it hold steady over rolling terrain
// instead of blinking behind every little crest
const OCCLUSION_MIN_DROP = 1

// renders the track as a pseudo-3D road: sweeps the visible segments each
// frame into filled trapezoids, scrolls the sky, and projects world-space
// points onto the screen for road-relative objects. Track generation and
// curve/slope queries live in Track; Road forwards the ones callers need.
export class Road {
  private scene: Phaser.Scene
  private stars: Phaser.GameObjects.TileSprite
  private skyBg: Phaser.GameObjects.TileSprite
  private skyFg: Phaser.GameObjects.TileSprite
  // level theming: the skyline sheet the level currently wants
  private skyFgTexture = 'sky-fg'
  private graphics: Phaser.GameObjects.Graphics
  private track = new Track()
  // seconds into the current day/night cycle
  private dayTime = 0
  // this frame's day/night multiply for everything that isn't sky; world
  // sprites (car, traffic, signs, checkpoints) read it after update()
  worldTint = 0xffffff
  // fired whenever worldTint changes, so the player car keeps in sync
  // even while gameplay is paused (e.g. the reset fast-forward)
  onWorldTint?: (tint: number) => void
  private dayTween?: Phaser.Tweens.Tween
  // the level's ground palette (COLORS with theme overrides blended in);
  // the day/night multiply applies on top of these each frame
  private baseColors = { ...COLORS }
  private colorTween?: Phaser.Tweens.Tween
  // baseColors with worldTint pre-multiplied in, used for the fills
  private palette = { ...COLORS }
  // per-frame camera state, cached by draw() for project()
  private frame = 0
  private position = 0
  private lastPlayerX = 0
  private camX = 0
  private camY = 0

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    // tile sprites wrap the 128px-wide art, so curves can parallax the sky
    // sideways indefinitely; the backdrop drifts slower than the skyline
    // silhouette in front of it
    const skyHeight = scene.textures.get('sky-bg').get(0).height
    // starfield sits behind the gradient and skyline, showing in the sky
    // revealed above them; it only fades in through the night phase
    // explicit depths below everything else (road graphics and every
    // RoadObject/car sit at depth >= 0): RoadObjects call setDepth every
    // frame, which forces a full display-list resort keyed only on
    // depth, so relying on add-order among depth-0 objects (the old
    // approach) breaks the moment anything else calls setDepth
    this.stars = scene.add
      .tileSprite(0, 0, GAME_WIDTH, skyHeight, 'stars')
      .setOrigin(0, 0)
      .setAlpha(0)
      .setDepth(-3)
    this.skyBg = scene.add
      .tileSprite(0, 0, GAME_WIDTH, skyHeight, 'sky-bg')
      .setOrigin(0, 0)
      .setDepth(-2)
    this.skyFg = scene.add
      .tileSprite(0, 0, GAME_WIDTH, skyHeight, 'sky-fg')
      .setOrigin(0, 0)
      .setDepth(-1)

    this.graphics = scene.add.graphics()
    this.reset()
  }

  reset() {
    this.track.reset()
    this.position = 0
    // day time isn't touched here: the post-game-over cruise has already
    // rolled it to sunrise (and it stays frozen while the menu is parked)
    this.dayTween?.stop()
    this.stars.tilePositionX = 0
    this.skyBg.tilePositionX = 0
    this.skyFg.tilePositionX = 0
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

  drainCoinRuns(): CoinRun[] {
    return this.track.drainCoinRuns()
  }

  // level theming: blend the ground palette toward the level's colours
  // (unlisted keys return to the base COLORS) over `duration` ms — the
  // terrain sweeps from grass to sand to snow instead of snapping
  setLevelColors(target: Partial<typeof COLORS>, duration = 2000) {
    this.colorTween?.stop()
    const from = { ...this.baseColors }
    const to = { ...COLORS, ...target }
    if (duration <= 0) {
      this.baseColors = to
      this.updateDayCycle()
      return
    }
    this.colorTween = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: (tween) => {
        const p = tween.getValue() ?? 1
        for (const key of Object.keys(COLORS) as (keyof typeof COLORS)[]) {
          this.baseColors[key] = lerpColor(from[key], to[key], p)
        }
      },
    })
  }

  // level theming: swap the skyline silhouette to the level's sheet —
  // the old one slides down out of view (behind the road), then the new
  // one slides up into place from below, rather than crossfading
  setSkyline(texture: string, duration = 8000) {
    if (this.skyFgTexture === texture) return
    this.skyFgTexture = texture
    this.scene.tweens.killTweensOf(this.skyFg)
    if (duration <= 0) {
      this.skyFg.setTexture(texture)
      this.skyFg.y = 0
      return
    }
    const dropY = this.skyFg.height - 21
    this.scene.tweens.add({
      targets: this.skyFg,
      y: dropY,
      duration: duration / 2,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this.skyFg.setTexture(texture)
        this.scene.tweens.add({
          targets: this.skyFg,
          y: 0,
          duration: duration / 2,
          ease: 'Sine.easeInOut',
        })
      },
    })
  }

  // level progression: reshape how upcoming track generates (bend
  // sharpness/frequency, straight lengths); already-laid road is kept
  setGenProfile(profile: {
    turnStrength: number
    curveChance: number
    straightLen: [number, number]
  }) {
    this.track.profile = {
      turnStrength: profile.turnStrength,
      curveChance: profile.curveChance,
      straightLen: profile.straightLen,
    }
  }

  // replace the road beyond the draw distance with a straightaway; returns
  // the z where it becomes fully straight
  straightenAhead(): number {
    return this.track.straightenFrom(Math.floor(this.position / SEGMENT_LENGTH))
  }

  // roll the clock to sunrise over `duration` ms, whichever direction is
  // shorter. Runs during the post-game-over cruise, which redraws the
  // world every frame, so the palette sweep renders as it goes
  resetDayCycle(duration = 1000) {
    // scroll each sky layer back to its home alignment over the same
    // ride — to the nearest tile wrap, so it's a short drift, and the
    // snap-to-0 in reset() lands on an identical-looking frame
    for (const layer of [this.skyFg, this.skyBg, this.stars]) {
      this.scene.tweens.killTweensOf(layer)
      const wrap = layer.frame.width
      this.scene.tweens.add({
        targets: layer,
        tilePositionX: Math.round(layer.tilePositionX / wrap) * wrap,
        duration,
        ease: 'Sine.easeInOut',
      })
    }

    this.dayTween?.stop()
    if (this.dayTime === 0) return
    this.dayTween = this.scene.tweens.addCounter({
      from: this.dayTime,
      to: this.dayTime < DAY_LENGTH / 2 ? 0 : DAY_LENGTH,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: (tween) => {
        this.dayTime = (tween.getValue() ?? 0) % DAY_LENGTH
        this.updateDayCycle()
        // repaint in place: if the camera has already parked (frozen for
        // the run intro), nothing else redraws the road's palette sweep
        this.draw(this.position, this.lastPlayerX)
      },
    })
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

    const halfW = GAME_WIDTH / 2
    const halfH = GAME_HEIGHT / 2
    const next = this.track.at(seg.index + 1)
    const t = (z - seg.index * SEGMENT_LENGTH) / SEGMENT_LENGTH
    const objY = lerp(seg.y1, seg.y2, t) + groundHeight

    const scale = CAMERA_DEPTH / objZ
    const screenY = HORIZON_Y - scale * (objY - this.camY) * halfH

    // x comes from interpolating along the drawn trapezoid's edges at the
    // object's screen row, NOT from true perspective. The road art is
    // linear in screen rows between segment edges; true projection in
    // between is not (on hills and curves), and the mismatch grows with
    // the camera's lateral offset — objects placed "correctly" slide
    // against the painted lanes whenever the player steers. Using the
    // art's own interpolation glues them to it by construction. The near
    // edge gets the same near-plane clamp as draw(), keeping the chord
    // identical to the one the quad was drawn with.
    const lane = laneOffset * world.roadWidth
    const farBendX = next?.frame === this.frame ? next.bendX : seg.bendX
    let z1 = seg.index * SEGMENT_LENGTH - this.position
    const z2 = z1 + SEGMENT_LENGTH
    let y1 = seg.y1
    let cx1 = seg.bendX - this.camX
    const cx2 = farBendX - this.camX
    if (z1 < 1) {
      const tc = (1 - z1) / (z2 - z1)
      y1 = lerp(seg.y1, seg.y2, tc)
      cx1 = lerp(cx1, cx2, tc)
      z1 = 1
    }
    const s1 = CAMERA_DEPTH / z1
    const s2 = CAMERA_DEPTH / z2
    const sy1 = HORIZON_Y - s1 * (y1 - this.camY) * halfH
    const sy2 = HORIZON_Y - s2 * (seg.y2 - this.camY) * halfH
    const sx1 = halfW + s1 * (cx1 + lane) * halfW
    const sx2 = halfW + s2 * (cx2 + lane) * halfW
    const tRow = sy2 === sy1 ? 1 : (screenY - sy1) / (sy2 - sy1)
    const screenX = lerp(sx1, sx2, tRow)

    return {
      screenX,
      screenY,
      scale,
      visible:
        screenY < HORIZON_Y + OCCLUSION_MIN_DROP ||
        screenY < seg.clipY + OCCLUSION_SLACK,
    }
  }

  update(position: number, playerX: number, dt = 0) {
    this.dayTime = (this.dayTime + dt) % DAY_LENGTH
    this.updateDayCycle()

    // parallax: following a right-hand curve slides the scenery left,
    // proportional to ground actually covered this frame
    const skyShift =
      this.track.curveAt(position + PLAYER_Z) *
      (position - this.position) *
      SKY_PARALLAX
    this.skyFg.tilePositionX += skyShift
    this.skyBg.tilePositionX += skyShift * SKY_BG_FACTOR
    this.stars.tilePositionX += skyShift * SKY_BG_FACTOR

    this.track.update(Math.floor(position / SEGMENT_LENGTH))
    this.lastPlayerX = playerX
    this.draw(position, playerX)
  }

  // blend the sky backdrop's tint, its downward slide, and the game
  // background colour between the current phase and the next; night wraps
  // back into sunrise
  private updateDayCycle() {
    const t = (this.dayTime / DAY_LENGTH) * SKY_PHASES.length
    const fromIndex = Math.floor(t) % SKY_PHASES.length
    const toIndex = Math.ceil(t) % SKY_PHASES.length
    const from = SKY_PHASES[fromIndex]
    const to = SKY_PHASES[toIndex]
    const p = t - Math.floor(t)

    // stars fade in on the approach to the night phase (the last entry)
    // and back out as it hands over to sunrise
    const night = SKY_PHASES.length - 1
    const starBlend = fromIndex === night ? 1 - p : toIndex === night ? p : 0
    this.stars.setAlpha(Math.pow(starBlend, STAR_FADE_EXP))
    this.skyBg.setTint(lerpColor(from.tint, to.tint, p))
    this.skyFg.setTint(lerpColor(from.tint, to.tint, p))
    this.skyBg.y = lerp(from.drop, to.drop, p)
    this.scene.cameras.main.setBackgroundColor(lerpColor(from.bg, to.bg, p))
    this.worldTint = lerpColor(from.world, to.world, p)
    for (const key of Object.keys(COLORS) as (keyof typeof COLORS)[]) {
      this.palette[key] = multiplyColor(this.baseColors[key], this.worldTint)
    }
    this.onWorldTint?.(this.worldTint)
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
    this.camX = playerX * world.roadWidth
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
      const sw1 = scale1 * world.roadWidth * halfW
      const sw2 = scale2 * world.roadWidth * halfW

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

    g.fillStyle(this.palette.grass)
    g.fillRect(0, farY, GAME_WIDTH, spanH)
    g.fillStyle(this.palette.grassAlt)
    for (let py = rowTop; py < rowBottom; py++) {
      if (!band || py < farDitherY) this.dither(py, 0, GAME_WIDTH)
    }

    g.fillStyle(this.palette.road)
    this.quad(nearX, nearW, nearY, farX, farW, farY)
    g.fillStyle(this.palette.roadAlt)
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
  private drawRoadLines({
    nearX,
    nearW,
    nearY,
    farX,
    farW,
    farY,
    band,
  }: SegQuad) {
    if (farW <= 3) return
    const g = this.graphics

    // the bumpers sit outside the road edges, adding to the drivable
    // width instead of eating into it
    const ew1 = Math.max(2, nearW * 0.195) / 2
    const ew2 = Math.max(2, farW * 0.195) / 2
    g.fillStyle(band ? this.palette.edge : this.palette.edgeAlt)
    this.quad(nearX - nearW - ew1, ew1, nearY, farX - farW - ew2, ew2, farY)
    this.quad(nearX + nearW + ew1, ew1, nearY, farX + farW + ew2, ew2, farY)

    // dashed dividers between the lanes (LANES - 1 lines), drawn on the
    // plain (non-dithered) bands. Rasterized row by row with coverage
    // alpha on the fractional edges, so the thin lines blend against the
    // road instead of popping whole pixel columns as they recede
    if (band === 1 && farW > 4) {
      const mw1 = Math.max(0.5, nearW * 0.03)
      const mw2 = Math.max(0.5, farW * 0.03)
      const rowTop = Math.max(0, Math.round(farY))
      const rowBottom = Math.min(GAME_HEIGHT, Math.round(nearY))
      const spanH = nearY - farY
      for (let lane = 1; lane < LANES; lane++) {
        const f = (lane / LANES) * 2 - 1 // -0.5, 0, 0.5 for 4 lanes
        for (let py = rowTop; py < rowBottom; py++) {
          const t = spanH > 0 ? (py + 0.5 - farY) / spanH : 0
          const cx = lerp(farX + f * farW, nearX + f * nearW, t)
          const w = lerp(mw2, mw1, t)
          this.hspanAA(py, cx - w, cx + w, this.palette.marking)
        }
      }
    }
  }

  // fill [x0, x1) on row py, with partially covered edge pixels drawn at
  // matching alpha — 1D antialiasing for lines thinner than ~2px
  private hspanAA(py: number, x0: number, x1: number, color: number) {
    const g = this.graphics
    for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
      const cov = Math.min(x1, px + 1) - Math.max(x0, px)
      // contrast-boosted coverage: fringes under ~30% vanish and over
      // ~70% go solid, keeping the line crisp with just enough blending
      // to stop the column-popping
      const alpha = Math.min(1, Math.max(0, (cov - 0.3) / 0.4))
      if (alpha <= 0) continue
      g.fillStyle(color, alpha)
      g.fillRect(px, py, 1, 1)
    }
    g.fillStyle(color, 1)
  }

  destroy() {
    this.stars.destroy()
    this.skyBg.destroy()
    this.skyFg.destroy()
    this.graphics.destroy()
  }
}

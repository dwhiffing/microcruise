import {
  GAME_HEIGHT,
  GAME_WIDTH,
  HORIZON_Y,
  SPEED_LINE_ALPHA,
  SPEED_LINE_COUNT,
  SPEED_LINE_FADE,
  SPEED_LINE_HOLE,
  SPEED_LINE_MAX_LEN,
  SPEED_LINE_MIN_LEN,
  SPEED_LINE_RADIAL,
  SPEED_LINE_Y_OFFSET,
  VIGNETTE_ALPHA,
  VIGNETTE_COLOR,
  VIGNETTE_START,
} from '../constants'

// the streaks converge on the road's vanishing point (nudged by the
// tweakable offset)
const CENTER_X = GAME_WIDTH / 2
const CENTER_Y = HORIZON_Y + SPEED_LINE_Y_OFFSET
// past this radius a streak's inner tip has cleared every screen corner
const MAX_RADIUS = Math.ceil(
  Math.max(
    Math.hypot(CENTER_X, CENTER_Y),
    Math.hypot(GAME_WIDTH - CENTER_X, CENTER_Y),
    Math.hypot(CENTER_X, GAME_HEIGHT - CENTER_Y),
    Math.hypot(GAME_WIDTH - CENTER_X, GAME_HEIGHT - CENTER_Y),
  ),
)
// the vignette is baked once into this canvas texture as a true radial
// gradient (per-frame ring strokes overlapped and left blotchy seams)
const VIGNETTE_KEY = 'nitro-vignette'

// one streak: a bearing out of the centre, how far along it the inner
// tip has flown, its base length, and its own flight speed
interface Line {
  angle: number
  dist: number
  len: number
  speed: number
}

// anime-style speed effect while nitro burns: translucent white streaks
// pointing at the road's vanishing point and flying outward past the
// camera, over a smooth vignette darkening toward the edges around the
// same point. Above everything else (HUD included, vignette below
// lines); intensity eases in and out so the effect never pops
export class SpeedLines {
  private vignette: Phaser.GameObjects.Image
  private gfx: Phaser.GameObjects.Graphics
  private lines: Line[] = []
  private intensity = 0

  constructor(scene: Phaser.Scene) {
    if (!scene.textures.exists(VIGNETTE_KEY)) {
      const canvas = scene.textures.createCanvas(
        VIGNETTE_KEY,
        GAME_WIDTH,
        GAME_HEIGHT,
      )!
      const ctx = canvas.context
      const grad = ctx.createRadialGradient(
        CENTER_X,
        CENTER_Y,
        VIGNETTE_START,
        CENTER_X,
        CENTER_Y,
        MAX_RADIUS,
      )
      const r = (VIGNETTE_COLOR >> 16) & 0xff
      const g = (VIGNETTE_COLOR >> 8) & 0xff
      const b = VIGNETTE_COLOR & 0xff
      grad.addColorStop(0, `rgba(${r},${g},${b},0)`)
      grad.addColorStop(1, `rgba(${r},${g},${b},${VIGNETTE_ALPHA})`)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)
      canvas.refresh()
    }
    this.vignette = scene.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, VIGNETTE_KEY)
      .setDepth(11)
      .setAlpha(0)
    this.gfx = scene.add.graphics().setDepth(12)
    for (let i = 0; i < SPEED_LINE_COUNT; i++) this.lines.push(this.roll(true))
  }

  // a fresh streak on a random bearing, starting at the dead zone's rim;
  // scattered part-way along its flight at construction so the first
  // frame isn't a synchronized ring
  private roll(scatter = false): Line {
    return {
      angle: Math.random() * Math.PI * 2,
      dist: SPEED_LINE_HOLE + (scatter ? Math.random() * MAX_RADIUS : 0),
      len:
        SPEED_LINE_MIN_LEN +
        Math.random() * (SPEED_LINE_MAX_LEN - SPEED_LINE_MIN_LEN),
      speed: SPEED_LINE_RADIAL * (0.7 + Math.random() * 0.6),
    }
  }

  update(dt: number, active: boolean) {
    // ease the whole overlay's strength toward on/off
    const step = SPEED_LINE_FADE > 0 ? dt / SPEED_LINE_FADE : 1
    this.intensity = active
      ? Math.min(1, this.intensity + step)
      : Math.max(0, this.intensity - step)

    this.gfx.clear()
    // the vignette texture already carries the gradient and its peak
    // alpha — the whole image just fades with the effect
    this.vignette.setAlpha(this.intensity)
    if (this.intensity <= 0) return

    for (const line of this.lines) {
      line.dist += line.speed * dt
      if (line.dist > MAX_RADIUS) Object.assign(line, this.roll())
      // perspective: a streak stretches as it flies out toward the edge
      const len = line.len * (0.35 + (0.65 * line.dist) / MAX_RADIUS)
      const cos = Math.cos(line.angle)
      const sin = Math.sin(line.angle)
      this.gfx.lineStyle(1, 0xffffff, SPEED_LINE_ALPHA * this.intensity)
      this.gfx.lineBetween(
        CENTER_X + cos * line.dist,
        CENTER_Y + sin * line.dist,
        CENTER_X + cos * (line.dist + len),
        CENTER_Y + sin * (line.dist + len),
      )
    }
  }

  destroy() {
    this.gfx.destroy()
    this.vignette.destroy()
  }
}

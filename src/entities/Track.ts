import { DRAW_SEGMENTS, GAME_HEIGHT, SEGMENT_LENGTH } from '../constants'

// one fixed-length slice of track. y1/y2 are world elevation at its near/far
// edge, curve is bend intensity (already eased along its section).
// bendX/clipY/frame are cached by Road.draw() each frame so project() reuses
// the exact same sweep results instead of duplicating the math.
export interface Segment {
  index: number
  y1: number
  y2: number
  curve: number
  bendX: number
  clipY: number
  frame: number
}

// a curved section sharp enough to warrant a turn-warning sign, with the
// world z where its bend begins (start of the ease-in) and its direction
export interface TurnWarning {
  z: number
  direction: -1 | 1
}

// curve magnitude (see addSection's tiers) above which a turn counts as
// "big" and gets warning signs placed before it
const BIG_TURN_THRESHOLD = 0.3

const easeIn = (a: number, b: number, p: number) => a + (b - a) * p * p
const easeInOut = (a: number, b: number, p: number) =>
  a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5)

// the world-space track: an endless, procedurally generated queue of
// fixed-length segments. Owns generation and curve/slope/segment queries;
// Road owns turning them into pixels.
export class Track {
  segments: Segment[] = []
  private firstIndex = 0
  private genY = 0
  private lastCurve = 0
  // big turns generated so far but not yet consumed by the caller
  private pendingTurns: TurnWarning[] = []

  constructor() {
    this.reset()
  }

  reset() {
    this.segments = []
    this.firstIndex = 0
    this.genY = 0
    this.lastCurve = 0
    this.pendingTurns = []
    // a long, flat opening straightaway before the generator takes over
    for (let n = 0; n < 75; n++) this.pushSegment(0, this.genY, this.genY)
  }

  // generate well beyond the draw distance so upcoming turns get flagged
  // early enough for their warning signs to spawn beyond the horizon
  // instead of popping in near the camera; cull segments left behind
  update(baseIndex: number) {
    while (
      this.firstIndex + this.segments.length <
      baseIndex + DRAW_SEGMENTS + 130
    ) {
      this.addSection()
    }
    while (this.segments.length && this.segments[0].index < baseIndex - 2) {
      this.segments.shift()
      this.firstIndex++
    }
  }

  // returns and clears any big-turn warnings generated since the last call
  drainTurnWarnings(): TurnWarning[] {
    const turns = this.pendingTurns
    this.pendingTurns = []
    return turns
  }

  // segment by absolute index (undefined once outside the queue)
  at(index: number): Segment | undefined {
    return this.segments[index - this.firstIndex]
  }

  segmentAt(z: number): Segment {
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
    // curved and straight sections alternate: after a zero-curve section,
    // this one bends
    let curve = 0
    const isCurve = this.lastCurve === 0
    if (isCurve) {
      // curve sharpness: 50% gentle, 25% medium, 25% sharp
      const roll = Math.random()
      const [lo, hi] =
        roll < 0.5 ? [0.1, 0.2] : roll < 0.75 ? [0.2, 0.4] : [0.4, 0.7]
      curve = (Math.random() < 0.5 ? -1 : 1) * (lo + Math.random() * (hi - lo))
      if (Math.abs(curve) >= BIG_TURN_THRESHOLD) {
        // sharp enough for warning signs: flag where the bend begins
        const z = (this.firstIndex + this.segments.length) * SEGMENT_LENGTH
        this.pendingTurns.push({ z, direction: curve > 0 ? 1 : -1 })
      }
    }
    this.lastCurve = curve

    const hill =
      Math.random() < 0.6
        ? (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 50)
        : 0

    // straights run long and plain; curves ease in, hold, and ease out
    const enter = isCurve ? 8 + Math.floor(Math.random() * 10) : 0
    const hold = isCurve
      ? 16 + Math.floor(Math.random() * 18)
      : 30 + Math.floor(Math.random() * 40)
    const leave = isCurve ? 8 + Math.floor(Math.random() * 10) : 0
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
}

import {
  DRAW_SEGMENTS,
  FORCE_UPHILL,
  GAME_HEIGHT,
  RUMBLE_LENGTH,
  SEGMENT_LENGTH,
} from '../constants'

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

// a curved section chosen to carry coins: where its bend begins and how
// long it runs, so the scene can spread a run of coins through it
export interface CoinRun {
  z: number
  length: number
}

// curve magnitude (see addSection's tiers) above which a turn counts as
// "big": it gets warning signs placed before it and a run of coins
// spread through it
const BIG_TURN_THRESHOLD = 0.3

const easeIn = (a: number, b: number, p: number) => a + (b - a) * p * p
const easeInOut = (a: number, b: number, p: number) =>
  a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5)

// the world-space track: an endless, procedurally generated queue of
// fixed-length segments. Owns generation and curve/slope/segment queries;
// Road owns turning them into pixels.
export class Track {
  segments: Segment[] = []
  // level-driven generation profile: how sharp bends are, how often an
  // eligible section bends at all, and how long straights run. Applies
  // to newly generated track only — the road already laid is untouched
  profile = {
    turnStrength: 1,
    curveChance: 1,
    straightLen: [30, 70] as [number, number],
  }
  private firstIndex = 0
  private genY = 0
  private lastCurve = 0
  // big turns generated so far but not yet consumed by the caller
  private pendingTurns: TurnWarning[] = []
  // coin-carrying turns generated but not yet consumed
  private pendingCoinRuns: CoinRun[] = []

  constructor() {
    this.reset()
  }

  reset() {
    this.segments = []
    this.firstIndex = 0
    this.genY = 0
    this.lastCurve = 0
    this.pendingTurns = []
    this.pendingCoinRuns = []
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

  // swap everything beyond the draw distance for a straightaway: the
  // visible road is untouched, any curve eases out right past it, then the
  // road runs straight and flat. Returns the z where it's fully straight.
  // update() resumes random generation beyond the straight stretch.
  straightenFrom(baseIndex: number): number {
    const keep = baseIndex + DRAW_SEGMENTS + 1 - this.firstIndex
    if (keep < this.segments.length) this.segments.length = keep
    const last = this.segments[this.segments.length - 1]
    const ease = 12
    const y = last.y2
    for (let n = 0; n < ease; n++) {
      this.pushSegment(easeInOut(last.curve, 0, (n + 1) / ease), y, y)
    }
    for (let n = 0; n < 75; n++) this.pushSegment(0, y, y)
    this.genY = y
    this.lastCurve = 0
    // drop warnings and coin runs for turns that were cut away
    const cutZ = (last.index + 1) * SEGMENT_LENGTH
    this.pendingTurns = this.pendingTurns.filter((turn) => turn.z < cutZ)
    this.pendingCoinRuns = this.pendingCoinRuns.filter((run) => run.z < cutZ)
    // aim the camera at a stripe-band boundary, so the view it parks on
    // matches a fresh track's opening view exactly
    const bandPeriod = RUMBLE_LENGTH * 2
    const straightStart =
      Math.ceil((last.index + 1 + ease) / bandPeriod) * bandPeriod
    return straightStart * SEGMENT_LENGTH
  }

  // returns and clears any big-turn warnings generated since the last call
  drainTurnWarnings(): TurnWarning[] {
    const turns = this.pendingTurns
    this.pendingTurns = []
    return turns
  }

  // returns and clears any coin-carrying turns generated since the last
  // call
  drainCoinRuns(): CoinRun[] {
    const runs = this.pendingCoinRuns
    this.pendingCoinRuns = []
    return runs
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
    // this one may bend (the profile's curveChance can keep it straight
    // instead, stringing straights together on low-frequency levels)
    let curve = 0
    const isCurve =
      this.lastCurve === 0 && Math.random() < this.profile.curveChance
    if (isCurve) {
      // curve sharpness: 50% gentle, 25% medium, 25% sharp, scaled by
      // the level's turn strength
      const roll = Math.random()
      const [lo, hi] =
        roll < 0.5 ? [0.1, 0.2] : roll < 0.75 ? [0.2, 0.4] : [0.4, 0.7]
      curve =
        (Math.random() < 0.5 ? -1 : 1) *
        (lo + Math.random() * (hi - lo)) *
        this.profile.turnStrength
      if (Math.abs(curve) >= BIG_TURN_THRESHOLD) {
        // sharp enough for warning signs: flag where the bend begins
        const z = (this.firstIndex + this.segments.length) * SEGMENT_LENGTH
        this.pendingTurns.push({ z, direction: curve > 0 ? 1 : -1 })
      }
    }
    this.lastCurve = curve

    const hill = FORCE_UPHILL
      ? 30 + Math.random() * 50
      : Math.random() < 0.6
        ? (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 50)
        : 0

    // straights run long and plain (length from the level's range);
    // curves ease in, hold, and ease out
    const [straightMin, straightMax] = this.profile.straightLen
    const enter = isCurve ? 8 + Math.floor(Math.random() * 10) : 0
    const hold = isCurve
      ? 16 + Math.floor(Math.random() * 18)
      : straightMin + Math.floor(Math.random() * (straightMax - straightMin))
    const leave = isCurve ? 8 + Math.floor(Math.random() * 10) : 0
    const total = enter + hold + leave

    // every big turn (the same sharpness that earns warning signs)
    // carries a run of coins spread through it
    if (Math.abs(curve) >= BIG_TURN_THRESHOLD) {
      this.pendingCoinRuns.push({
        z: (this.firstIndex + this.segments.length) * SEGMENT_LENGTH,
        length: total * SEGMENT_LENGTH,
      })
    }

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

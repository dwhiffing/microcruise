// PICO-8-style mobile controls: a dpad on the left and two round buttons
// on the right, drawn in a panel below the game. Touches dispatch
// synthetic keyboard events on window, so every existing input path —
// Phaser's Key objects, JustDown latches, the raw keydown menu handler —
// works exactly as if a keyboard were attached:
//   dpad -> arrow keys (steer, gear picker)
//   A (the X-style button, upper right) -> Z (gas / confirm)
//   B (the O-style button, lower left)  -> C (brake / drift)

type InputName = 'left' | 'right' | 'up' | 'down' | 'a' | 'b'

// a touch hit-box, as fractions of the control panel: x/w of its width,
// y/h of its height (0,0 = top left, 1,1 = bottom right)
interface AreaRect {
  x: number
  y: number
  w: number
  h: number
}

// ---- touch areas (the part you tune) -------------------------------
// One hit rectangle per input. A touch presses every input whose rect
// contains it, and sliding a held thumb between rects presses/releases
// as it goes. Rects are deliberately larger than the drawn controls —
// thumbs are imprecise — and may overlap where pressing both is fine.
// Set TOUCH_DEBUG (or visit with ?touchdebug=1) to see them on screen.
export const TOUCH_AREAS: Record<InputName, AreaRect> = {
  left: { x: 0.02, y: 0.14, w: 0.23, h: 0.64 },
  right: { x: 0.25, y: 0.14, w: 0.23, h: 0.64 },
  up: { x: 0.19, y: 0.02, w: 0.12, h: 0.34 },
  down: { x: 0.19, y: 0.56, w: 0.12, h: 0.34 },
  a: { x: 0.7, y: 0.06, w: 0.3, h: 0.5 },
  b: { x: 0.52, y: 0.4, w: 0.24, h: 0.4 },
}
// draw each touch area as a labelled translucent box, for tuning
export const TOUCH_DEBUG = false

// haptics: buzz this long (ms) whenever an input starts being pressed —
// press or slide-over, so handovers between areas are felt. Android
// only; iOS Safari has no vibration API and silently skips it
export const VIBRATE_MS = 12

// ---- visual layout --------------------------------------------------
// where the controls are drawn (independent of the hit rects, which
// should stay bigger). cx/cy are fractions of the panel's width/height;
// sizes are fractions of the panel's smaller dimension so the shapes
// stay round/square on any aspect
const DPAD = { cx: 0.25, cy: 0.46, size: 0.58, thickness: 0.2 }
const BUTTON_A = { cx: 0.85, cy: 0.29, d: 0.31 }
const BUTTON_B = { cx: 0.64, cy: 0.6, d: 0.31 }

// PICO-8-ish palette: dim outlines that brighten while pressed
const LINE = '#4c4c4c'
const LINE_ACTIVE = '#b4b4b4'
const FILL_ACTIVE = 'rgba(255,255,255,0.08)'
const STROKE_W = 2

// the synthetic key each input maps to. keyCode is what Phaser's Key
// objects match on; key is what the raw keydown menu handler reads
const KEY_FOR: Record<
  InputName,
  { key: string; code: string; keyCode: number }
> = {
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  a: { key: 'z', code: 'KeyZ', keyCode: 90 },
  b: { key: 'c', code: 'KeyC', keyCode: 67 },
}

const INPUTS = Object.keys(KEY_FOR) as InputName[]

// touch controls show on coarse-pointer devices; ?touch=1 forces them on
// (for desktop tuning with a mouse) and ?touch=0 forces them off
function touchEnabled(): boolean {
  const qs = new URLSearchParams(location.search)
  if (qs.has('touch')) return qs.get('touch') !== '0'
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
}

function debugEnabled(): boolean {
  return TOUCH_DEBUG || new URLSearchParams(location.search).has('touchdebug')
}

// KeyboardEvent constructors ignore keyCode, but Phaser matches keys by
// it — graft it on so the synthetic event is indistinguishable
function sendKey(type: 'keydown' | 'keyup', input: InputName) {
  const k = KEY_FOR[input]
  const ev = new KeyboardEvent(type, {
    key: k.key,
    code: k.code,
    bubbles: true,
  })
  Object.defineProperty(ev, 'keyCode', { get: () => k.keyCode })
  Object.defineProperty(ev, 'which', { get: () => k.keyCode })
  window.dispatchEvent(ev)
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value))
  }
  return node
}

function polygon(points: [number, number][]): string {
  return (
    points
      .map(
        ([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`,
      )
      .join(' ') + ' Z'
  )
}

// build the panel below the game, wire pointer events, and keep the
// drawn controls laid out to the panel's current size. Call before the
// Phaser game is created so the game container is measured post-layout
export function setupTouchControls() {
  if (!touchEnabled()) return

  // flips #app into the PICO-8 column layout (game top, controls below)
  document.body.classList.add('touch')

  const panel = document.createElement('div')
  panel.id = 'touch-controls'
  document.getElementById('app')!.appendChild(panel)
  const svg = el('svg')
  panel.appendChild(svg)

  // one path per drawn piece, restyled as inputs press/release
  const cross = el('path', { fill: 'none' })
  const tris: Record<'left' | 'right' | 'up' | 'down', SVGPathElement> = {
    left: el('path'),
    right: el('path'),
    up: el('path'),
    down: el('path'),
  }
  const ringA = el('circle', { fill: 'none' }) // button outline
  const glyphA = el('path', { fill: 'none' }) // the X
  const ringB = el('circle', { fill: 'none' })
  const glyphB = el('circle', { fill: 'none' }) // the O
  const pieces = [cross, ...Object.values(tris), ringA, glyphA, ringB, glyphB]
  for (const piece of pieces) {
    piece.setAttribute('stroke-width', String(STROKE_W))
    piece.setAttribute('stroke-linejoin', 'round')
    piece.setAttribute('stroke-linecap', 'round')
    svg.appendChild(piece)
  }
  const debugLayer = el('g')
  svg.appendChild(debugLayer)

  // (re)compute pixel geometry from the panel's size
  const layout = () => {
    const rect = panel.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    const m = Math.min(w, h)
    if (m <= 0) return
    svg.setAttribute('width', String(w))
    svg.setAttribute('height', String(h))
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)

    // dpad cross outline: half-extent e, half-thickness t
    const cx = DPAD.cx * w
    const cy = DPAD.cy * h
    const e = (DPAD.size * m) / 2
    const t = (DPAD.thickness * m) / 2
    cross.setAttribute(
      'd',
      polygon([
        [cx - e, cy - t],
        [cx - t, cy - t],
        [cx - t, cy - e],
        [cx + t, cy - e],
        [cx + t, cy - t],
        [cx + e, cy - t],
        [cx + e, cy + t],
        [cx + t, cy + t],
        [cx + t, cy + e],
        [cx - t, cy + e],
        [cx - t, cy + t],
        [cx - e, cy + t],
      ]),
    )
    // an outward-pointing triangle centred in each arm
    const dirs: Record<keyof typeof tris, [number, number]> = {
      left: [-1, 0],
      right: [1, 0],
      up: [0, -1],
      down: [0, 1],
    }
    const mid = (e + t) / 2
    const s = t * 0.55
    for (const [name, [dx, dy]] of Object.entries(dirs) as [
      keyof typeof tris,
      [number, number],
    ][]) {
      const mx = cx + dx * mid
      const my = cy + dy * mid
      tris[name].setAttribute(
        'd',
        polygon([
          [mx + dx * s, my + dy * s],
          [mx - dx * s - dy * s, my - dy * s - dx * s],
          [mx - dx * s + dy * s, my - dy * s + dx * s],
        ]),
      )
    }

    // buttons: A carries an X glyph, B an O glyph (icons only — A is
    // still gas and B still brake)
    const layoutButton = (
      spec: typeof BUTTON_A,
      ring: SVGCircleElement,
    ): { bx: number; by: number; r: number } => {
      const bx = spec.cx * w
      const by = spec.cy * h
      const r = (spec.d * m) / 2
      ring.setAttribute('cx', String(bx))
      ring.setAttribute('cy', String(by))
      ring.setAttribute('r', String(r))
      return { bx, by, r }
    }
    const a = layoutButton(BUTTON_A, ringA)
    const k = a.r * 0.42
    glyphA.setAttribute(
      'd',
      `M${a.bx - k} ${a.by - k} L${a.bx + k} ${a.by + k} ` +
        `M${a.bx - k} ${a.by + k} L${a.bx + k} ${a.by - k}`,
    )
    const b = layoutButton(BUTTON_B, ringB)
    glyphB.setAttribute('cx', String(b.bx))
    glyphB.setAttribute('cy', String(b.by))
    glyphB.setAttribute('r', String(b.r * 0.42))

    // tuning overlay: every hit rect, labelled
    debugLayer.replaceChildren()
    if (debugEnabled()) {
      INPUTS.forEach((input, i) => {
        const area = TOUCH_AREAS[input]
        const hue = (i * 60) % 360
        debugLayer.appendChild(
          el('rect', {
            x: area.x * w,
            y: area.y * h,
            width: area.w * w,
            height: area.h * h,
            fill: `hsla(${hue},80%,60%,0.15)`,
            stroke: `hsl(${hue},80%,60%)`,
          }),
        )
        const label = el('text', {
          x: area.x * w + 4,
          y: area.y * h + 14,
          fill: `hsl(${hue},80%,70%)`,
          'font-size': 12,
          'font-family': 'monospace',
        })
        label.textContent = input
        debugLayer.appendChild(label)
      })
    }
  }
  new ResizeObserver(layout).observe(panel)
  layout()

  // restyle the drawn controls to the currently pressed set
  const paint = (pressed: Set<InputName>) => {
    for (const name of ['left', 'right', 'up', 'down'] as const) {
      const on = pressed.has(name)
      tris[name].setAttribute('stroke', on ? LINE_ACTIVE : LINE)
      tris[name].setAttribute('fill', on ? LINE_ACTIVE : 'none')
    }
    cross.setAttribute('stroke', LINE)
    const buttons: [InputName, SVGElement[]][] = [
      ['a', [ringA, glyphA]],
      ['b', [ringB, glyphB]],
    ]
    for (const [name, parts] of buttons) {
      const on = pressed.has(name)
      for (const part of parts) {
        part.setAttribute('stroke', on ? LINE_ACTIVE : LINE)
      }
      parts[0].setAttribute('fill', on ? FILL_ACTIVE : 'none')
    }
  }
  paint(new Set())

  const hitTest = (fx: number, fy: number) =>
    INPUTS.filter((input) => {
      const a = TOUCH_AREAS[input]
      return fx >= a.x && fx < a.x + a.w && fy >= a.y && fy < a.y + a.h
    })

  // multi-touch state: every live contact's position and per-touch
  // flags, rebuilt into a pressed-input set on any change. Diffing old
  // vs new emits exactly one keydown/keyup per transition, and a thumb
  // sliding between areas hands over automatically — except onto
  // up/down, which only answer to a touch that began on them, and off a
  // button, which stays pinned (see below)
  interface Contact {
    x: number
    y: number
    startUp: boolean
    startDown: boolean
    // buttons this touch began on: held until the finger lifts, so a
    // thumb rolling off the art mid-hold (e.g. while another finger
    // taps the dpad) can't drop the input
    pinned: ('a' | 'b')[]
  }
  const contacts = new Map<number, Contact>()
  const makeContact = (x: number, y: number): Contact => {
    const rect = panel.getBoundingClientRect()
    const start = hitTest(
      (x - rect.left) / rect.width,
      (y - rect.top) / rect.height,
    )
    return {
      x,
      y,
      startUp: start.includes('up'),
      startDown: start.includes('down'),
      pinned: start.filter((i): i is 'a' | 'b' => i === 'a' || i === 'b'),
    }
  }
  let pressed = new Set<InputName>()
  const refresh = () => {
    const rect = panel.getBoundingClientRect()
    const now = new Set<InputName>()
    for (const p of contacts.values()) {
      const fx = (p.x - rect.left) / rect.width
      const fy = (p.y - rect.top) / rect.height
      let hits = hitTest(fx, fy)
      // up/down are deliberate presses only: they count just for the
      // touch that started on them, never for a thumb that slid in from
      // elsewhere (a shift mid-slide would be a surprise)
      hits = hits.filter(
        (input) =>
          (input !== 'up' || p.startUp) && (input !== 'down' || p.startDown),
      )
      // up/down win their overlap with left/right: a thumb on a vertical
      // arm shouldn't also steer (per touch, so another finger can still
      // hold a direction)
      if (hits.includes('up') || hits.includes('down')) {
        hits = hits.filter((input) => input !== 'left' && input !== 'right')
      }
      // buttons stay pinned to the touch that pressed them
      for (const pin of p.pinned) if (!hits.includes(pin)) hits.push(pin)
      for (const input of hits) now.add(input)
    }
    for (const input of now) {
      if (!pressed.has(input)) {
        sendKey('keydown', input)
        // haptics, currently disabled:
        // navigator.vibrate?.(VIBRATE_MS)
      }
    }
    for (const input of pressed) if (!now.has(input)) sendKey('keyup', input)
    pressed = now
    paint(pressed)
  }

  // touch input reads e.touches — the browser's authoritative list of
  // live contacts — instead of trusting pointerup/pointercancel
  // bookkeeping: under multi-touch (hold gas, tap the dpad) mobile
  // browsers occasionally mis-deliver pointer events for the HELD
  // finger, releasing it while it's still down. A contact here only
  // dies by leaving e.touches, which can't happen while the finger is
  // on the glass. preventDefault (allowed because the handler is
  // non-passive) also keeps every native touch behaviour — scrolling,
  // pinch recognizers, long-press menus and their Android haptic —
  // off the panel
  const MOUSE_ID = -1
  const syncTouches = (e: TouchEvent) => {
    e.preventDefault()
    if (e.type === 'touchstart') {
      for (const t of Array.from(e.changedTouches)) {
        contacts.set(t.identifier, makeContact(t.clientX, t.clientY))
      }
    }
    // reconcile against the live list: update positions, drop contacts
    // no longer present (lifted, cancelled — or their end event missed
    // entirely). Touches that began outside the panel were never added,
    // so they stay ignored here
    const live = new Map<number, Touch>()
    for (const t of Array.from(e.touches)) live.set(t.identifier, t)
    for (const [id, contact] of contacts) {
      if (id === MOUSE_ID) continue
      const t = live.get(id)
      if (t) {
        contact.x = t.clientX
        contact.y = t.clientY
      } else {
        contacts.delete(id)
      }
    }
    refresh()
  }
  for (const type of [
    'touchstart',
    'touchmove',
    'touchend',
    'touchcancel',
  ] as const) {
    panel.addEventListener(type, syncTouches, { passive: false })
  }

  // mouse path, for desktop tuning via ?touch=1. Touches never reach it:
  // their compatibility mouse events are suppressed by the
  // preventDefault above, and it filters on pointerType besides
  panel.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return
    // capture so drags keep reporting even when they leave the panel
    panel.setPointerCapture(e.pointerId)
    contacts.set(MOUSE_ID, makeContact(e.clientX, e.clientY))
    refresh()
  })
  panel.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return
    const contact = contacts.get(MOUSE_ID)
    if (!contact) return
    contact.x = e.clientX
    contact.y = e.clientY
    refresh()
  })
  const mouseUp = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    contacts.delete(MOUSE_ID)
    refresh()
  }
  panel.addEventListener('pointerup', mouseUp)
  panel.addEventListener('pointercancel', mouseUp)

  // long-press context menus would interrupt held inputs
  panel.addEventListener('contextmenu', (e) => e.preventDefault())
  // iOS Safari ignores user-scalable=no: keep its pinch-zoom recognizer
  // (which cancels held touches when it engages) off the panel
  panel.addEventListener('gesturestart', (e) => e.preventDefault())
  panel.addEventListener('gesturechange', (e) => e.preventDefault())
}

export const GAME_WIDTH = 64
export const GAME_HEIGHT = 64

// screen row the camera aims at (flat-road horizon)
export const HORIZON_Y = 26

// world-space track: fixed-length slices projected each frame
export const SEGMENT_LENGTH = 15
export const DRAW_SEGMENTS = 50

// camera sits this far above the road, looking level
export const CAMERA_HEIGHT = 25
// 1 / tan(fov / 2), fov ~= 100 degrees
export const CAMERA_DEPTH = 0.8
// depth of the player car plane in front of the camera
export const PLAYER_Z = CAMERA_HEIGHT * CAMERA_DEPTH

// the road's half-width is level-driven and lives in world.ts; lane-unit
// sizes below are authored at this reference width and multiplied by
// laneScale() at use, so physical sizes hold as the road narrows
export const LANES = 3
export const REFERENCE_ROAD_WIDTH = 60

// world-x bend added per segment^2 per unit of curve intensity
export const CURVE_WORLD = 2.6

// segments per light/dark stripe band
export const RUMBLE_LENGTH = 3

// sky px scrolled per world unit travelled through a full-intensity curve
export const SKY_PARALLAX = 0.025
// the far backdrop layer scrolls at this fraction of the skyline's rate
export const SKY_BG_FACTOR = 0.5

// day/night cycle: seconds for one full sunrise→noon→sunset→night loop
export const DAY_LENGTH = 180
// one entry per phase, blended smoothly into the next (night wraps back
// into sunrise): `tint` colours the sky backdrop, `bg` is the colour
// revealed above it (the game background), `drop` is how far down (px)
// the backdrop has slid by that phase, and `world` is multiplied over
// everything that isn't sky — road, grass, cars, signs, checkpoints
// (0xffffff = daylight, no change)
// stars fade with the blend into/out of the night phase, raised to this
// power — higher keeps them hugging the peak of night, 1 = linear
export const STAR_FADE_EXP = 5
export const SKY_PHASES = [
  // { tint: 0x90679c, bg: 0x7057BA, drop: 8, world: 0xe0ab8d }, // sunrise
  { tint: 0x7057ba, bg: 0x78408a, drop: 8, world: 0xa55eb5 }, // sunrise
  { tint: 0xffffff, bg: 0x4fa4f7, drop: 24, world: 0xffffff }, // noon
  { tint: 0xff7a4d, bg: 0x3a2b5f, drop: 8, world: 0xd98f75 }, // sunset
  { tint: 0x4a5a8e, bg: 0x0b0e2a, drop: 24, world: 0x55628f }, // night
]

export const MAX_SPEED = 650
// gears: each gear's top speed as a fraction of MAX_SPEED, and its
// acceleration multiplier on ACCEL — low gears pull hard but run out fast
export const GEAR_MAX = [0.18, 0.34, 0.5, 0.66, 0.83, 1]
export const GEAR_ACCEL = [1.2, 1.1, 0.9, 0.7, 0.5, 0.3]
// speed dragged off per second while above the gear's max, so downshifting
// doubles as a brake (RPM pegs at redline while it drags)
export const ENGINE_BRAKE = 400
// RPM bar reads (speed / gear max) ^ this exponent: revs drop to mid-band
// on an upshift and surge toward redline, like a real tach
export const RPM_CURVE = 3
// engine sound: one looping sample (a low-RPM on-throttle loop) is
// pitch-bent across the rev range — the playback rate slides between
// these bounds as the RPM bar goes 0 to redline
export const ENGINE_VOLUME = 0.1
export const ENGINE_RATE_MIN = 0.4
export const ENGINE_RATE_MAX = 0.7
// automatic transmission: shifts up at redline under throttle and back
// down as speed falls; up/down manual shifting is disabled while on
export const AUTO_SHIFT = true
// what MAX_SPEED reads as on the speedometer: the gauge always spans
// 0-215 mph no matter the internal top speed
export const TOP_SPEED_MPH = 215
// speed at which steering/centrifugal reach nominal strength; forces keep
// growing with real speed past it, so faster = harder to hold a curve
export const REFERENCE_SPEED = 300
export const ACCEL = 50
export const BRAKE = 300
// rolling start: the run begins at this speed (mph on the gauge) instead
// of from a standstill, so the car enters already moving
export const START_SPEED_MPH = 60
// nitro: held space bar multiplies the throttle's pull by this factor.
// It doesn't raise any gear's ceiling — the car just reaches its normal
// top speed faster
export const NITRO_ACCEL_FACTOR = 5
export const NITRO_LIFT = 4
export const NITRO_LIFT_RATE = 8
export const NITRO_SHAKE = 0.15
export const NITRO_PER_COIN_MS = 220
export const NITRO_MAX_MS = NITRO_PER_COIN_MS * 11
export const SPEED_LINE_COUNT = 20
export const SPEED_LINE_RADIAL = 90
export const SPEED_LINE_MIN_LEN = 12
export const SPEED_LINE_MAX_LEN = 18
export const SPEED_LINE_HOLE = 24
export const SPEED_LINE_ALPHA = 0.2
export const SPEED_LINE_FADE = 0.25
export const SPEED_LINE_Y_OFFSET = 10
export const VIGNETTE_START = 18
export const VIGNETTE_ALPHA = 0.8
export const VIGNETTE_COLOR = 0x000000
export const COAST_DECEL = 30
// with the clock at 0 the car drags itself down at this multiple of the
// normal coast deceleration (the taillights light while it does)
export const OUT_OF_TIME_DECEL_FACTOR = 3
export const OFFROAD_MAX_SPEED = 120
export const OFFROAD_DECEL = 150
export const OFFROAD_ACCEL_FACTOR = 0.75
// max camera jitter (px) while off-road at speed
export const OFFROAD_SHAKE = 0.2
// camera jitter (px) while the tires are smoking (launch/braking)
export const BURNOUT_SHAKE = 0.1
// no shake below this speed; full shake at twice it
export const OFFROAD_SHAKE_MIN_SPEED = 5

export const STEER_SPEED = 6
// fraction of the wheel's remaining travel covered per second while held:
// taps bite fast, then growth falls off approaching full lock (~63% of
// the way after 1/rate s, ~95% after 3/rate s)
export const STEER_RATE = 0.8
// how fast the wheel recenters when released
export const STEER_RETURN = 1.2
export const CENTRIFUGAL = 4.0
// speed lost per second per unit of gradient when climbing
export const SLOPE_DRAG = 120

// drifting: tap brake while at least this fast with the wheel turned at
// least this far to kick into a drift; while it lasts the engine only
// delivers DRIFT_ACCEL_FACTOR of its normal gear acceleration, and the
// centrifugal pull is scaled by DRIFT_GRIP — the car slides with the
// curve instead of being flung out, so drifts hold bends that are too
// fast to steer through normally
export const DRIFT_MIN_SPEED = 250
export const DRIFT_MIN_STEER = 0.01
export const DRIFT_ACCEL_FACTOR = 0.1
export const DRIFT_GRIP = 0.5
// a drift tolerates taps of countersteer: holding the opposite
// direction for this many continuous seconds ends it; going this long
// without pressing the drift direction (neutral or opposite) also ends
// it
export const DRIFT_COUNTERSTEER_TIME = 0.12
export const DRIFT_RELEASE_TIME = 0.4
// a drift never lasts longer than this many seconds
export const DRIFT_MAX_TIME = 2.4

// turn-warning chevrons: how many repeats lead into a big turn, how far
// apart they're spaced, and how far before the bend the first one sits
export const TURN_SIGN_REPEATS = 8
export const TURN_SIGN_GAP = 150
export const TURN_SIGN_LEAD = 600
// how far past the road edge (world units) the signs sit on the
// shoulder. Applied as a physical offset so the clearance holds as the
// road narrows between levels, rather than a fixed lane fraction that
// crowds the tarmac on the narrow desert/snow roads
export const TURN_SIGN_SHOULDER = 30

// floating coins: every big turn gets a run of COINS_PER_TURN coins
// spread evenly through the bend on a random lane. Each coin floats
// COIN_HOVER world units off the tarmac
export const COINS_PER_TURN = 6
export const COIN_WORLD_WIDTH = 20
export const COIN_HOVER = 2
// collection box, same convention as the collision boxes: length along
// the track and half-width in lane units, physically constant
export const COIN_COLLIDE_Z = 12
export const COIN_COLLIDE_LANE = 0.25

// debug: skip the 3-2-1 countdown and start driving as soon as the car
// pulls in
export const SKIP_COUNTDOWN = false
export const DEBUG_KEYS = SKIP_COUNTDOWN

// seconds on the countdown clock; reaching zero ends the run
export const RACE_TIME = 60
// score (distance / 100) caps here
export const MAX_SCORE = 9999
// checkpoints: seconds they award and the most the clock can hold (the
// display only has two digits). Spacing is level-driven (see LEVELS)
export const CHECKPOINT_BONUS = 15
export const MAX_TIME = 99
// health restored when crossing a checkpoint (100 = full repair)
export const CHECKPOINT_REPAIR = 100

// other cars cruising the road — how many is level-driven (see LEVELS).
// The wide speed spread means slow traffic to weave through and fast
// cars that come up from behind and overtake
export const TRAFFIC_MIN_SPEED = 150
export const TRAFFIC_MAX_SPEED = 550

// health: collisions drain it in proportion to impact speed — a hit at
// MAX_SPEED relative speed costs COLLISION_DAMAGE health (side swipes
// count half the car's speed as impact). Below 50% the car smokes, below
// 25% it burns too, and at 0 it explodes and the run ends.
export const MAX_HEALTH = 100
export const COLLISION_DAMAGE = 100
// seconds of invulnerability after a hit, so one crash (which can overlap
// the collision box for several frames) only costs damage once
export const DAMAGE_COOLDOWN = 0.5
// the tires scrub — skid marks and smoke — for this long after any impact
export const IMPACT_SKID_TIME = 0.5
// while on fire (health below BURN_THRESHOLD) the car bleeds this much
// health per second, and can burn out completely
export const BURN_THRESHOLD = 30
export const BURN_DPS = 1

// collision box around a car: length along the track (world units) and
// half-width across it (road-relative lane units, like playerX).
// laneScale() keeps the physical box size fixed as the road narrows
export const CAR_COLLIDE_Z = 15
export const CAR_COLLIDE_LANE = 0.3
// signs are narrow static posts, so a smaller box
export const SIGN_COLLIDE_Z = 10
export const SIGN_COLLIDE_LANE = 0.15
// world units a head-on hit parks the car back beyond the hitbox edge,
// so it sits fully clear instead of grinding on the boundary and
// re-triggering the crash every time the damage cooldown lapses
export const COLLIDE_CLEARANCE = 2

// while braking, these car-sprite colours are swapped (the taillights
// light up): [from, to] pairs baked into a recoloured copy of the sheet
export const BRAKE_LIGHT_SWAPS: [number, number][] = [
  [0xb42323, 0xff3b3b], // taillight red -> lit
  [0x6a1212, 0xb42323], // dark red shade -> brightens
]

// progression: the run advances one level every CHECKPOINTS_PER_LEVEL
// checkpoints, clamping at the last level. Each level reshapes the world
// — everything already on the road is untouched; new generation picks
// the values up (road width eases over instead of snapping)
export const CHECKPOINTS_PER_LEVEL = 5
export interface LevelSpec {
  name: string
  // the road's half-width in world units (large = easy)
  roadWidth: number
  // multiplier on every generated bend's sharpness
  turnStrength: number
  // chance an eligible new section bends instead of running straight
  curveChance: number
  // length range (segments of SEGMENT_LENGTH) for straight sections
  straightLen: [number, number]
  // world units between checkpoint gantries
  checkpointInterval: number
  // relative spawn weights per vehicle texture (see VEHICLES); types not
  // listed never spawn on that level
  trafficMix: Record<string, number>
  // how many NPC vehicles share the road at once — new ones drop in
  // beyond the horizon on a level change, surplus ones retire once they
  // leave the view
  trafficCount: number
  // fraction of MAX_SPEED the player's engine can reach
  maxSpeedFactor: number
  // ground palette overrides (keys of COLORS): the terrain beside the
  // road recolours to the level's theme, blending over the transition.
  // Omitted keys keep the base COLORS values
  colors?: Partial<Record<'grass' | 'grassAlt', number>>
  // skyline silhouette texture; omitted = the base 'sky-fg'. Crossfades
  // over the level transition
  skyFg?: string
  // decal variant set for roadside scenery (see DECALS variants);
  // omitted = the base grass sheets. Applies to newly spawned decals
  scenery?: string
}

export const LEVELS: LevelSpec[] = [
  {
    // 1: grassland — wide and forgiving, light traffic, gentle bends
    name: 'grass',
    roadWidth: 60,
    turnStrength: 1.3,
    curveChance: 1,
    straightLen: [30, 45],
    checkpointInterval: 6000,
    trafficMix: { motorcycle: 0.5, car2: 0.35, truck: 0.15 },
    trafficCount: 8,
    maxSpeedFactor: 1,
  },
  {
    // 2: desert — tighter road, sharper turns, trucks join the flow
    name: 'desert',
    roadWidth: 50,
    turnStrength: 1.25,
    curveChance: 1,
    straightLen: [35, 45],
    checkpointInterval: 8500,
    trafficMix: { motorcycle: 0.3, car2: 0.3, truck: 0.3 },
    trafficCount: 10,
    maxSpeedFactor: 1,
    colors: { grass: 0xd7b98a, grassAlt: 0xc2a069 }, // beige sands
    skyFg: 'desert-sky-fg',
    scenery: 'desert',
  },
  {
    // 3: snow — narrow, twisty, heavy traffic, full speed unlocked
    name: 'snow',
    roadWidth: 40,
    turnStrength: 1.5,
    curveChance: 1,
    straightLen: [25, 35],
    checkpointInterval: 10000,
    trafficMix: { motorcycle: 0.1, car2: 0.3, truck: 0.3, semi: 0.3 },
    trafficCount: 12,
    maxSpeedFactor: 1,
    colors: { grass: 0xffffff, grassAlt: 0xb8dcf2 }, // snow and ice
    skyFg: 'snow-sky-fg',
    scenery: 'snow',
  },
]

// css hex string -> Phaser color number
const hex = (c: string) => parseInt(c.slice(1), 16)

export const COLORS = {
  grass: hex('#008751'),
  grassAlt: hex('#099b4d'),
  road: hex('#9aa3ab'),
  roadAlt: hex('#919ba3'),
  edge: hex('#797c86'),
  edgeAlt: hex('#54565d'),
  marking: hex('#C2C3C7'),
}

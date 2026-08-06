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

// half-width of the road in world units
export const ROAD_WIDTH = 60
export const LANES = 3

// world-x bend added per segment^2 per unit of curve intensity
export const CURVE_WORLD = 2.6

// segments per light/dark stripe band
export const RUMBLE_LENGTH = 3

// sky px scrolled per world unit travelled through a full-intensity curve
export const SKY_PARALLAX = 0.025

export const MAX_SPEED = 800
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
// automatic transmission: shifts up at redline under throttle and back
// down as speed falls; up/down manual shifting is disabled while on
export const AUTO_SHIFT = true
// what MAX_SPEED reads as on the speedometer: the gauge always spans
// 0-215 mph no matter the internal top speed
export const TOP_SPEED_MPH = 215
// speed at which steering/centrifugal reach nominal strength; forces keep
// growing with real speed past it, so faster = harder to hold a curve
export const REFERENCE_SPEED = 300
export const ACCEL = 60
export const BRAKE = 800
export const COAST_DECEL = 40
export const OFFROAD_MAX_SPEED = 30
export const OFFROAD_DECEL = 750
export const OFFROAD_ACCEL_FACTOR = 0.25
// max camera jitter (px) while off-road at speed
export const OFFROAD_SHAKE = 0.3
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
// least this far to kick into a drift; while it lasts the car gains
// DRIFT_ACCEL speed per second instead of normal throttle/brake, and the
// centrifugal pull is scaled by DRIFT_GRIP — the car slides with the
// curve instead of being flung out, so drifts hold bends that are too
// fast to steer through normally
export const DRIFT_MIN_SPEED = 250
export const DRIFT_MIN_STEER = 0.01
export const DRIFT_ACCEL = 80
export const DRIFT_GRIP = 0.5

// turn-warning chevrons: how many repeats lead into a big turn, how far
// apart they're spaced, and how far before the bend the first one sits
export const TURN_SIGN_REPEATS = 8
export const TURN_SIGN_GAP = 150
export const TURN_SIGN_LEAD = 600

// seconds on the countdown clock; reaching zero ends the run
export const RACE_TIME = 60
// score (distance / 100) caps here
export const MAX_SCORE = 9999
// checkpoints: world units between them, seconds they award, and the most
// the clock can hold (the display only has two digits)
export const CHECKPOINT_INTERVAL = 10000
export const CHECKPOINT_BONUS = 15
export const MAX_TIME = 99

// other cars cruising the road
export const TRAFFIC_COUNT = 3
export const TRAFFIC_MIN_SPEED = 250
export const TRAFFIC_MAX_SPEED = 450

// collision box around a car: length along the track (world units) and
// half-width across it (road-relative lane units, like playerX)
export const CAR_COLLIDE_Z = 15
export const CAR_COLLIDE_LANE = 0.3
// signs are narrow static posts, so a smaller box
export const SIGN_COLLIDE_Z = 10
export const SIGN_COLLIDE_LANE = 0.15

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

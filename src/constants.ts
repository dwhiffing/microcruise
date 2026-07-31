export const GAME_WIDTH = 64
export const GAME_HEIGHT = 64

// screen row the camera aims at (flat-road horizon)
export const HORIZON_Y = 26

// world-space track: fixed-length slices projected each frame
export const SEGMENT_LENGTH = 20
export const DRAW_SEGMENTS = 50

// camera sits this far above the road, looking level
export const CAMERA_HEIGHT = 30
// 1 / tan(fov / 2), fov ~= 100 degrees
export const CAMERA_DEPTH = 0.84
// depth of the player car plane in front of the camera
export const PLAYER_Z = CAMERA_HEIGHT * CAMERA_DEPTH

// half-width of the road in world units
export const ROAD_WIDTH = 80
export const LANES = 3

// world-x bend added per segment^2 per unit of curve intensity
export const CURVE_WORLD = 2.6

// segments per light/dark stripe band
export const RUMBLE_LENGTH = 3

// sky px scrolled per world unit travelled through a full-intensity curve
export const SKY_PARALLAX = 0.025

// lens effect: px the road bows against the curve at the bottom of the frame
export const LENS_BEND = 10

export const MAX_SPEED = 900
// speed at which steering/centrifugal reach nominal strength; forces keep
// growing with real speed past it, so faster = harder to hold a curve
export const REFERENCE_SPEED = 300
export const ACCEL = 160
export const BRAKE = 800
export const COAST_DECEL = 40
export const OFFROAD_MAX_SPEED = 30
export const OFFROAD_DECEL = 750
export const OFFROAD_ACCEL_FACTOR = 0.25
// max camera jitter (px) while off-road at speed
export const OFFROAD_SHAKE = 0.3
// below this speed the car sprite's frame stops changing
export const MIN_LEAN_SPEED = 50

export const STEER_SPEED = 4
// seconds a direction must be held continuously to reach full lock; the
// remaining travel beyond MICRO_STEER eases in on a squared curve
export const STEER_RAMP = 1.5
// wheel magnitude available the instant a direction is pressed (0..1),
// giving quick taps an immediate, responsive nudge before the hold ramp
export const MICRO_STEER = 0.35
// how fast the wheel recenters when released
export const STEER_RETURN = 5.0
// how fast the wheel passes back through center when reversing direction
// (slower than a plain release, so left/right switches take longer)
export const STEER_REVERSE_RETURN = 2.5
export const CENTRIFUGAL = 3.0
// speed lost per second per unit of gradient when climbing
export const SLOPE_DRAG = 120

// css hex string -> Phaser color number
const hex = (c: string) => parseInt(c.slice(1), 16)

export const COLORS = {
  grass: hex('#008751'),
  grassAlt: hex('#099b4d'),
  road: hex('#9aa3ab'),
  roadAlt: hex('#919ba3'),
  edge: hex('#797c86'),
  edgeAlt: hex('#54565d'),
  edgeAltDark: hex('#54565d'),
  marking: hex('#C2C3C7'),
}

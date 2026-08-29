import {
  type Vector3,
  add,
  dot,
  magnitude,
  normalize,
  scale,
  subtract,
} from '@src/lib/scene/projection'

/**
 * Moving a camera from one viewpoint to another, without going through the
 * middle of the model.
 *
 * The naive version lerps the two positions, and looks wrong in the one case
 * that matters: swinging from the front of a part to the back drags the camera
 * straight through it. So the *direction* is interpolated on the sphere and the
 * *distance* along a line — the camera swings round its target at a steady
 * radius, which is the motion somebody expects from a view control and the same
 * one an orbit produces.
 *
 * Pure, and in world units. Whoever drives it decides the cadence.
 */

/** Where a camera is and what it is looking at. */
export interface Viewpoint {
  position: Vector3
  target: Vector3
  /** The world up the camera is keeping. */
  up: Vector3
}

/** Below this two directions are the same direction. */
const EPSILON = 1e-6

const lerp = (from: number, to: number, t: number) => from + (to - from) * t

const lerpPoint = (from: Vector3, to: Vector3, t: number): Vector3 => ({
  x: lerp(from.x, to.x, t),
  y: lerp(from.y, to.y, t),
  z: lerp(from.z, to.z, t),
})

/** Any unit vector at right angles to this one. */
function perpendicularTo(vector: Vector3): Vector3 {
  // Cross with whichever axis the vector is least aligned to, so the result is
  // never degenerate.
  const axis =
    Math.abs(vector.z) < Math.abs(vector.x)
      ? { x: 0, y: 0, z: 1 }
      : { x: 1, y: 0, z: 0 }

  return normalize({
    x: vector.y * axis.z - vector.z * axis.y,
    y: vector.z * axis.x - vector.x * axis.z,
    z: vector.x * axis.y - vector.y * axis.x,
  })
}

/**
 * Interpolate two directions along the shortest arc between them.
 *
 * Two cases have to be handled or the arithmetic collapses. Directions that are
 * already the same have no arc, so it degenerates to the one direction. Exactly
 * opposite directions have *no shortest arc* — every half turn is as short as
 * every other — so one is chosen by going through a perpendicular, which is what
 * makes a 180° view flip swing round the side rather than stall or jump.
 */
export function slerp(from: Vector3, to: Vector3, t: number): Vector3 {
  const a = normalize(from)
  const b = normalize(to)
  const cosine = Math.min(1, Math.max(-1, dot(a, b)))
  const angle = Math.acos(cosine)

  if (angle < EPSILON) return a
  if (Math.PI - angle < EPSILON) {
    const halfway = perpendicularTo(a)
    return t < 0.5 ? slerp(a, halfway, t * 2) : slerp(halfway, b, (t - 0.5) * 2)
  }

  const sine = Math.sin(angle)
  return add(
    scale(a, Math.sin((1 - t) * angle) / sine),
    scale(b, Math.sin(t * angle) / sine)
  )
}

/**
 * Slow in, slow out.
 *
 * Smoothstep rather than a spring or a longer curve: a view control should feel
 * like it settled rather than like it arrived, and anything with overshoot in it
 * would have the camera pass the plane it was asked to look at.
 */
export const ease = (t: number): number => {
  const clamped = Math.min(1, Math.max(0, t))
  return clamped * clamped * (3 - 2 * clamped)
}

/**
 * The viewpoint part way from one to another.
 *
 * `t` is unelapsed progress in [0, 1] — easing is the caller's, so a caller that
 * wants none can pass raw time.
 */
export function tweenViewpoint(
  from: Viewpoint,
  to: Viewpoint,
  t: number
): Viewpoint {
  const target = lerpPoint(from.target, to.target, t)

  const fromEye = subtract(from.position, from.target)
  const toEye = subtract(to.position, to.target)

  const direction = slerp(fromEye, toEye, t)
  const distance = lerp(magnitude(fromEye), magnitude(toEye), t)

  return {
    position: add(target, scale(direction, distance)),
    target,
    up: slerp(from.up, to.up, t),
  }
}

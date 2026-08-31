import {
  type CameraFrame,
  type Vector3,
  add,
  cross,
  dot,
  magnitude,
  normalize,
  scale,
  subtract,
  viewBasis,
} from '@src/lib/scene/projection'

/**
 * Moving a camera locally, rather than asking a renderer to move it.
 *
 * Needed because the engine renders somewhere else. Normally a drag is forwarded
 * to it and the camera comes back in the echo — which is fine for looking at a
 * model and not fine for drawing on one, because the sketch is drawn from the
 * echoed camera and therefore lags the pointer. While a sketch is open the app
 * moves its *own* camera and tells the engine afterwards, so the overlay answers
 * the pointer immediately and the video is what falls behind.
 *
 * That is the existing app's arrangement too: entering a sketch sets
 * `syncDirection = 'clientToEngine'`. Which means it has to do the orbit
 * arithmetic itself, and so do we — this is that arithmetic, ported and kept pure
 * so it can be tested without a renderer.
 */

/** Degrees of rotation per pixel dragged. The existing app's number. */
const ROTATION_SPEED = 0.3

/** How close to the pole the camera may get, in radians. Also theirs. */
const POLE_LIMIT = 0.1

/** Never let the camera reach its own target. */
const MIN_DISTANCE = 1e-3

const TO_RADIANS = Math.PI / 180

/**
 * Into and out of a Y-up frame.
 *
 * Spherical coordinates are conventionally Y-up and the model is Z-up, so the
 * offset is rotated a quarter turn about X, worked in spherical, and rotated
 * back. The existing app does this with a quaternion built from
 * `setFromUnitVectors((0,0,1), (0,1,0))`; expanded, that rotation is exactly
 * these two swaps, and writing them out means this file needs no THREE.
 */
const toYUp = (v: Vector3): Vector3 => ({ x: v.x, y: v.z, z: -v.y })
const fromYUp = (v: Vector3): Vector3 => ({ x: v.x, y: -v.z, z: v.y })

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value))

/**
 * Orbit about the target, keeping the model upright.
 *
 * The spherical orbit: dragging sideways goes round, dragging up and down goes
 * over, and up stays up. The pole clamp is what stops the camera tipping past
 * vertical and flipping the world — a limit rather than a wrap, because a view
 * that inverts under the pointer is disorienting in a way no amount of skill
 * makes comfortable.
 */
export function orbit(
  camera: CameraFrame,
  deltaX: number,
  deltaY: number
): CameraFrame {
  const offset = toYUp(subtract(camera.position, camera.target))
  const radius = magnitude(offset)
  if (radius < MIN_DISTANCE) return camera

  const theta =
    Math.atan2(offset.x, offset.z) - deltaX * ROTATION_SPEED * TO_RADIANS
  const phi = clamp(
    Math.acos(clamp(offset.y / radius, -1, 1)) -
      deltaY * ROTATION_SPEED * TO_RADIANS,
    POLE_LIMIT,
    Math.PI - POLE_LIMIT
  )

  const sinPhiRadius = Math.sin(phi) * radius
  const turned = fromYUp({
    x: sinPhiRadius * Math.sin(theta),
    y: Math.cos(phi) * radius,
    z: sinPhiRadius * Math.cos(theta),
  })

  return { ...camera, position: add(camera.target, turned) }
}

/**
 * Orbit freely, in whatever direction the pointer went.
 *
 * The trackball: no up to preserve, so the camera can roll and end up sideways.
 * It has to carry `up` along with it — the position alone cannot express roll,
 * and a basis rebuilt from a stale up hint would silently un-roll the view.
 */
export function trackball(
  camera: CameraFrame,
  deltaX: number,
  deltaY: number
): CameraFrame {
  const basis = viewBasis(camera)
  const offset = subtract(camera.position, camera.target)

  const turned = rotateAbout(
    rotateAbout(offset, basis.up, -deltaX * ROTATION_SPEED * TO_RADIANS),
    basis.right,
    -deltaY * ROTATION_SPEED * TO_RADIANS
  )
  const up = rotateAbout(
    rotateAbout(basis.up, basis.up, -deltaX * ROTATION_SPEED * TO_RADIANS),
    basis.right,
    -deltaY * ROTATION_SPEED * TO_RADIANS
  )

  return {
    ...camera,
    position: add(camera.target, turned),
    up: normalize(up),
    // The reported orientation described where the camera *was*; keeping it would
    // have `viewBasis` prefer a rotation that no longer matches the vantage.
    orientation: undefined,
  }
}

/** Rodrigues' rotation: a vector turned about an axis. */
function rotateAbout(vector: Vector3, axis: Vector3, angle: number): Vector3 {
  const unit = normalize(axis)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  return add(
    add(scale(vector, cos), scale(cross(unit, vector), sin)),
    scale(unit, dot(unit, vector) * (1 - cos))
  )
}

/**
 * Slide the camera and its target together.
 *
 * Both move, which is what makes it a pan rather than an orbit: the camera keeps
 * looking the same way and the model goes past. `unitsPerPixel` is how big a
 * pixel is where the target is, so a drag moves the model exactly as far as the
 * pointer went.
 */
export function pan(
  camera: CameraFrame,
  deltaX: number,
  deltaY: number,
  unitsPerPixel: number
): CameraFrame {
  const basis = viewBasis(camera)
  const shift = add(
    scale(basis.right, -deltaX * unitsPerPixel),
    // Screen y grows downward and the camera's up does not.
    scale(basis.up, deltaY * unitsPerPixel)
  )

  return {
    ...camera,
    position: add(camera.position, shift),
    target: add(camera.target, shift),
  }
}

/**
 * Move toward or away from the target.
 *
 * One implementation for both projections, which is a property of how the frame
 * is written rather than a shortcut: the orthographic view height is *derived*
 * from the viewing distance — that is the arithmetic the engine uses and
 * `halfViewHeight` mirrors — so changing the distance zooms either camera.
 *
 * `factor` above one moves away.
 */
export function dolly(camera: CameraFrame, factor: number): CameraFrame {
  const offset = subtract(camera.position, camera.target)
  const distance = magnitude(offset)
  if (distance < MIN_DISTANCE) return camera

  const next = Math.max(MIN_DISTANCE, distance * factor)
  return {
    ...camera,
    position: add(camera.target, scale(normalize(offset), next)),
  }
}

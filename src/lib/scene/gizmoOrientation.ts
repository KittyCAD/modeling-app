import type { Vector3 } from '@src/lib/scene/projection'

/**
 * Which way to look, for a gizmo mesh's name.
 *
 * Ported from `orientationQuaternionForName` in the existing app's
 * `GizmoRenderer`, stopping one step earlier: it goes on to build a quaternion,
 * and we hand the direction to the camera driver instead, because the driver
 * already knows how to move a camera and how to animate getting there.
 *
 * The clever part is worth keeping in mind. The direction is the *sum* of the
 * axis for each word in the name, so `corner_front_left_top` is three unit
 * vectors added together and comes out as the diagonal. That is how one function
 * serves six faces, twelve edges and eight corners without listing twenty-six
 * cases — and why a new mesh named on the same pattern needs no code at all.
 *
 * Kept away from the renderer so it can be tested without loading a model, four
 * textures and THREE.js.
 */

const AXES: readonly [string, Vector3][] = [
  ['front', { x: 0, y: -1, z: 0 }],
  ['back', { x: 0, y: 1, z: 0 }],
  ['left', { x: -1, y: 0, z: 0 }],
  ['right', { x: 1, y: 0, z: 0 }],
  ['top', { x: 0, y: 0, z: 1 }],
  ['bottom', { x: 0, y: 0, z: -1 }],
]

/** The existing app's default up for everything but the top and bottom faces. */
const DEFAULT_UP: Vector3 = { x: 0, y: 0, z: 1 }

export interface GizmoOrientation {
  direction: Vector3
  up: Vector3
}

export function orientationForName(name: string): GizmoOrientation | null {
  let x = 0
  let y = 0
  let z = 0

  for (const [word, axis] of AXES) {
    if (!name.includes(word)) continue
    x += axis.x
    y += axis.y
    z += axis.z
  }

  const length = Math.hypot(x, y, z)
  // A name that mentions no axis is not a place to stand — the boundary lines
  // and the model root both land here.
  if (length === 0) return null

  /*
   * Up is world Z except on the two faces where Z is degenerate: looking
   * straight down at the top, there is no "up" along the axis being looked down,
   * so the existing app picks ±Y and so does this.
   */
  const up =
    name === 'face_top'
      ? { x: 0, y: 1, z: 0 }
      : name === 'face_bottom'
        ? { x: 0, y: -1, z: 0 }
        : DEFAULT_UP

  return {
    direction: { x: x / length, y: y / length, z: z / length },
    up,
  }
}

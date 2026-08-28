/**
 * Where a point in the world lands on the screen, and back again.
 *
 * Pure arithmetic over a camera, so it can be tested without a renderer and
 * reused by any of them. What makes this possible at all is that the streamed
 * engine *reports* its camera — every drag and zoom answers with the settings it
 * ended up at — so the app can know where the camera is without owning it.
 *
 * Millimetres throughout. kcl-lib converts every length it sends the engine with
 * `to_mm()` and never sets the scene units, so the engine's world really is
 * millimetres and anything meeting it here has to be converted first.
 */

export interface Vector3 {
  x: number
  y: number
  z: number
}

/**
 * The camera, as the engine describes it.
 *
 * Deliberately the engine's own vocabulary — a vantage, a look-at centre, an up
 * vector and a vertical field of view — rather than a matrix. A matrix would be
 * a translation of this, and the translation is exactly what goes wrong when the
 * two sides disagree about handedness or row order.
 */
export interface CameraFrame {
  position: Vector3
  target: Vector3
  up: Vector3
  /** Vertical field of view, in degrees. */
  fovY: number
  /**
   * True when the camera projects orthographically.
   *
   * The engine keeps a field of view even in ortho and derives the view height
   * from the viewing distance, so the two projections share one number rather
   * than needing a separate ortho scale. That is `CameraControls`'s arithmetic in
   * the existing app, kept because it is what the engine has been observed to
   * agree with.
   */
  orthographic: boolean
}

/** A plane in world space: where it is, and which way its own axes point. */
export interface PlaneFrame {
  origin: Vector3
  xAxis: Vector3
  yAxis: Vector3
  /** The normal. Kept explicitly because the engine reports it. */
  zAxis: Vector3
}

/** A point in a plane's own two dimensions. */
export interface PlanePoint {
  x: number
  y: number
}

export interface ViewportSize {
  width: number
  height: number
}

/** Below this a direction is treated as having none. */
const EPSILON = 1e-9

export const subtract = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
})

export const add = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
})

export const scale = (a: Vector3, by: number): Vector3 => ({
  x: a.x * by,
  y: a.y * by,
  z: a.z * by,
})

export const dot = (a: Vector3, b: Vector3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z

export const cross = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

export const magnitude = (a: Vector3): number => Math.sqrt(dot(a, a))

/** A unit vector, or the zero vector when there was no direction to keep. */
export const normalize = (a: Vector3): Vector3 => {
  const length = magnitude(a)
  return length < EPSILON ? { x: 0, y: 0, z: 0 } : scale(a, 1 / length)
}

/**
 * The camera's own three directions.
 *
 * The reported up vector is world up rather than the camera's, so it is only a
 * hint about roll: the true up is recovered by orthogonalising it against the
 * viewing direction. Using it as given would tilt everything the moment the
 * camera looked anywhere but level.
 */
export function viewBasis(camera: CameraFrame): {
  right: Vector3
  up: Vector3
  forward: Vector3
} {
  const forward = normalize(subtract(camera.target, camera.position))
  const right = normalize(cross(forward, camera.up))

  /*
   * Looking straight along the up vector leaves no right to speak of. Any
   * direction perpendicular to the view is as good as any other there, so pick
   * one rather than collapsing the whole basis to zero and putting every point
   * in the same place.
   */
  const settled =
    magnitude(right) < EPSILON
      ? normalize(cross(forward, { x: 0, y: 0, z: 1 }))
      : right

  const stable =
    magnitude(settled) < EPSILON
      ? normalize(cross(forward, { x: 0, y: 1, z: 0 }))
      : settled

  return { right: stable, up: cross(stable, forward), forward }
}

const halfFovTangent = (camera: CameraFrame): number =>
  Math.tan((camera.fovY * Math.PI) / 360)

/**
 * Half the world height the viewport covers, at a given depth.
 *
 * The one place the two projections differ: under perspective the visible height
 * grows with distance, and under orthographic it is fixed by how far the camera
 * was pulled back. Both are the same formula with a different depth, which is
 * why `fovY` survives into ortho.
 */
function halfViewHeight(camera: CameraFrame, depth: number): number {
  const distance = camera.orthographic
    ? magnitude(subtract(camera.target, camera.position))
    : depth

  return halfFovTangent(camera) * distance
}

/**
 * Where a world point lands on the surface, in element pixels.
 *
 * Null for a point the camera cannot see — behind a perspective camera, or in
 * a viewport with no area. Both are ordinary: a sketch plane can be edge-on or
 * behind you, and a drawing has to leave those out rather than plot infinity.
 *
 * The aspect ratio is the *element's*, not the engine's frame. The engine is
 * asked to render at the shape of the panel and the video is drawn over it, so
 * the two agree to within the engine's rounding — the same assumption
 * `toStreamWindow` already makes when it turns a click into engine pixels.
 */
export function projectPoint(
  camera: CameraFrame,
  point: Vector3,
  viewport: ViewportSize
): { x: number; y: number } | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null

  const basis = viewBasis(camera)
  const offset = subtract(point, camera.position)
  const depth = dot(offset, basis.forward)

  if (!camera.orthographic && depth <= EPSILON) return null

  const halfHeight = halfViewHeight(camera, depth)
  if (halfHeight < EPSILON) return null
  const halfWidth = (halfHeight * viewport.width) / viewport.height

  return {
    x: viewport.width * (0.5 + dot(offset, basis.right) / (2 * halfWidth)),
    // Screen y grows downward and the camera's up does not.
    y: viewport.height * (0.5 - dot(offset, basis.up) / (2 * halfHeight)),
  }
}

/** The ray through a point on the surface, in world space. */
function rayThrough(
  camera: CameraFrame,
  at: { x: number; y: number },
  viewport: ViewportSize
): { origin: Vector3; direction: Vector3 } | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null

  const basis = viewBasis(camera)
  const ndcX = (2 * at.x) / viewport.width - 1
  const ndcY = 1 - (2 * at.y) / viewport.height

  if (camera.orthographic) {
    const halfHeight = halfViewHeight(camera, 0)
    const halfWidth = (halfHeight * viewport.width) / viewport.height

    return {
      // Every ray is parallel; what the pixel chooses is where it starts.
      origin: add(
        camera.position,
        add(
          scale(basis.right, ndcX * halfWidth),
          scale(basis.up, ndcY * halfHeight)
        )
      ),
      direction: basis.forward,
    }
  }

  const tangent = halfFovTangent(camera)
  const aspect = viewport.width / viewport.height

  return {
    origin: camera.position,
    direction: normalize(
      add(
        basis.forward,
        add(
          scale(basis.right, ndcX * tangent * aspect),
          scale(basis.up, ndcY * tangent)
        )
      )
    ),
  }
}

/**
 * Where a point on the surface meets a plane, in that plane's coordinates.
 *
 * Null when the ray never reaches it: a plane seen exactly edge-on has no point
 * under the cursor, and a plane behind a perspective camera is not somewhere you
 * can draw. Answering with a nearest guess instead would put segments behind the
 * viewer, which reads as the tool having gone mad rather than as a camera that
 * needs turning.
 */
export function unprojectToPlane(
  camera: CameraFrame,
  at: { x: number; y: number },
  viewport: ViewportSize,
  plane: PlaneFrame
): PlanePoint | null {
  const ray = rayThrough(camera, at, viewport)
  if (!ray) return null

  const normal = normalize(plane.zAxis)
  const along = dot(ray.direction, normal)
  if (Math.abs(along) < EPSILON) return null

  const distance = dot(subtract(plane.origin, ray.origin), normal) / along
  // A perspective ray only goes forwards; an orthographic one starts on the
  // image plane, so a plane slightly behind it is still in view.
  if (!camera.orthographic && distance <= 0) return null

  const world = add(ray.origin, scale(ray.direction, distance))
  return worldToPlane(plane, world)
}

/** A point in a plane's coordinates, placed in the world. */
export function planeToWorld(plane: PlaneFrame, point: PlanePoint): Vector3 {
  return add(
    plane.origin,
    add(
      scale(normalize(plane.xAxis), point.x),
      scale(normalize(plane.yAxis), point.y)
    )
  )
}

/**
 * A world point measured in a plane's coordinates.
 *
 * Whatever is off the plane is dropped rather than reported. Callers get here
 * from a ray that already met the plane, and a third coordinate would only be
 * rounding error for them to decide what to do with.
 */
export function worldToPlane(plane: PlaneFrame, point: Vector3): PlanePoint {
  const offset = subtract(point, plane.origin)
  return {
    x: dot(offset, normalize(plane.xAxis)),
    y: dot(offset, normalize(plane.yAxis)),
  }
}

/**
 * How many element pixels one plane unit covers, near a point.
 *
 * Measured rather than derived, by projecting a short step along the plane: it
 * is the same number under perspective and orthographic projection, and it stays
 * right when the plane is seen at an angle. What it is for is turning a pointer
 * tolerance in pixels into one in plane units, so hit testing can stay analytic
 * and two-dimensional.
 *
 * Zero when the plane is edge-on or off screen, which callers must read as "do
 * not pick here" rather than as a very small tolerance.
 */
export function pixelsPerUnit(
  camera: CameraFrame,
  plane: PlaneFrame,
  near: PlanePoint,
  viewport: ViewportSize
): number {
  const origin = projectPoint(camera, planeToWorld(plane, near), viewport)
  const stepped = projectPoint(
    camera,
    planeToWorld(plane, { x: near.x + 1, y: near.y }),
    viewport
  )
  const lifted = projectPoint(
    camera,
    planeToWorld(plane, { x: near.x, y: near.y + 1 }),
    viewport
  )
  if (!origin || !stepped || !lifted) return 0

  const along = Math.hypot(stepped.x - origin.x, stepped.y - origin.y)
  const up = Math.hypot(lifted.x - origin.x, lifted.y - origin.y)

  // The larger of the two: a plane seen at an angle is foreshortened in one
  // direction only, and the generous axis is the one the pointer is working in.
  return Math.max(along, up)
}

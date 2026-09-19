import {
  ARC_SEGMENT_BODY,
  CIRCLE_SEGMENT_BODY,
  PROFILE_START,
  STRAIGHT_SEGMENT_BODY,
  TANGENTIAL_ARC_TO_SEGMENT_BODY,
  THREE_POINT_ARC_SEGMENT_BODY,
} from '@src/clientSideScene/sceneConstants'
import {
  ARC_SEGMENT_BODY as SOLVE_ARC_SEGMENT_BODY,
  CONTROL_POINT_SPLINE_BODY,
  CONTROL_POINT_SPLINE_POLYGON,
  POINT_SEGMENT_BODY,
} from '@src/machines/sketchSolve/segments'
import {
  Box3,
  BufferGeometry,
  Matrix4,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three'

const SEGMENT_GEOMETRY_TYPES = new Set([
  STRAIGHT_SEGMENT_BODY,
  ARC_SEGMENT_BODY,
  CIRCLE_SEGMENT_BODY,
  TANGENTIAL_ARC_TO_SEGMENT_BODY,
  THREE_POINT_ARC_SEGMENT_BODY,
  SOLVE_ARC_SEGMENT_BODY,
  CONTROL_POINT_SPLINE_BODY,
  CONTROL_POINT_SPLINE_POLYGON,
])

/** Measure actual sketch segments, not screen-sized handles, labels or the grid. */
export function getSketchCameraFrame(
  sketch: Object3D,
  aspect: number,
  currentHalfHeight: number
) {
  sketch.updateWorldMatrix(true, true)
  const origin = sketch.getWorldPosition(new Vector3())
  const quaternion = sketch.getWorldQuaternion(new Quaternion())
  // Keep world units (mm), including the scene's base-unit scale, but measure
  // in the sketch plane's axes rather than a world-axis-aligned bounding box.
  const worldToPlane = new Matrix4()
    .compose(origin, quaternion, new Vector3(1, 1, 1))
    .invert()
  const bounds = new Box3()
  const objectBounds = new Box3()
  const transform = new Matrix4()
  const point = new Vector3()
  sketch.traverse((object) => {
    const type = object.userData.type
    if (type === POINT_SEGMENT_BODY || object.name === PROFILE_START) {
      bounds.expandByPoint(
        object.getWorldPosition(point).applyMatrix4(worldToPlane)
      )
    } else if (
      SEGMENT_GEOMETRY_TYPES.has(type) &&
      'geometry' in object &&
      object.geometry instanceof BufferGeometry
    ) {
      const geometry = object.geometry
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      if (geometry.boundingBox) {
        transform.multiplyMatrices(worldToPlane, object.matrixWorld)
        bounds.union(
          objectBounds.copy(geometry.boundingBox).applyMatrix4(transform)
        )
      }
    }
  })

  const center = bounds.isEmpty()
    ? new Vector3()
    : bounds.getCenter(new Vector3())
  const size = bounds.getSize(new Vector3())
  const fittedHalfHeight = Math.max(size.y, size.x / aspect) * 0.5 * 1.2
  // Empty and point-only sketches have no useful extent to fit.
  const halfHeight =
    fittedHalfHeight > 1e-8 ? fittedHalfHeight : currentHalfHeight
  const target = center.setZ(0).applyQuaternion(quaternion).add(origin)
  return { target, quaternion, halfHeight }
}

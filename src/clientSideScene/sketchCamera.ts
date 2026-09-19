import { type Object3D, Quaternion, Vector3 } from 'three'

/**
 * Match engine sketch alignment:
 * align to the plane using the current eye distance, without fitting geometry.
 * Body-face sketches use the face centre of mass instead of the plane origin.
 */
export function getSketchCameraFrame(
  sketch: Object3D,
  eye: Vector3,
  // face_get_center returns world coordinates in the model's base units.
  faceCenter?: Vector3
) {
  sketch.updateWorldMatrix(true, false)
  const target = faceCenter
    ? faceCenter.clone().multiply(sketch.getWorldScale(new Vector3()))
    : sketch.getWorldPosition(new Vector3())
  const quaternion = sketch.getWorldQuaternion(new Quaternion()).normalize()
  const toEye = eye.clone().sub(target)
  const normal = new Vector3(0, 0, 1).applyQuaternion(quaternion)
  // Planes can be viewed from either side; body faces keep their outward normal.
  if (!faceCenter && toEye.dot(normal) < 0) {
    quaternion.multiply(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
    )
  }
  return { target, quaternion, distance: Math.max(toEye.length(), 0.001) }
}

import { AxisNames } from '@src/lib/constants'
import { Matrix4, Quaternion, Vector3 } from 'three'

/** Camera control for one scene; orientation snapshots cannot mutate the source camera. */
export interface GizmoCamera {
  getOrientation(): Quaternion
  /** Observe orientation changes from either the viewport or the gizmo. Returns an unsubscribe function. */
  subscribeOrientation(listener: () => void): () => void
  orientTo(orientation: Quaternion): Promise<void>
  beginOrbit(): void
  orbitBy(dx: number, dy: number): void
  endOrbit(): void
}

const AXIS_DIRECTIONS: Record<AxisNames, [number, number, number]> = {
  [AxisNames.X]: [1, 0, 0],
  [AxisNames.Y]: [0, 1, 0],
  [AxisNames.Z]: [0, 0, 1],
  [AxisNames.NEG_X]: [-1, 0, 0],
  [AxisNames.NEG_Y]: [0, -1, 0],
  [AxisNames.NEG_Z]: [0, 0, -1],
}

/** Standard views share orientTo with cube faces, keeping transport out of the gizmo. */
export function orientToAxis(
  camera: Pick<GizmoCamera, 'orientTo'>,
  axis: AxisNames
) {
  const eye = new Vector3(...AXIS_DIRECTIONS[axis])
  const up =
    axis === AxisNames.Z
      ? new Vector3(0, 1, 0)
      : axis === AxisNames.NEG_Z
        ? new Vector3(0, -1, 0)
        : new Vector3(0, 0, 1)
  const orientation = new Quaternion().setFromRotationMatrix(
    new Matrix4().lookAt(eye, new Vector3(), up)
  )
  return camera.orientTo(orientation)
}

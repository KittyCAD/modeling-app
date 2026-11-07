import { expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { orientToAxis } from '@src/components/gizmo/camera'
import type { GizmoCamera } from '@src/components/gizmo/camera'
import { AxisNames } from '@src/lib/constants'

it.each([
  { axis: AxisNames.X, eye: [1, 0, 0], up: [0, 0, 1] },
  { axis: AxisNames.Y, eye: [0, 1, 0], up: [0, 0, 1] },
  { axis: AxisNames.Z, eye: [0, 0, 1], up: [0, 1, 0] },
  { axis: AxisNames.NEG_X, eye: [-1, 0, 0], up: [0, 0, 1] },
  { axis: AxisNames.NEG_Y, eye: [0, -1, 0], up: [0, 0, 1] },
  { axis: AxisNames.NEG_Z, eye: [0, 0, -1], up: [0, -1, 0] },
])(
  'orients to $axis with the standard view upright',
  async ({ axis, eye, up }) => {
    const camera = { orientTo: vi.fn<GizmoCamera['orientTo']>(async () => {}) }
    await orientToAxis(camera, axis)
    expect(camera.orientTo).toHaveBeenCalledTimes(1)
    const orientation = camera.orientTo.mock.calls[0][0]
    const actualEye = new Vector3(0, 0, 1)
      .applyQuaternion(orientation)
      .toArray()
    const actualUp = new Vector3(0, 1, 0).applyQuaternion(orientation).toArray()
    eye.forEach((value, i) => expect(actualEye[i]).toBeCloseTo(value))
    up.forEach((value, i) => expect(actualUp[i]).toBeCloseTo(value))
  }
)

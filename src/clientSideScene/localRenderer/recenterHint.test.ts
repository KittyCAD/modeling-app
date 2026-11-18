import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { expect, it } from 'vitest'
import { recenterHint } from '@src/clientSideScene/localRenderer/recenterHint'

it.each(['perspective', 'orthographic'])(
  'classifies clear recovery hints in %s and leaves ambiguous cases neutral',
  (projection) => {
    const camera =
      projection === 'perspective'
        ? new PerspectiveCamera(90, 1, 0.1, 1000)
        : new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    camera.updateMatrixWorld(true)
    const box = (x: number, y: number, size: number) =>
      new Box3(
        new Vector3(x - size, y - size, -11),
        new Vector3(x + size, y + size, -9)
      )
    expect(recenterHint(box(100, 0, 1), camera)).toEqual({
      kind: 'direction',
      angle: 0,
    })
    expect(recenterHint(box(0, 100, 1), camera)).toEqual({
      kind: 'direction',
      angle: -90,
    })
    expect(recenterHint(box(0, 0, 0.1), camera)).toEqual({ kind: 'zoom-in' })
    expect(recenterHint(box(0, 0, 30), camera)).toEqual({ kind: 'zoom-out' })
    expect(recenterHint(box(0, 0, 2), camera)).toEqual({ kind: 'neutral' })
    expect(
      recenterHint(
        new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
        camera
      )
    ).toEqual({ kind: 'zoom-out' })
    expect(
      recenterHint(
        new Box3(new Vector3(-1, -1, 5), new Vector3(1, 1, 10)),
        camera
      )
    ).toEqual({ kind: 'neutral' })
  }
)

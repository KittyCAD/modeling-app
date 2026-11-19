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
    const hint = (bounds: Box3) => recenterHint(bounds, camera, 1)
    const box = (x: number, y: number, size: number) =>
      new Box3(
        new Vector3(x - size, y - size, -11),
        new Vector3(x + size, y + size, -9)
      )
    expect(hint(box(100, 0, 1))).toEqual({
      kind: 'direction',
      angle: 0,
    })
    expect(hint(box(0, 100, 1))).toEqual({
      kind: 'direction',
      angle: -90,
    })
    expect(hint(box(0, 0, 0.1))).toEqual({ kind: 'zoom-in' })
    expect(hint(box(0, 0, 30))).toEqual({ kind: 'zoom-out' })
    expect(hint(box(0, 0, 2))).toEqual({ kind: 'neutral' })
    expect(
      hint(new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)))
    ).toEqual({ kind: 'zoom-out' })
    expect(
      hint(new Box3(new Vector3(-1, -1, 5), new Vector3(1, 1, 10)))
    ).toEqual({ kind: 'neutral' })
    if (camera instanceof PerspectiveCamera) camera.aspect = 2
    else {
      camera.left = -20
      camera.right = 20
    }
    camera.updateProjectionMatrix()
    expect(
      recenterHint(
        new Box3(new Vector3(39, 19, -11), new Vector3(41, 21, -9)),
        camera,
        2
      )
    ).toMatchObject({
      kind: 'direction',
      angle: expect.closeTo(-26.56505117707799),
    })
  }
)

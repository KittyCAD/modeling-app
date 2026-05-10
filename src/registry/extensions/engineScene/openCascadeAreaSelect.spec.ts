import { describe, expect, it } from 'vitest'
import { OrthographicCamera, Vector2, Vector3 } from 'three'
import {
  isOpenCascadeAreaSelectionMatch,
  openCascadeAreaSelectionBox,
} from './openCascadeAreaSelect'

function testCamera() {
  const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
}

describe('openCascadeAreaSelectionBox', () => {
  it('uses contains mode for left-to-right drags', () => {
    const box = openCascadeAreaSelectionBox({
      startPoint: new Vector3(-1, 0, 0),
      currentPoint: new Vector3(1, 0, 0),
      camera: testCamera(),
      viewportSize: new Vector2(1000, 1000),
    })

    expect(box.mode).toBe('contains')
  })

  it('uses intersects mode for right-to-left drags', () => {
    const box = openCascadeAreaSelectionBox({
      startPoint: new Vector3(1, 0, 0),
      currentPoint: new Vector3(-1, 0, 0),
      camera: testCamera(),
      viewportSize: new Vector2(1000, 1000),
    })

    expect(box.mode).toBe('intersects')
  })
})

describe('isOpenCascadeAreaSelectionMatch', () => {
  it('requires all points in the box for contains mode', () => {
    const camera = testCamera()
    const viewportSize = new Vector2(1000, 1000)
    const box = openCascadeAreaSelectionBox({
      startPoint: new Vector3(-1, 1, 0),
      currentPoint: new Vector3(1, -1, 0),
      camera,
      viewportSize,
    })

    expect(
      isOpenCascadeAreaSelectionMatch({
        geometry: {
          points: [new Vector3(-0.5, 0.5, 0), new Vector3(0.5, -0.5, 0)],
        },
        camera,
        viewportSize,
        boxMin: box.min,
        boxMax: box.max,
        mode: 'contains',
      })
    ).toBe(true)

    expect(
      isOpenCascadeAreaSelectionMatch({
        geometry: {
          points: [new Vector3(-0.5, 0.5, 0), new Vector3(4, -0.5, 0)],
        },
        camera,
        viewportSize,
        boxMin: box.min,
        boxMax: box.max,
        mode: 'contains',
      })
    ).toBe(false)
  })

  it('selects line geometry that crosses the box in intersects mode', () => {
    const camera = testCamera()
    const viewportSize = new Vector2(1000, 1000)
    const box = openCascadeAreaSelectionBox({
      startPoint: new Vector3(1, 1, 0),
      currentPoint: new Vector3(-1, -1, 0),
      camera,
      viewportSize,
    })

    expect(
      isOpenCascadeAreaSelectionMatch({
        geometry: {
          points: [new Vector3(-4, 0, 0), new Vector3(4, 0, 0)],
          segments: [[new Vector3(-4, 0, 0), new Vector3(4, 0, 0)]],
        },
        camera,
        viewportSize,
        boxMin: box.min,
        boxMax: box.max,
        mode: 'intersects',
      })
    ).toBe(true)
  })

  it('selects large faces covering the box in intersects mode', () => {
    const camera = testCamera()
    const viewportSize = new Vector2(1000, 1000)
    const box = openCascadeAreaSelectionBox({
      startPoint: new Vector3(0.5, 0.5, 0),
      currentPoint: new Vector3(-0.5, -0.5, 0),
      camera,
      viewportSize,
    })

    expect(
      isOpenCascadeAreaSelectionMatch({
        geometry: {
          points: [
            new Vector3(-5, -5, 0),
            new Vector3(5, -5, 0),
            new Vector3(0, 5, 0),
          ],
          triangles: [
            [
              new Vector3(-5, -5, 0),
              new Vector3(5, -5, 0),
              new Vector3(0, 5, 0),
            ],
          ],
        },
        camera,
        viewportSize,
        boxMin: box.min,
        boxMax: box.max,
        mode: 'intersects',
      })
    ).toBe(true)
  })
})

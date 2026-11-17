import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { modelViewportCoverage } from '@src/clientSideScene/localRenderer/modelViewportCoverage'

const box = (x: number, y: number, z: number, size = 1) =>
  new Box3(
    new Vector3(x - size, y - size, z - size),
    new Vector3(x + size, y + size, z + size)
  )

describe.each(['perspective', 'orthographic'])(
  '%s model visibility',
  (projection) => {
    function camera() {
      return projection === 'perspective'
        ? new PerspectiveCamera(90, 1, 0.1, 1000)
        : new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    }

    it('does not treat an empty scene as a lost model', () => {
      expect(modelViewportCoverage(new Box3(), camera())).toBeUndefined()
    })

    it('distinguishes a framed model from a tiny model', () => {
      expect(
        modelViewportCoverage(box(0, 0, -10, 3), camera())
      ).toBeGreaterThan(0.03)
      expect(modelViewportCoverage(box(0, 0, -10, 0.1), camera())).toBeLessThan(
        0.03
      )
    })

    it.each([
      [100, 0, -10],
      [-100, 0, -10],
      [0, 100, -10],
      [0, -100, -10],
      [0, 0, 10],
      [0, 0, -1100],
    ])('detects a model outside the view at (%s, %s, %s)', (x, y, z) => {
      expect(modelViewportCoverage(box(x, y, z), camera())).toBe(0)
    })

    it('counts only the onscreen portion of the projected bounds', () => {
      const centered = modelViewportCoverage(box(0, 0, -10), camera()) ?? 0
      const partlyOffscreen =
        modelViewportCoverage(box(10, 0, -10), camera()) ?? 0
      expect(partlyOffscreen).toBeGreaterThan(0)
      expect(partlyOffscreen).toBeLessThan(centered)
    })

    it('caps coverage when zoomed into the model', () => {
      expect(modelViewportCoverage(box(0, 0, -10, 100), camera())).toBe(1)
    })

    it('clips a box crossing the near plane before projecting its area', () => {
      const crossing = new Box3(
        new Vector3(-0.01, -0.01, -0.2),
        new Vector3(0.01, 0.01, 0.1)
      )
      expect(modelViewportCoverage(crossing, camera())).toBeCloseTo(
        projection === 'perspective' ? 0.01 : 0.000001,
        8
      )
      crossing.min.z = -0.09
      expect(modelViewportCoverage(crossing, camera())).toBe(0)
    })
  }
)

it('supports orthographic cameras with a negative near plane', () => {
  const camera = new OrthographicCamera(-10, 10, 10, -10, -100, 100)
  expect(modelViewportCoverage(box(0, 0, 10), camera)).toBeCloseTo(0.01)
})

it('uses the camera pose and viewport aspect ratio', () => {
  const camera = new PerspectiveCamera(90, 2, 0.1, 1000)
  camera.position.set(10, 20, 30)
  camera.lookAt(0, 0, 0)
  expect(modelViewportCoverage(box(0, 0, 0, 10), camera)).toBeGreaterThan(0.03)
  camera.lookAt(20, 40, 60)
  expect(modelViewportCoverage(box(0, 0, 0, 10), camera)).toBe(0)
})

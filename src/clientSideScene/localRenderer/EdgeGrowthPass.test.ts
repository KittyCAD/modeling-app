import { projectedEdgePickRadius } from '@src/clientSideScene/localRenderer/EdgeGrowthPass'
import { OrthographicCamera, PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'

describe('projectedEdgePickRadius', () => {
  it('shrinks with perspective distance and caps the near target', () => {
    const camera = new PerspectiveCamera(50, 1.5, 0.001, 100)
    camera.updateProjectionMatrix()

    expect(projectedEdgePickRadius(camera, 0.06, 800)).toBe(12)
    expect(projectedEdgePickRadius(camera, 0.24, 800)).toBeGreaterThan(2)
    expect(projectedEdgePickRadius(camera, 0.24, 800)).toBeLessThan(6)
    expect(projectedEdgePickRadius(camera, 2, 800)).toBe(2)
  })

  it('uses orthographic zoom rather than camera distance', () => {
    const camera = new OrthographicCamera(-0.15, 0.15, 0.1, -0.1, -1, 100)
    camera.updateProjectionMatrix()
    const normalRadius = projectedEdgePickRadius(camera, 0.1, 800)
    expect(normalRadius).toBeCloseTo(4)
    expect(projectedEdgePickRadius(camera, 10, 800)).toBe(normalRadius)

    camera.zoom = 2
    camera.updateProjectionMatrix()
    expect(projectedEdgePickRadius(camera, 0.1, 800)).toBeCloseTo(8)
  })
})

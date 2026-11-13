import fc from 'fast-check'
import { Box3, OrthographicCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { fitOrthographicDepthRange } from '@src/clientSideScene/localRenderer/orthographicDepth'

describe('orthographic depth precision', () => {
  it.each([10, 1000000])(
    'preserves screen positions and encloses geometry at distance %s',
    (distance) => {
      const camera = new OrthographicCamera(-4, 4, 4, -4, -1000, 1000)
      camera.position.set(distance, distance, distance)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld(true)
      const bounds = new Box3(
        new Vector3(-10, -10, -0.031),
        new Vector3(10, 10, 0)
      )
      const points = []
      for (const x of [-10, 10])
        for (const y of [-10, 10])
          for (const z of [-0.031, 0]) points.push(new Vector3(x, y, z))
      const before = points.map((point) => point.clone().project(camera))
      fitOrthographicDepthRange(camera, bounds)
      points.forEach((point, i) => {
        const after = point.clone().project(camera)
        expect(after.x).toBeCloseTo(before[i].x, 8)
        expect(after.y).toBeCloseTo(before[i].y, 8)
        expect(Math.abs(after.z)).toBeLessThan(1)
        expect(
          point.clone().applyMatrix4(camera.matrixWorldInverse).z
        ).toBeLessThan(0)
      })
      expect(camera.far - camera.near).toBeLessThan(100)
    }
  )

  it('keeps a flat top view precise even when zoomed far out', () => {
    const camera = new OrthographicCamera(
      -10000,
      10000,
      10000,
      -10000,
      -1000000,
      1000000
    )
    camera.position.z = 1000000
    fitOrthographicDepthRange(
      camera,
      new Box3(new Vector3(-10, -10, -0.031), new Vector3(10, 10, 0))
    )
    expect(camera.far - camera.near).toBeLessThan(0.04)
    expect(camera.position.z).toBeLessThan(0.01)
  })

  it('preserves framing and clipping across translated, rotated, and flat bounds', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: -1000, max: 1000 }),
          fc.integer({ min: -1000, max: 1000 }),
          fc.integer({ min: -1000, max: 1000 })
        ),
        fc.tuple(
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 0, max: 10000 })
        ),
        fc.integer({ min: -314, max: 314 }),
        fc.integer({ min: -150, max: 150 }),
        fc.integer({ min: 1, max: 1000000 }),
        (origin, dimensions, yaw, pitch, distance) => {
          const center = new Vector3(...origin)
          const half = new Vector3(...dimensions).multiplyScalar(0.005)
          const bounds = new Box3(
            center.clone().sub(half),
            center.clone().add(half)
          )
          const camera = new OrthographicCamera(
            -100,
            100,
            100,
            -100,
            -10000000,
            10000000
          )
          const direction = new Vector3(
            Math.sin(yaw / 100) * Math.cos(pitch / 100),
            Math.cos(yaw / 100) * Math.cos(pitch / 100),
            Math.sin(pitch / 100)
          )
          camera.position.copy(center).addScaledVector(direction, distance)
          camera.lookAt(center)
          camera.updateMatrixWorld(true)
          const points = []
          for (const x of [bounds.min.x, bounds.max.x])
            for (const y of [bounds.min.y, bounds.max.y])
              for (const z of [bounds.min.z, bounds.max.z])
                points.push(new Vector3(x, y, z))
          const before = points.map((point) => point.clone().project(camera))
          fitOrthographicDepthRange(camera, bounds)
          points.forEach((point, index) => {
            const after = point.clone().project(camera)
            expect(after.x).toBeCloseTo(before[index].x, 7)
            expect(after.y).toBeCloseTo(before[index].y, 7)
            expect(Math.abs(after.z)).toBeLessThan(1)
            expect(
              point.clone().applyMatrix4(camera.matrixWorldInverse).z
            ).toBeLessThan(0)
          })
        }
      ),
      { numRuns: 100 }
    )
  })

  it('leaves sketch-only empty bounds on the existing clip range', () => {
    const camera = new OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
    fitOrthographicDepthRange(camera, new Box3())
    expect(camera.near).toBe(-1000)
    expect(camera.far).toBe(1000)
  })
})

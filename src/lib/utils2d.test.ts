import type { Coords2d } from '@src/lang/std/sketch'
import { initPromise, isPointsCCW } from '@src/lang/wasm'
import { closestPointOnRay } from '@src/lib/utils2d'

beforeAll(async () => {
  await initPromise
})

describe('test isPointsCW', () => {
  test('basic test', () => {
    const points: Coords2d[] = [
      [2, 2],
      [2, 0],
      [0, -2],
    ]
    const pointsRev = [...points].reverse()
    const CCW = isPointsCCW(pointsRev)
    const CW = isPointsCCW(points)
    expect(CCW).toBe(1)
    expect(CW).toBe(-1)
  })
})

describe('test closestPointOnRay', () => {
  test('point lies on ray', () => {
    const rayOrigin: Coords2d = [0, 0]
    const rayDirection: Coords2d = [1, 0]
    const pointToCheck: Coords2d = [7, 0]

    const result = closestPointOnRay(rayOrigin, rayDirection, pointToCheck)
    expect(result.closestPoint).toEqual([7, 0])
    expect(result.t).toBe(7)
  })

  test('point is above ray', () => {
    const rayOrigin: Coords2d = [1, 0]
    const rayDirection: Coords2d = [1, 0]
    const pointToCheck: Coords2d = [7, 7]

    const result = closestPointOnRay(rayOrigin, rayDirection, pointToCheck)
    expect(result.closestPoint).toEqual([7, 0])
    expect(result.t).toBe(6)
  })

  test('point lies behind ray origin and allowNegative=false', () => {
    const rayOrigin: Coords2d = [0, 0]
    const rayDirection: Coords2d = [1, 0]
    const pointToCheck: Coords2d = [-7, 7]

    const result = closestPointOnRay(rayOrigin, rayDirection, pointToCheck)
    expect(result.closestPoint).toEqual([0, 0])
    expect(result.t).toBe(0)
  })

  test('point lies behind ray origin and allowNegative=true', () => {
    const rayOrigin: Coords2d = [0, 0]
    const rayDirection: Coords2d = [1, 0]
    const pointToCheck: Coords2d = [-7, 7]

    const result = closestPointOnRay(
      rayOrigin,
      rayDirection,
      pointToCheck,
      true
    )
    expect(result.closestPoint).toEqual([-7, 0])
    expect(result.t).toBe(-7)
  })

  test('diagonal ray and point', () => {
    const rayOrigin: Coords2d = [0, 0]
    const rayDirection: Coords2d = [1, 1]
    const pointToCheck: Coords2d = [3, 4]

    const result = closestPointOnRay(rayOrigin, rayDirection, pointToCheck)
    expect(result.closestPoint[0]).toBeCloseTo(3.5)
    expect(result.closestPoint[1]).toBeCloseTo(3.5)
    expect(result.t).toBeCloseTo(4.95, 1)
  })

  test('non-normalized direction vector', () => {
    const rayOrigin: Coords2d = [0, 0]
    const rayDirection: Coords2d = [2, 2]
    const pointToCheck: Coords2d = [3, 4]

    const result = closestPointOnRay(rayOrigin, rayDirection, pointToCheck)
    expect(result.closestPoint[0]).toBeCloseTo(3.5)
    expect(result.closestPoint[1]).toBeCloseTo(3.5)
    expect(result.t).toBeCloseTo(4.95, 1)
  })
})

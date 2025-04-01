import { Coords2d } from 'lang/std/sketch'
import { isPointsCCW, initPromise } from 'lang/wasm'

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

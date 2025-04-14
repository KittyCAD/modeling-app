import type { Coords2d } from '@src/lang/std/sketch'
import { isPointsCCW } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'

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

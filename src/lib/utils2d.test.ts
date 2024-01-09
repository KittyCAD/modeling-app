import { Coords2d } from 'lang/std/sketch'
import { roundOff } from './utils'
import { getTangentialArcToInfo } from './utils2d'
import { isPointsCCW, initPromise } from 'lang/wasm'

beforeAll(() => initPromise)

describe('testing getTangentialArcToInfo', () => {
  test('basic case', () => {
    // this test is working correctly, the implementation of getTangentialArcToInfo is incorrect
    const result = getTangentialArcToInfo({
      tanPreviousPoint: [0, -5],
      arcStartPoint: [0, 0],
      arcEndPoint: [4, 0],
    })
    expect(result.center).toEqual([2, 0])
    expect(result.arcMidPoint).toEqual([2, 2])
    expect(result.radius).toBe(2)
  })
  test('basic case with arc centered at 0,0 and the tangential line being 45degrees', () => {
    // this test is working correctly, the implementation of getTangentialArcToInfo is incorrect
    const result = getTangentialArcToInfo({
      tanPreviousPoint: [0, -4],
      arcStartPoint: [2, -2],
      arcEndPoint: [-2, 2],
    })
    expect(result.center).toEqual([0, 0])
    expect(result.arcMidPoint.map((a) => Math.round(a * 1000) / 1000)).toEqual([
      2, 2,
    ])
    expect(result.radius).toBe(Math.sqrt(2 * 2 + 2 * 2))
  })
  test('same as last test, just moving the arcEndPoint', () => {
    // this test is working correctly, the implementation of getTangentialArcToInfo is incorrect
    const result = getTangentialArcToInfo({
      tanPreviousPoint: [0, -4],
      arcStartPoint: [2, -2],
      arcEndPoint: [2, 2],
    })
    const expectedRadius = Math.sqrt(2 * 2 + 2 * 2)
    expect(result.center).toEqual([0, 0])
    expect(result.arcMidPoint).toEqual([expectedRadius, 0])
    expect(result.radius).toBe(expectedRadius)
  })
  test('same as last test again, just moving the arcEndPoint', () => {
    // this test is working correctly, the implementation of getTangentialArcToInfo is incorrect
    const result = getTangentialArcToInfo({
      tanPreviousPoint: [0, -4],
      arcStartPoint: [2, -2],
      arcEndPoint: [-2, -2],
    })
    const expectedRadius = Math.sqrt(2 * 2 + 2 * 2)
    expect(result.center).toEqual([0, 0])
    expect(result.radius).toBe(expectedRadius)
    expect(result.arcMidPoint.map((a) => roundOff(a, 3))).toEqual([
      0,
      roundOff(expectedRadius, 3),
    ])
  })
  test('same as last test again again but using acute, just moving the arcEndPoint', () => {
    // this test is working correctly, the implementation of getTangentialArcToInfo is incorrect
    const result = getTangentialArcToInfo({
      tanPreviousPoint: [0, -4],
      arcStartPoint: [2, -2],
      arcEndPoint: [-2, -2],
      obtuse: false,
    })
    const expectedRadius = Math.sqrt(2 * 2 + 2 * 2)
    expect(result.center).toEqual([0, 0])
    expect(result.radius).toBe(expectedRadius)
    expect(result.arcMidPoint.map((a) => roundOff(a, 3))).toEqual([
      0,
      roundOff(-expectedRadius, 3),
    ])
  })
  test('obtuse test with lots of wrap around', () => {
    // this test is working correctly, the implementation of getTangentialArcToInfo is incorrect
    const arcEnd = Math.cos(Math.PI / 4) * 2
    console.log('arcEnd', arcEnd)
    const result = getTangentialArcToInfo({
      tanPreviousPoint: [2, -4],
      arcStartPoint: [2, 0],
      // arcEndPoint: [arcEnd, -arcEnd],
      arcEndPoint: [0, -2],
      obtuse: true,
    })
    expect(result.center).toEqual([-0, 0])
    expect(result.radius).toBe(2)
    expect(result.arcMidPoint.map((a) => roundOff(a, 3))).toEqual(
      [-arcEnd, arcEnd].map((a) => roundOff(a, 3))
    )
    // expect(result.arcMidPoint.map((a) => roundOff(a, 3))).toEqual([
    //   -arcEnd,
    //   arcEnd,
    // ])
  })
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

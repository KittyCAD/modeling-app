import { getYComponent, getXComponent } from './sketch'

const eachQuad: [number, [number, number]][] = [
  [-315, [1, 1]],
  [-225, [-1, 1]],
  [-135, [-1, -1]],
  [-45, [1, -1]],
  [45, [1, 1]],
  [135, [-1, 1]],
  [225, [-1, -1]],
  [315, [1, -1]],
  [405, [1, 1]],
  [495, [-1, 1]],
  [585, [-1, -1]],
  [675, [1, -1]],
]

describe('testing getYComponent', () => {
  it('should return the vertical component of a vector correctly when given angles in each quadrant (and with angles < 0, or > 360)', () => {
    const expected: [number, number][] = []
    const results: [number, number][] = []
    eachQuad.forEach(([angle, expectedResult]) => {
      results.push(
        getYComponent(angle, 1).map((a) => Math.round(a)) as [number, number]
      )
      expected.push(expectedResult)
    })
    expect(results).toEqual(expected)
  })
  it('return extreme values on the extremes', () => {
    let result: [number, number]
    result = getYComponent(0, 1)
    expect(result[0]).toBe(1)
    expect(result[1]).toBe(0)

    result = getYComponent(90, 1)
    expect(result[0]).toBe(1)
    expect(result[1]).toBeGreaterThan(100000)

    result = getYComponent(180, 1)
    expect(result[0]).toBe(-1)
    expect(result[1]).toBeCloseTo(0)

    result = getYComponent(270, 1)
    expect(result[0]).toBe(-1)
    expect(result[1]).toBeLessThan(100000)
  })
})

describe('testing getXComponent', () => {
  it('should return the horizontal component of a vector correctly when given angles in each quadrant (and with angles < 0, or > 360)', () => {
    const expected: [number, number][] = []
    const results: [number, number][] = []
    eachQuad.forEach(([angle, expectedResult]) => {
      results.push(
        getXComponent(angle, 1).map((a) => Math.round(a)) as [number, number]
      )
      expected.push(expectedResult)
    })
    expect(results).toEqual(expected)
  })
  it('return extreme values on the extremes', () => {
    let result: [number, number]
    result = getXComponent(0, 1)
    expect(result[0]).toBeGreaterThan(100000)
    expect(result[1]).toBe(1)

    result = getXComponent(90, 1)
    expect(result[0]).toBeCloseTo(0)
    expect(result[1]).toBe(1)

    result = getXComponent(180, 1)
    expect(result[0]).toBeLessThan(100000)
    expect(result[1]).toBe(1)

    result = getXComponent(270, 1)
    expect(result[0]).toBeCloseTo(0)
    expect(result[1]).toBe(-1)
  })
})

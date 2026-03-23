import { describe, expect, it } from 'vitest'

import { getAngledRectangleCorners } from '@src/machines/sketchSolve/tools/rectUtils'

describe('rectUtils.getAngledRectangleCorners', () => {
  it('builds a rectangle from a horizontal first side and perpendicular third point', () => {
    const corners = getAngledRectangleCorners({
      p1: [0, 0],
      p2: [4, 0],
      p3: [2, 3],
    })

    expect(corners.start1).toEqual([0, 0])
    expect(corners.start2).toEqual([4, 0])
    expect(corners.start3).toEqual([4, 3])
    expect(corners.start4).toEqual([0, 3])
  })

  it('uses only perpendicular distance to define rectangle width', () => {
    const corners = getAngledRectangleCorners({
      p1: [1, 1],
      p2: [3, 3],
      p3: [4, 2],
    })

    expect(corners.start1).toEqual([1, 1])
    expect(corners.start2).toEqual([3, 3])
    expect(corners.start3).toEqual([4, 2])
    expect(corners.start4[0]).toBeCloseTo(2)
    expect(corners.start4[1]).toBeCloseTo(0)
  })
})

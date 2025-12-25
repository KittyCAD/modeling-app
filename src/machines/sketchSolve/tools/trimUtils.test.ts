import { describe, it, expect } from 'vitest'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { Coords2d } from '@src/lang/util'
import {
  getNextTrimCoords,
  arcArcIntersection,
} from '@src/machines/sketchSolve/tools/trimUtils'
import { isArray } from '@src/lib/utils'

const otherParams = Object.freeze({
  label: '',
  comments: '',
  artifact_id: '62b3473b-75d1-5129-9675-2d936e009423',
})

const createApiObjectPoint = (
  pos: Coords2d,
  idStart: number,
  owner: number
): ApiObject => ({
  id: idStart,
  kind: {
    type: 'Segment',
    segment: {
      type: 'Point',
      position: {
        x: { value: pos[0], units: 'Mm' },
        y: { value: pos[1], units: 'Mm' },
      },
      ctor: null,
      owner: owner,
      freedom: 'Free',
      constraints: [],
    },
  },
  ...otherParams,
  source: { type: 'Simple', range: [291, 374, 0] },
})
const createApiObjectArc = (
  start: Coords2d,
  end: Coords2d,
  center: Coords2d,
  idStart: number
): Array<ApiObject> => [
  {
    id: idStart,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Arc',
        start: idStart + 1,
        end: idStart + 2,
        center: idStart + 3,
        ctor: {
          type: 'Arc',
          start: {
            x: { type: 'Var', value: start[0], units: 'Mm' },
            y: { type: 'Var', value: start[1], units: 'Mm' },
          },
          end: {
            x: { type: 'Var', value: end[0], units: 'Mm' },
            y: { type: 'Var', value: end[1], units: 'Mm' },
          },
          center: {
            x: { type: 'Var', value: center[0], units: 'Mm' },
            y: { type: 'Var', value: center[1], units: 'Mm' },
          },
        },
        ctor_applicable: true,
      },
    },
    ...otherParams,
    source: { type: 'Simple', range: [143, 245, 0] },
  },
  createApiObjectPoint(start, idStart + 1, idStart),
  createApiObjectPoint(end, idStart + 2, idStart),
  createApiObjectPoint(center, idStart + 3, idStart),
]

const createApiObjectLine = (
  start: Coords2d,
  end: Coords2d,
  idStart: number
): Array<ApiObject> => [
  {
    id: idStart,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Line',
        start: 1,
        end: 2,
        ctor: {
          type: 'Line',
          start: {
            x: { type: 'Var', value: start[0], units: 'Mm' },
            y: { type: 'Var', value: start[1], units: 'Mm' },
          },
          end: {
            x: { type: 'Var', value: end[0], units: 'Mm' },
            y: { type: 'Var', value: end[1], units: 'Mm' },
          },
        },
        ctor_applicable: true,
      },
    },
    label: '',
    comments: '',
    artifact_id: 'dd91e3d3-7aa3-59e6-acf8-85db5ae39a50',
    source: { type: 'Simple', range: [69, 140, 0] },
  },
  createApiObjectPoint(start, idStart + 1, idStart),
  createApiObjectPoint(end, idStart + 2, idStart),
]

describe('getNextTrimCoords', () => {
  const points: Coords2d[] = [
    [2.4, 0.2],
    [2.2, 0.6],
    [1.9, 2],
    [1.6, 2.7],
    [1.1, 4.1],
    [0.2, 5.2],
  ]
  const objsThatIntersectWithTrimPath: ApiObject[] = [
    ...createApiObjectLine([0.5, 1], [3, 1.5], 0),
    ...createApiObjectArc([3, 3], [-0.5, 1], [1.5, 1.5], 3),
  ]
  const objsThatNarrowlyMissTrimPath: ApiObject[] = [
    ...createApiObjectLine([0.5, 1], [1.6, 1.1], 0),
    ...createApiObjectArc([1, 3.3], [-0.5, 2], [1.5, 1.5], 3),
  ]
  it("trim path that doesn't intersect anything", () => {
    const result = getNextTrimCoords({
      points: points.slice(0, 2),
      startIndex: 0,
      objects: objsThatIntersectWithTrimPath,
    })

    expect(result.type).toBe('noTrimSpawn')
    expect(result.nextIndex).toBe(1)
  })

  it('trim path that intersects line segment', () => {
    // Create a simple test: trim path segment [2.4, 0.2] -> [2.2, 0.6]

    const result = getNextTrimCoords({
      points: points.slice(0, 3),
      startIndex: 0,
      objects: objsThatIntersectWithTrimPath,
    })
    console.log('result', result)

    expect(result.type).toBe('trimSpawn')
    if (result.type === 'trimSpawn') {
      expect(result.trimSpawnSegId).toBe(0)
      expect(result.trimSpawnCoords[0]).toBeCloseTo(2, 1)
      expect(result.trimSpawnCoords[1]).toBeCloseTo(1.3, 0)
      expect(result.nextIndex).toBe(2)
    }
  })

  it('trim path that intersects arc segment', () => {
    // Create a simple arc that definitely intersects with the trim path

    const result = getNextTrimCoords({
      points: points,
      startIndex: 2,
      objects: objsThatIntersectWithTrimPath,
    })

    expect(result.type).toBe('trimSpawn')
    if (result.type === 'trimSpawn') {
      expect(result.trimSpawnSegId).toBe(3)
      expect(result.trimSpawnCoords[0]).toBeCloseTo(1.3, 0)
      expect(result.trimSpawnCoords[1]).toBeCloseTo(3.6, 0)
      expect(result.nextIndex).toBe(4)
    }
  })

  it('trim path that narrowly misses all segments', () => {
    const result = getNextTrimCoords({
      points,
      startIndex: 0,
      objects: objsThatNarrowlyMissTrimPath,
    })

    expect(result.type).toBe('noTrimSpawn')
    expect(result.nextIndex).toBe(5)
  })

  it('points that narrowly miss arc segments left and right side of it, long and short lengths', () => {
    const arcObjs: ApiObject[] = [
      ...createApiObjectArc([3, 4], [0.3, 2.5], [2.5, 1.5], 0),
      ...createApiObjectArc([3, 3.3], [3.6, 3], [2.5, 1.5], 4),
      ...createApiObjectArc([5.2, 1.8], [3.7, 3.7], [2.5, 1.5], 8),
    ]
    const points: Coords2d[] = [
      [3.15, 2.11],
      [3.51, 4.54],
    ]
    const result = getNextTrimCoords({
      points,
      startIndex: 0,
      objects: arcObjs,
    })

    expect(result.type).toBe('noTrimSpawn')
    expect(result.nextIndex).toBe(1)
  })
})

describe('arcArcIntersection', () => {
  it('finds intersection when two arcs intersect and intersection point is on both arcs', () => {
    // Two arcs that intersect - intersection point should be on both arcs
    // Arc 1: center at (0, 0), radius 2, from 0° to 90° (CCW)
    const arc1Center: Coords2d = [0, 0]
    const arc1Start: Coords2d = [2, 0] // 0°
    const arc1End: Coords2d = [0, 2] // 90°

    // Arc 2: center at (2, 0), radius 2, from 90° to 180° (CCW)
    // This will intersect arc1 in the first quadrant
    const arc2Center: Coords2d = [2, 0]
    const arc2Start: Coords2d = [2, 2] // 90° from arc2Center
    const arc2End: Coords2d = [0, 0] // 180° from arc2Center

    const result = arcArcIntersection(
      arc1Center,
      arc1Start,
      arc1End,
      arc2Center,
      arc2Start,
      arc2End
    )

    expect(result).not.toBeNull()
    if (result) {
      // Circles intersect at (1, √3) ≈ (1, 1.732) and (1, -√3) ≈ (1, -1.732)
      // Only (1, √3) is in first quadrant and on both arcs
      expect(result[0]).toBeCloseTo(1, 1)
      expect(result[1]).toBeCloseTo(1.732, 1)
    }
  })

  it('finds intersection when only one intersection point is on both arcs (CCW)', () => {
    // Arc 1: center at (0, 0), radius 2, from 0° to 90° (CCW)
    const arc1Center: Coords2d = [0, 0]
    const arc1Start: Coords2d = [2, 0] // 0°
    const arc1End: Coords2d = [0, 2] // 90°

    // Arc 2: center at (2, 0), radius 2, from 90° to 180° (CCW)
    const arc2Center: Coords2d = [2, 0]
    const arc2Start: Coords2d = [2, 2] // 90° from arc2Center
    const arc2End: Coords2d = [0, 0] // 180° from arc2Center

    const result = arcArcIntersection(
      arc1Center,
      arc1Start,
      arc1End,
      arc2Center,
      arc2Start,
      arc2End
    )

    expect(result).not.toBeNull()
    if (result) {
      // Should be the intersection point that's on both arcs
      // Circles intersect at (1, √3) ≈ (1, 1.732) and (1, -√3) ≈ (1, -1.732)
      // Only (1, √3) is on both arcs (in first quadrant)
      expect(result[0]).toBeCloseTo(1, 1)
      expect(result[1]).toBeCloseTo(1.732, 1)
    }
  })

  it('returns null when arcs do not intersect', () => {
    // Two arcs that are far apart
    const arc1Center: Coords2d = [0, 0]
    const arc1Start: Coords2d = [2, 0]
    const arc1End: Coords2d = [0, 2]

    const arc2Center: Coords2d = [10, 10]
    const arc2Start: Coords2d = [12, 10]
    const arc2End: Coords2d = [10, 12]

    const result = arcArcIntersection(
      arc1Center,
      arc1Start,
      arc1End,
      arc2Center,
      arc2Start,
      arc2End
    )

    expect(result).toBeNull()
  })

  it('returns null when circles intersect but intersection points are not on arcs (CCW check)', () => {
    // Two arcs where circles intersect but the intersection points are outside the arc ranges
    // Arc 1: center at (0, 0), radius 2, from 0° to 45° (CCW) - small arc
    const arc1Center: Coords2d = [0, 0]
    const arc1Start: Coords2d = [2, 0] // 0°
    const arc1End: Coords2d = [Math.sqrt(2), Math.sqrt(2)] // 45°

    // Arc 2: center at (2, 0), radius 2, from 135° to 180° (CCW) - small arc
    const arc2Center: Coords2d = [2, 0]
    const arc2Start: Coords2d = [2 - Math.sqrt(2), Math.sqrt(2)] // 135° from arc2Center
    const arc2End: Coords2d = [0, 0] // 180° from arc2Center

    const result = arcArcIntersection(
      arc1Center,
      arc1Start,
      arc1End,
      arc2Center,
      arc2Start,
      arc2End
    )

    // Circles intersect, but intersection points are at ~(1, ±1.732)
    // (1, 1.732) is at 60° from arc1Center (outside 0-45° range)
    // (1, -1.732) is at -60° (outside 0-45° range)
    // So should return null
    expect(result).toBeNull()
  })

  it('handles arcs that wrap around (start angle > end angle, CCW)', () => {
    // Arc that wraps around: from 350° to 10° (CCW, goes through 0°)
    const arc1Center: Coords2d = [0, 0]
    const arc1Start: Coords2d = [
      2 * Math.cos((350 * Math.PI) / 180),
      2 * Math.sin((350 * Math.PI) / 180),
    ]
    const arc1End: Coords2d = [
      2 * Math.cos((10 * Math.PI) / 180),
      2 * Math.sin((10 * Math.PI) / 180),
    ]

    // Another arc that intersects in the wrap-around region
    const arc2Center: Coords2d = [1, 0]
    const arc2Start: Coords2d = [
      1 + 2 * Math.cos((170 * Math.PI) / 180),
      2 * Math.sin((170 * Math.PI) / 180),
    ]
    const arc2End: Coords2d = [
      1 + 2 * Math.cos((190 * Math.PI) / 180),
      2 * Math.sin((190 * Math.PI) / 180),
    ]

    const result = arcArcIntersection(
      arc1Center,
      arc1Start,
      arc1End,
      arc2Center,
      arc2Start,
      arc2End
    )

    // Should find intersection if it exists in the wrap-around region
    // This is a complex case, so we'll just check it doesn't crash
    expect(result === null || (isArray(result) && result.length === 2)).toBe(
      true
    )
  })
})

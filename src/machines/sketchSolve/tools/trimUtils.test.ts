import { describe, it, expect } from 'vitest'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { Coords2d } from '@src/lang/util'
import {
  getNextTrimCoords,
  getTrimSpawnTerminations,
} from '@src/machines/sketchSolve/tools/trimUtils'

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
      expect(result.nextIndex).toBe(1)
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
      expect(result.nextIndex).toBe(3)
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

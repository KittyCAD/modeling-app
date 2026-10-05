import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { ORIGIN_TARGET } from '@src/machines/sketchSolve/sketchSolveSelection'
import {
  GRID_TARGET,
  getCoincidentSegmentsForSnapTarget,
  getConstraintForSnapTarget,
  getSnappingCandidates,
  X_AXIS_TARGET,
  Y_AXIS_TARGET,
} from '@src/machines/sketchSolve/snapping'
import {
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it } from 'vitest'

function createObjectsArray(objects: ApiObject[]) {
  return createSceneGraphDelta(objects).new_graph.objects
}

const gridSnapOptions = {
  majorGridSpacing: 2,
  minorGridsPerMajor: 4,
  snapsPerMinor: 2,
  pixelsPerBaseUnit: 100,
  fixedSizeGrid: true,
}

describe('getSnappingCandidates', () => {
  it('prioritizes the origin over axis snaps even when an axis is closer', () => {
    const result = getSnappingCandidates(
      [0.4, 0.1],
      createObjectsArray([]),
      createMockSceneInfra()
    )

    expect(result[0]?.target.type).toBe(ORIGIN_TARGET)
    expect(result[1]?.target.type).toBe(X_AXIS_TARGET)
    expect(result[2]?.target.type).toBe(Y_AXIS_TARGET)
  })

  it('prioritizes point snaps ahead of origin and axes', () => {
    const point = createPointApiObject({ id: 8, x: 8, y: 0 })

    const result = getSnappingCandidates(
      [3, 0],
      createObjectsArray([point]),
      createMockSceneInfra()
    )

    expect(result[0]?.target.type).toBe('point')
    expect(result[1]?.target.type).toBe(ORIGIN_TARGET)
    expect(result[2]?.target.type).toBe(X_AXIS_TARGET)
    expect(result[3]?.target.type).toBe(Y_AXIS_TARGET)
  })

  it('uses the grid as the lowest-priority fallback', () => {
    const point = createPointApiObject({ id: 8, x: 8, y: 0 })

    const result = getSnappingCandidates(
      [3, 0],
      createObjectsArray([point]),
      createMockSceneInfra(),
      gridSnapOptions
    )

    expect(result.map((candidate) => candidate.target.type)).toEqual([
      'point',
      ORIGIN_TARGET,
      X_AXIS_TARGET,
      Y_AXIS_TARGET,
      GRID_TARGET,
    ])
  })

  it('quantizes to the grid when there are no geometric candidates', () => {
    const result = getSnappingCandidates(
      [20.37, 30.62],
      createObjectsArray([]),
      createMockSceneInfra(),
      gridSnapOptions
    )

    expect(result).toEqual([
      {
        target: { type: GRID_TARGET },
        distance: expect.any(Number),
        position: [20.25, 30.5],
      },
    ])
  })
})

describe('grid snap constraints', () => {
  it('does not create a solver constraint', () => {
    expect(getConstraintForSnapTarget(5, { type: GRID_TARGET })).toBeNull()
    expect(
      getCoincidentSegmentsForSnapTarget(5, { type: GRID_TARGET })
    ).toBeNull()
  })
})

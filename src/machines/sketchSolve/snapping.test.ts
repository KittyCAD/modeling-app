import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { ORIGIN_TARGET } from '@src/machines/sketchSolve/sketchSolveSelection'
import {
  X_AXIS_TARGET,
  Y_AXIS_TARGET,
  getSnappingCandidates,
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
})

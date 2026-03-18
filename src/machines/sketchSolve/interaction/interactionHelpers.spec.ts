import { describe, expect, it } from 'vitest'
import type { Coords2d } from '@src/lang/util'
import { findClosestApiObjects } from '@src/machines/sketchSolve/interaction/interactionHelpers'
import type { SolveActionArgs } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  createLineApiObject,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

type SketchSolveSnapshot = ReturnType<SolveActionArgs['self']['getSnapshot']>

function createSnapshot(objects: Parameters<typeof createSceneGraphDelta>[0]) {
  return {
    context: {
      sketchExecOutcome: {
        sceneGraphDelta: createSceneGraphDelta(objects),
      },
    },
  } as SketchSolveSnapshot
}

describe('findClosestApiObjects', () => {
  it('includes line segments and sorts by perpendicular distance', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 10, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const farPoint = createPointApiObject({ id: 4, x: 20, y: 20 })

    const result = findClosestApiObjects(
      [5, 3],
      createSnapshot([start, end, line, farPoint]),
      createMockSceneInfra()
    )

    expect(result[0]?.apiObject.id).toBe(3)
    expect(result[0]?.distance).toBeCloseTo(3)
  })

  it('clamps line distance to the nearest endpoint', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 10, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })

    const result = findClosestApiObjects(
      [12, 4],
      createSnapshot([start, end, line]),
      createMockSceneInfra()
    )
    const lineResult = result.find(({ apiObject }) => apiObject.id === 3)

    expect(lineResult?.distance).toBeCloseTo(Math.sqrt(20))
  })

  it('sorts points and lines together in one distance-ordered list', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 10, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const point = createPointApiObject({ id: 4, x: 5, y: 1 })
    const mousePosition: Coords2d = [5, 1.25]

    const result = findClosestApiObjects(
      mousePosition,
      createSnapshot([start, end, line, point]),
      createMockSceneInfra()
    )

    expect(result[0]?.apiObject.id).toBe(4)
    expect(result[1]?.apiObject.id).toBe(3)
  })
})

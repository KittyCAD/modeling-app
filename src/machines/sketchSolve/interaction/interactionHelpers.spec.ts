import { describe, expect, it } from 'vitest'
import type { Coords2d } from '@src/lang/util'
import { findClosestApiObjects } from '@src/machines/sketchSolve/interaction/interactionHelpers'
import type { SolveActionArgs } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  createArcApiObject,
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
  it('includes line segments when they are within the 12px threshold', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const farPoint = createPointApiObject({ id: 4, x: 20, y: 20 })

    const result = findClosestApiObjects(
      [20, 3],
      createSnapshot([start, end, line, farPoint]),
      createMockSceneInfra()
    )

    expect(result[0]?.apiObject.id).toBe(3)
    expect(result[0]?.distance).toBeCloseTo(3)
    expect(result).toHaveLength(1)
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

  it('sorts points ahead of lines when both are within the threshold', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const point = createPointApiObject({ id: 4, x: 20, y: 10 })
    const mousePosition: Coords2d = [20, 4]

    const result = findClosestApiObjects(
      mousePosition,
      createSnapshot([start, end, line, point]),
      createMockSceneInfra()
    )

    expect(result[0]?.apiObject.id).toBe(4)
    expect(result[1]?.apiObject.id).toBe(3)
  })

  it('filters out candidates that are beyond the threshold', () => {
    const point = createPointApiObject({ id: 1, x: 30, y: 30 })

    const result = findClosestApiObjects(
      [0, 0],
      createSnapshot([point]),
      createMockSceneInfra()
    )

    expect(result).toEqual([])
  })

  it('includes arcs when the mouse is within the arc stroke threshold', () => {
    const center = createPointApiObject({ id: 1, x: 0, y: 0 })
    const start = createPointApiObject({ id: 2, x: 30, y: 0 })
    const end = createPointApiObject({ id: 3, x: 0, y: 30 })
    const arc = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })

    const result = findClosestApiObjects(
      [21, 21],
      createSnapshot([center, start, end, arc]),
      createMockSceneInfra()
    )

    expect(result[0]?.apiObject.id).toBe(4)
    expect(result[0]?.distance).toBeCloseTo(
      Math.abs(Math.sqrt(882) - 30),
      5
    )
  })

  it('sorts lines and arcs by distance within the same priority bucket', () => {
    const lineStart = createPointApiObject({ id: 1, x: 0, y: 16 })
    const lineEnd = createPointApiObject({ id: 2, x: 40, y: 16 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const arcCenter = createPointApiObject({ id: 4, x: 0, y: 0 })
    const arcStart = createPointApiObject({ id: 5, x: 30, y: 0 })
    const arcEnd = createPointApiObject({ id: 6, x: 0, y: 30 })
    const arc = createArcApiObject({ id: 7, center: 4, start: 5, end: 6 })

    const result = findClosestApiObjects(
      [21, 21],
      createSnapshot([
        lineStart,
        lineEnd,
        line,
        arcCenter,
        arcStart,
        arcEnd,
        arc,
      ]),
      createMockSceneInfra()
    )

    expect(result[0]?.apiObject.id).toBe(7)
    expect(result[1]?.apiObject.id).toBe(3)
  })
})

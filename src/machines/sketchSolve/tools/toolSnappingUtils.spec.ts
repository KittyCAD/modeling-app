import { describe, expect, it, vi } from 'vitest'

import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  getBestSnappingCandidate,
  sendHoveredSnappingCandidate,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'
import {
  createLineApiObject,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

function createSketchApiObject({ id }: { id: number }): ApiObject {
  return {
    id,
    kind: {
      type: 'Sketch',
      args: { on: { default: 'xy' } },
      constraints: [3],
      plane: 8,
      segments: [0, 1, 2],
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  } satisfies ApiObject
}

describe('toolSnappingUtils', () => {
  it('sends the snapped segment id for non-point snapping targets', () => {
    const send = vi.fn()

    sendHoveredSnappingCandidate(
      {
        _parent: {
          send,
        },
      },
      {
        target: { type: 'line', id: 6 },
        distance: 2,
        position: [32, 55],
      }
    )

    expect(send).toHaveBeenCalledWith({
      type: 'update hovered id',
      data: {
        hoveredId: 6,
      },
    })
  })

  it('skips the excluded point owner segment and falls through to another segment target', () => {
    const draftStart = createPointApiObject({ id: 1, x: 20, y: 50, owner: 3 })
    const draftEnd = createPointApiObject({ id: 2, x: 30, y: 50, owner: 3 })
    const draftLine = createLineApiObject({ id: 3, start: 1, end: 2 })
    const otherStart = createPointApiObject({ id: 4, x: 32, y: 30, owner: 6 })
    const otherEnd = createPointApiObject({ id: 5, x: 32, y: 70, owner: 6 })
    const otherLine = createLineApiObject({ id: 6, start: 4, end: 5 })
    const sceneGraphDelta = createSceneGraphDelta([
      createSketchApiObject({ id: 0 }),
      draftStart,
      draftEnd,
      draftLine,
      otherStart,
      otherEnd,
      otherLine,
    ])

    const candidate = getBestSnappingCandidate({
      self: {
        _parent: {
          getSnapshot: () => ({
            context: {
              sketchExecOutcome: {
                sceneGraphDelta,
              },
            },
          }),
        },
      },
      sceneInfra: createMockSceneInfra(),
      sketchId: 0,
      mousePosition: [30, 55],
      mouseEvent: new MouseEvent('mousemove'),
      excludedPointIds: [2],
    })

    expect(candidate?.target).toEqual({ type: 'line', id: 6 })
    expect(candidate?.position).toEqual([32, 55])
  })

  it('skips owned control-polygon edges for excluded spline control points', () => {
    const splinePointA = createPointApiObject({ id: 1, x: 20, y: 50, owner: 9 })
    const splinePointB = createPointApiObject({ id: 2, x: 30, y: 50, owner: 9 })
    const splinePointC = createPointApiObject({ id: 3, x: 40, y: 50, owner: 9 })
    const splineEdge = createLineApiObject({
      id: 4,
      start: 2,
      end: 3,
      owner: 9,
    })
    const otherStart = createPointApiObject({ id: 5, x: 32, y: 30, owner: 10 })
    const otherEnd = createPointApiObject({ id: 6, x: 32, y: 70, owner: 10 })
    const otherLine = createLineApiObject({ id: 7, start: 5, end: 6 })
    const spline = {
      id: 9,
      kind: {
        type: 'Segment' as const,
        segment: {
          type: 'ControlPointSpline' as const,
          controls: [1, 2, 3],
          degree: 2,
          ctor: {
            type: 'ControlPointSpline' as const,
            points: [],
            construction: false,
          },
          ctor_applicable: false,
          construction: false,
        },
      },
      label: '',
      comments: '',
      artifact_id: '0',
      source: { type: 'Simple' as const, range: [0, 0, 0], node_path: null },
    } as ApiObject
    const sceneGraphDelta = createSceneGraphDelta([
      createSketchApiObject({ id: 0 }),
      splinePointA,
      splinePointB,
      splinePointC,
      splineEdge,
      otherStart,
      otherEnd,
      otherLine,
      spline,
    ])

    const candidate = getBestSnappingCandidate({
      self: {
        _parent: {
          getSnapshot: () => ({
            context: {
              sketchExecOutcome: {
                sceneGraphDelta,
              },
            },
          }),
        },
      },
      sceneInfra: createMockSceneInfra(),
      sketchId: 0,
      mousePosition: [31, 50],
      mouseEvent: new MouseEvent('mousemove'),
      excludedPointIds: [1, 2, 3],
    })

    expect(candidate?.target).toEqual({ type: 'line', id: 7 })
    expect(candidate?.position).toEqual([32, 50])
  })
})

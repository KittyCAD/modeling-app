import { describe, expect, it, vi } from 'vitest'
import type { Vector2 } from 'three'
import { OrthographicCamera, PerspectiveCamera } from 'three'

import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { InfiniteGridRenderer } from '@src/clientSideScene/InfiniteGridRenderer'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import {
  GRID_TARGET,
  getObjectIdForSnapTarget,
} from '@src/machines/sketchSolve/snapping'
import {
  createLineApiObject,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import {
  getBestSnappingCandidate,
  sendHoveredSnappingCandidate,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'

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

function createGridSceneInfra({
  perspective = false,
}: {
  perspective?: boolean
} = {}): SceneInfra {
  const gridRenderer = new InfiniteGridRenderer()
  vi.spyOn(gridRenderer, 'getPixelsPerBaseUnit').mockReturnValue(100)

  return {
    ...createMockSceneInfra(),
    camControls: {
      camera: perspective
        ? new PerspectiveCamera(45, 1, 0.1, 100)
        : new OrthographicCamera(),
    },
    renderer: {
      getDrawingBufferSize: vi.fn((target: Vector2) => target.set(1_000, 800)),
    },
    scene: {
      getObjectByName: vi.fn(() => gridRenderer),
    },
  } as unknown as SceneInfra
}

function createGridSelf({
  snapToGrid,
  sceneGraphDelta,
}: {
  snapToGrid: boolean
  sceneGraphDelta?: ReturnType<typeof createSceneGraphDelta>
}) {
  return {
    _parent: {
      getSnapshot: () => ({
        context: {
          rustContext: {
            settingsActor: {
              getSnapshot: () => ({
                context: {
                  modeling: {
                    snapToGrid: { current: snapToGrid },
                    fixedSizeGrid: { current: true },
                    majorGridSpacing: { current: 2 },
                    minorGridsPerMajor: { current: 4 },
                    snapsPerMinor: { current: 2 },
                  },
                },
              }),
            },
          },
          sketchExecOutcome: sceneGraphDelta
            ? {
                sceneGraphDelta,
              }
            : undefined,
        },
      }),
    },
  } as unknown as Parameters<typeof getBestSnappingCandidate>[0]['self']
}

describe('toolSnappingUtils', () => {
  it('snaps to the grid when sketch graph objects are empty or unavailable', () => {
    const sceneInfra = createGridSceneInfra()
    const mousePosition: [number, number] = [20.37, 30.62]

    for (const sceneGraphDelta of [undefined, createSceneGraphDelta([])]) {
      const candidate = getBestSnappingCandidate({
        self: createGridSelf({ snapToGrid: true, sceneGraphDelta }),
        sceneInfra,
        sketchId: 0,
        mousePosition,
        mouseEvent: new MouseEvent('mousemove'),
      })

      expect(candidate).toMatchObject({
        target: { type: GRID_TARGET },
        position: [20.25, 30.5],
      })
    }
  })

  it('snaps to the grid with a perspective camera', () => {
    const candidate = getBestSnappingCandidate({
      self: createGridSelf({ snapToGrid: true }),
      sceneInfra: createGridSceneInfra({ perspective: true }),
      sketchId: 0,
      mousePosition: [20.37, 30.62],
      mouseEvent: new MouseEvent('mousemove'),
    })

    expect(candidate).toMatchObject({
      target: { type: GRID_TARGET },
      position: [20.25, 30.5],
    })
  })

  it('does not add a grid candidate when snap to grid is disabled', () => {
    const candidate = getBestSnappingCandidate({
      self: createGridSelf({ snapToGrid: false }),
      sceneInfra: createGridSceneInfra(),
      sketchId: 0,
      mousePosition: [20.37, 30.62],
      mouseEvent: new MouseEvent('mousemove'),
    })

    expect(candidate).toBeNull()
  })

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

  it('skips the excluded point owner segment and falls through to another segment midpoint target', () => {
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

    expect(candidate?.target).toEqual({ type: 'midpoint', id: 6 })
    expect(candidate?.position).toEqual([32, 50])
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

    expect(candidate?.target).toEqual({ type: 'midpoint', id: 7 })
    expect(candidate?.position).toEqual([32, 50])
  })

  it('allows snapping back to the first spline control point without re-enabling its owned edges', () => {
    const splinePointA = createPointApiObject({ id: 1, x: 20, y: 50, owner: 9 })
    const splinePointB = createPointApiObject({ id: 2, x: 30, y: 50, owner: 9 })
    const splinePointC = createPointApiObject({ id: 3, x: 40, y: 50, owner: 9 })
    const splineEdge = createLineApiObject({
      id: 4,
      start: 1,
      end: 2,
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
      mousePosition: [20, 50],
      mouseEvent: new MouseEvent('mousemove'),
      excludedPointIds: [1, 2, 3],
      isCandidateAllowed: ({
        candidate,
        excludedPointIdSet,
        currentSketchObjects,
        excludedSegmentIdSet,
      }) => {
        if (candidate.target.type === 'point' && candidate.target.id === 1) {
          return true
        }

        if (candidate.target.type === 'point') {
          return !excludedPointIdSet.has(candidate.target.id)
        }

        const snapTargetSegmentId = getObjectIdForSnapTarget(candidate.target)
        if (snapTargetSegmentId === null) {
          return true
        }

        const snapTargetSegment = currentSketchObjects[snapTargetSegmentId]
        const snapTargetOwnerId =
          snapTargetSegment &&
          'kind' in snapTargetSegment &&
          snapTargetSegment.kind.type === 'Segment' &&
          'owner' in snapTargetSegment.kind.segment
            ? snapTargetSegment.kind.segment.owner
            : null

        return (
          !excludedSegmentIdSet.has(snapTargetSegmentId) &&
          (snapTargetOwnerId == null ||
            !excludedSegmentIdSet.has(snapTargetOwnerId))
        )
      },
    })

    expect(candidate?.target).toEqual({ type: 'point', id: 1 })
    expect(candidate?.position).toEqual([20, 50])
  })
})

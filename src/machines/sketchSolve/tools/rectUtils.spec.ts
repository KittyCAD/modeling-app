import type {
  ApiConstraint,
  ApiObject,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { describe, expect, it, vi } from 'vitest'

import {
  createDraftRectangle,
  getAngledRectangleCorners,
  updateDraftRectangleAligned,
} from '@src/machines/sketchSolve/tools/rectUtils'
import { MIN_DRAFT_GEOMETRY_DELTA_MM } from '@src/machines/sketchSolve/tools/draftGeometryPolicy'
import {
  createLineApiObject,
  createMockKclManager,
  createMockRustContext,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

function createConstraintApiObject(
  id: number,
  constraint: ApiConstraint
): ApiObject {
  return {
    id,
    kind: {
      type: 'Constraint',
      constraint,
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  } as ApiObject
}

function createLineSceneGraphDelta(
  lineId: number,
  startPointId: number,
  endPointId: number
): SceneGraphDelta {
  return createSceneGraphDelta(
    [
      createPointApiObject({ id: startPointId }),
      createPointApiObject({ id: endPointId }),
      createLineApiObject({ id: lineId, start: startPointId, end: endPointId }),
    ],
    [startPointId, endPointId, lineId]
  )
}

function createPointSceneGraphDelta(pointId: number): SceneGraphDelta {
  return createSceneGraphDelta(
    [createPointApiObject({ id: pointId })],
    [pointId]
  )
}

function createConstraintSceneGraphDelta(
  constraintId: number,
  constraint: ApiConstraint
): SceneGraphDelta {
  return createSceneGraphDelta(
    [createConstraintApiObject(constraintId, constraint)],
    [constraintId]
  )
}

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

describe('rectUtils.createDraftRectangle', () => {
  it('adds center rectangle construction geometry and constraints in center mode', async () => {
    const rustContext = createMockRustContext()
    const kclManager = createMockKclManager()
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const addSegmentMock = vi.mocked(rustContext.addSegment)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const addConstraintMock = vi.mocked(rustContext.addConstraint)

    addSegmentMock
      .mockResolvedValueOnce({
        kclSource: { text: 'center-point' } as SourceDelta,
        sceneGraphDelta: createPointSceneGraphDelta(100),
      })
      .mockResolvedValueOnce({
        kclSource: { text: 'line-1' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(1, 11, 12),
      })
      .mockResolvedValueOnce({
        kclSource: { text: 'line-2' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(2, 13, 14),
      })
      .mockResolvedValueOnce({
        kclSource: { text: 'line-3' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(3, 15, 16),
      })
      .mockResolvedValueOnce({
        kclSource: { text: 'line-4' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(4, 17, 18),
      })
      .mockResolvedValueOnce({
        kclSource: { text: 'diag-1' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(5, 19, 20),
      })
      .mockResolvedValueOnce({
        kclSource: { text: 'diag-2' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(6, 21, 22),
      })

    const constraintTypes: ApiConstraint[] = [
      { type: 'Coincident', segments: [12, 13] },
      { type: 'Coincident', segments: [14, 15] },
      { type: 'Coincident', segments: [16, 17] },
      { type: 'Coincident', segments: [18, 11] },
      { type: 'Parallel', lines: [2, 4] },
      { type: 'Parallel', lines: [3, 1] },
      { type: 'Perpendicular', lines: [1, 2] },
      { type: 'Horizontal', line: 3 } as unknown as ApiConstraint,
      { type: 'Coincident', segments: [19, 11] },
      { type: 'Coincident', segments: [20, 14] },
      { type: 'Coincident', segments: [21, 12] },
      { type: 'Coincident', segments: [22, 17] },
      { type: 'Coincident', segments: [100, 5] },
      { type: 'Coincident', segments: [100, 6] },
      { type: 'LinesEqualLength', lines: [5, 6] },
    ]

    let constraintIndex = 0
    addConstraintMock.mockImplementation(
      async (_version, _sketchId, constraint) => {
        const index = constraintIndex
        constraintIndex += 1
        return {
          kclSource: { text: `constraint-${index}` } as SourceDelta,
          sceneGraphDelta: createConstraintSceneGraphDelta(
            200 + index,
            constraintTypes[index] ?? constraint
          ),
        }
      }
    )

    const result = await createDraftRectangle({
      rustContext,
      kclManager,
      sketchId: 7,
      mode: 'center',
      origin: [12, 8],
    })

    expect(addSegmentMock).toHaveBeenCalledTimes(7)
    expect(addConstraintMock).toHaveBeenCalledTimes(15)

    expect(addSegmentMock.mock.calls[0]?.[2]).toEqual({
      type: 'Point',
      position: {
        x: { type: 'Var', value: 12, units: 'Mm' },
        y: { type: 'Var', value: 8, units: 'Mm' },
      },
    })

    expect(addSegmentMock.mock.calls[1]?.[2]).toEqual({
      type: 'Line',
      start: {
        x: { type: 'Var', value: 7, units: 'Mm' },
        y: { type: 'Var', value: 3, units: 'Mm' },
      },
      end: {
        x: { type: 'Var', value: 17, units: 'Mm' },
        y: { type: 'Var', value: 3, units: 'Mm' },
      },
    })

    expect(addSegmentMock.mock.calls[5]?.[2]).toEqual({
      type: 'Line',
      start: {
        x: { type: 'Var', value: 7, units: 'Mm' },
        y: { type: 'Var', value: 3, units: 'Mm' },
      },
      end: {
        x: { type: 'Var', value: 17, units: 'Mm' },
        y: { type: 'Var', value: 13, units: 'Mm' },
      },
      construction: true,
    })

    expect(addSegmentMock.mock.calls[6]?.[2]).toEqual({
      type: 'Line',
      start: {
        x: { type: 'Var', value: 17, units: 'Mm' },
        y: { type: 'Var', value: 3, units: 'Mm' },
      },
      end: {
        x: { type: 'Var', value: 7, units: 'Mm' },
        y: { type: 'Var', value: 13, units: 'Mm' },
      },
      construction: true,
    })

    expect(result.draft.centerGeometry).toEqual({
      diagonalLineIds: [5, 6],
      diagonalPointIds: [19, 20, 21, 22],
      centerPointId: 100,
    })
    expect(result.draft.originPointId).toBe(100)
    expect(result.draft.segmentIds).toHaveLength(19)
    expect(result.draft.constraintIds).toHaveLength(15)
  })

  it('adds a snap constraint for the rectangle origin point when the first click snaps', async () => {
    const rustContext = createMockRustContext()
    const kclManager = createMockKclManager()
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const addSegmentMock = vi.mocked(rustContext.addSegment)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const addConstraintMock = vi.mocked(rustContext.addConstraint)

    addSegmentMock
      .mockResolvedValueOnce({
        kclSource: { text: 'line-1' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(1, 11, 12),
      })
      .mockResolvedValueOnce({
        kclSource: { text: 'line-2' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(2, 13, 14),
      })
      .mockResolvedValueOnce({
        kclSource: { text: 'line-3' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(3, 15, 16),
      })
      .mockResolvedValueOnce({
        kclSource: { text: 'line-4' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(4, 17, 18),
      })

    const constraintTypes: ApiConstraint[] = [
      { type: 'Coincident', segments: [12, 13] },
      { type: 'Coincident', segments: [14, 15] },
      { type: 'Coincident', segments: [16, 17] },
      { type: 'Coincident', segments: [18, 11] },
      { type: 'Parallel', lines: [2, 4] },
      { type: 'Parallel', lines: [3, 1] },
      { type: 'Perpendicular', lines: [1, 2] },
      { type: 'Horizontal', line: 3 } as unknown as ApiConstraint,
      {
        type: 'Coincident',
        segments: [11, 'ORIGIN'] as unknown as [number, number],
      },
    ]

    let constraintIndex = 0
    addConstraintMock.mockImplementation(
      async (_version, _sketchId, constraint) => {
        const index = constraintIndex
        constraintIndex += 1
        return {
          kclSource: { text: `constraint-${index}` } as SourceDelta,
          sceneGraphDelta: createConstraintSceneGraphDelta(
            300 + index,
            constraintTypes[index] ?? constraint
          ),
        }
      }
    )

    const result = await createDraftRectangle({
      rustContext,
      kclManager,
      sketchId: 4,
      mode: 'corner',
      origin: [1, 2],
      snapTarget: { type: 'origin' },
    })

    expect(addConstraintMock).toHaveBeenCalledTimes(9)
    expect(addConstraintMock.mock.calls[8]?.[2]).toEqual({
      type: 'Coincident',
      segments: [11, 'ORIGIN'],
    })
    expect(result.draft.originPointId).toBe(11)
    expect(result.draft.constraintIds.at(-1)).toBe(308)
  })

  it('seeds corner rectangles at the clicked origin with a non-degenerate draft size', async () => {
    const rustContext = createMockRustContext()
    const kclManager = createMockKclManager()
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const addSegmentMock = vi.mocked(rustContext.addSegment)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const addConstraintMock = vi.mocked(rustContext.addConstraint)

    addSegmentMock
      .mockResolvedValueOnce({
        kclSource: { text: 'line-1' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(1, 11, 12),
      })
      .mockResolvedValueOnce({
        kclSource: { text: 'line-2' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(2, 13, 14),
      })
      .mockResolvedValueOnce({
        kclSource: { text: 'line-3' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(3, 15, 16),
      })
      .mockResolvedValueOnce({
        kclSource: { text: 'line-4' } as SourceDelta,
        sceneGraphDelta: createLineSceneGraphDelta(4, 17, 18),
      })

    let constraintIndex = 0
    addConstraintMock.mockImplementation(
      async (_version, _sketchId, constraint) => {
        const index = constraintIndex
        constraintIndex += 1
        return {
          kclSource: { text: `constraint-${index}` } as SourceDelta,
          sceneGraphDelta: createConstraintSceneGraphDelta(
            400 + index,
            constraint
          ),
        }
      }
    )

    await createDraftRectangle({
      rustContext,
      kclManager,
      sketchId: 12,
      mode: 'corner',
      origin: [12, 8],
    })

    expect(addSegmentMock.mock.calls[0]?.[2]).toEqual({
      type: 'Line',
      start: {
        x: { type: 'Var', value: 12, units: 'Mm' },
        y: { type: 'Var', value: 8, units: 'Mm' },
      },
      end: {
        x: {
          type: 'Var',
          value: 12 + MIN_DRAFT_GEOMETRY_DELTA_MM,
          units: 'Mm',
        },
        y: { type: 'Var', value: 8, units: 'Mm' },
      },
    })
  })
})

describe('rectUtils.updateDraftRectangleAligned', () => {
  it('updates center rectangle diagonals and center point alongside the outer lines', async () => {
    const rustContext = createMockRustContext()
    const kclManager = createMockKclManager()
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const editSegmentsMock = vi.mocked(rustContext.editSegments)

    editSegmentsMock.mockResolvedValue({
      kclSource: { text: 'updated' } as SourceDelta,
      sceneGraphDelta: createSceneGraphDelta([]),
    })

    await updateDraftRectangleAligned({
      rustContext,
      kclManager,
      sketchId: 9,
      draft: {
        lineIds: [1, 2, 3, 4],
        segmentIds: [],
        constraintIds: [],
        originPointId: 1,
        centerGeometry: {
          diagonalLineIds: [5, 6],
          diagonalPointIds: [11, 12, 13, 14],
          centerPointId: 15,
        },
      },
      rect: {
        min: [0, 0],
        max: [4, 6],
      },
    })

    const edits = editSegmentsMock.mock.calls[0]?.[2]
    expect(edits).toHaveLength(7)
    expect(edits?.[4]).toEqual({
      id: 5,
      ctor: {
        type: 'Line',
        start: {
          x: { type: 'Var', value: 0, units: 'Mm' },
          y: { type: 'Var', value: 0, units: 'Mm' },
        },
        end: {
          x: { type: 'Var', value: 4, units: 'Mm' },
          y: { type: 'Var', value: 6, units: 'Mm' },
        },
        construction: true,
      },
    })
    expect(edits?.[5]).toEqual({
      id: 6,
      ctor: {
        type: 'Line',
        start: {
          x: { type: 'Var', value: 4, units: 'Mm' },
          y: { type: 'Var', value: 0, units: 'Mm' },
        },
        end: {
          x: { type: 'Var', value: 0, units: 'Mm' },
          y: { type: 'Var', value: 6, units: 'Mm' },
        },
        construction: true,
      },
    })
    expect(edits?.[6]).toEqual({
      id: 15,
      ctor: {
        type: 'Point',
        position: {
          x: { type: 'Var', value: 2, units: 'Mm' },
          y: { type: 'Var', value: 3, units: 'Mm' },
        },
      },
    })
  })
})

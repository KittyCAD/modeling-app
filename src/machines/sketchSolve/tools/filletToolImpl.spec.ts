import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  finalizeFilletActor,
  resolveFilletSelection,
  solveFilletGeometry,
  solveFilletGeometryFromMouse,
} from '@src/machines/sketchSolve/tools/filletToolImpl'
import {
  createArcApiObject,
  createCircleApiObject,
  createLineApiObject,
  createMockKclManager,
  createMockRustContext,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it, type Mock } from 'vitest'

function createConstraintApiObject({
  id,
  constraint,
}: {
  id: number
  constraint: ApiConstraint
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Constraint',
      constraint,
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

type MockRustContext = Omit<
  ReturnType<typeof createMockRustContext>,
  'addConstraint' | 'addSegment' | 'deleteObjects' | 'editSegments'
> & {
  addConstraint: Mock
  addSegment: Mock
  deleteObjects: Mock
  editSegments: Mock
}

function expectCoordsCloseTo(
  actual: [number, number],
  expected: [number, number]
) {
  expect(actual[0]).toBeCloseTo(expected[0])
  expect(actual[1]).toBeCloseTo(expected[1])
}

function createAdjacentLineCorner() {
  const vertexA = createPointApiObject({ id: 1, x: 0, y: 0 })
  const lineAEnd = createPointApiObject({ id: 2, x: 10, y: 0 })
  const vertexB = createPointApiObject({ id: 3, x: 0, y: 0 })
  const lineBEnd = createPointApiObject({ id: 4, x: 0, y: 10 })
  const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
  const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
  const coincident = createConstraintApiObject({
    id: 20,
    constraint: { type: 'Coincident', segments: [1, 3] },
  })

  return createSceneGraphDelta([
    vertexA,
    lineAEnd,
    vertexB,
    lineBEnd,
    lineA,
    lineB,
    coincident,
  ]).new_graph.objects
}

describe('filletToolImpl', () => {
  describe('resolveFilletSelection', () => {
    it('accepts line segments joined by coincident endpoints', () => {
      const selection = resolveFilletSelection({
        segmentIds: [10, 11],
        objects: createAdjacentLineCorner(),
      })

      expect(selection).not.toBeNull()
      expect(selection?.adjacencyConstraintIds).toEqual([20])
      expect(selection?.sides[0].endpointId).toBe(1)
      expect(selection?.sides[1].endpointId).toBe(3)
      expectCoordsCloseTo(selection?.vertex ?? [Number.NaN, Number.NaN], [0, 0])
    })

    it('rejects line segments without a shared or coincident endpoint', () => {
      const p1 = createPointApiObject({ id: 1, x: 0, y: 0 })
      const p2 = createPointApiObject({ id: 2, x: 10, y: 0 })
      const p3 = createPointApiObject({ id: 3, x: 0, y: 0 })
      const p4 = createPointApiObject({ id: 4, x: 0, y: 10 })
      const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
      const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
      const objects = createSceneGraphDelta([p1, p2, p3, p4, lineA, lineB])
        .new_graph.objects

      expect(
        resolveFilletSelection({ segmentIds: [10, 11], objects })
      ).toBeNull()
    })

    it('rejects circle segments because they do not have fillet endpoints', () => {
      const p1 = createPointApiObject({ id: 1, x: 0, y: 0 })
      const p2 = createPointApiObject({ id: 2, x: 10, y: 0 })
      const center = createPointApiObject({ id: 3, x: 0, y: 0 })
      const start = createPointApiObject({ id: 4, x: 0, y: 5 })
      const line = createLineApiObject({ id: 10, start: 1, end: 2 })
      const circle = createCircleApiObject({ id: 11, center: 3, start: 4 })
      const objects = createSceneGraphDelta([
        p1,
        p2,
        center,
        start,
        line,
        circle,
      ]).new_graph.objects

      expect(
        resolveFilletSelection({ segmentIds: [10, 11], objects })
      ).toBeNull()
    })
  })

  describe('solveFilletGeometry', () => {
    it('solves a tangent quarter arc between adjacent perpendicular lines', () => {
      const selection = resolveFilletSelection({
        segmentIds: [10, 11],
        objects: createAdjacentLineCorner(),
      })
      if (!selection) {
        throw new Error('Expected adjacent line selection')
      }

      const geometry = solveFilletGeometry({
        selection,
        radius: 2,
      })

      expect(geometry).not.toBeNull()
      expect(geometry?.radius).toBe(2)
      expectCoordsCloseTo(geometry?.center ?? [Number.NaN, Number.NaN], [2, 2])
      expectCoordsCloseTo(
        geometry?.sideTangencies[0] ?? [Number.NaN, Number.NaN],
        [2, 0]
      )
      expectCoordsCloseTo(
        geometry?.sideTangencies[1] ?? [Number.NaN, Number.NaN],
        [0, 2]
      )
    })

    it('uses the largest valid radius when the mouse requests too large a fillet', () => {
      const selection = resolveFilletSelection({
        segmentIds: [10, 11],
        objects: createAdjacentLineCorner(),
      })
      if (!selection) {
        throw new Error('Expected adjacent line selection')
      }

      const geometry = solveFilletGeometryFromMouse({
        selection,
        mousePosition: [100, 100],
      })

      expect(geometry).not.toBeNull()
      expect(geometry?.radius).toBeGreaterThan(9.9)
      expect(geometry?.radius).toBeLessThan(10)
    })
  })

  describe('finalizeFilletActor', () => {
    it('uses post-delete object ids when deleting the corner constraint shifts the preview arc id', async () => {
      const rustContext = createMockRustContext()
      const rustContextMock = rustContext as unknown as MockRustContext
      const kclManager = createMockKclManager()
      const lineAStart = createPointApiObject({ id: 4, x: 10, y: 0 })
      const lineAEnd = createPointApiObject({ id: 5, x: 0, y: 0 })
      const lineBStart = createPointApiObject({ id: 8, x: 0, y: 0 })
      const lineBEnd = createPointApiObject({ id: 9, x: 0, y: 10 })
      const lineA = createLineApiObject({ id: 6, start: 4, end: 5 })
      const lineB = createLineApiObject({ id: 10, start: 8, end: 9 })
      const cornerCoincident = createConstraintApiObject({
        id: 11,
        constraint: { type: 'Coincident', segments: [5, 8] },
      })
      const beforeObjects = createSceneGraphDelta([
        lineAStart,
        lineAEnd,
        lineA,
        lineBStart,
        lineBEnd,
        lineB,
        cornerCoincident,
        createPointApiObject({ id: 12, x: 2, y: 0 }),
        createPointApiObject({ id: 13, x: 0, y: 2 }),
        createPointApiObject({ id: 14, x: 2, y: 2 }),
        createArcApiObject({ id: 15, start: 12, end: 13, center: 14 }),
      ]).new_graph.objects
      const selection = resolveFilletSelection({
        segmentIds: [6, 10],
        objects: beforeObjects,
      })
      if (!selection) {
        throw new Error('Expected adjacent line selection')
      }

      const geometry = solveFilletGeometry({ selection, radius: 2 })
      if (!geometry) {
        throw new Error('Expected fillet geometry')
      }

      const arcStartAfterDelete = createPointApiObject({ id: 11, x: 2, y: 0 })
      const arcEndAfterDelete = createPointApiObject({ id: 12, x: 0, y: 2 })
      const arcCenterAfterDelete = createPointApiObject({ id: 13, x: 2, y: 2 })
      const arcAfterDelete = createArcApiObject({
        id: 14,
        start: 11,
        end: 12,
        center: 13,
      })
      const postDeleteObjects = [
        lineAStart,
        lineAEnd,
        lineA,
        lineBStart,
        lineBEnd,
        lineB,
        arcStartAfterDelete,
        arcEndAfterDelete,
        arcCenterAfterDelete,
        arcAfterDelete,
      ]
      const intersectionPoint = createPointApiObject({ id: 16, x: 0, y: 0 })
      const objectsWithIntersection = [...postDeleteObjects, intersectionPoint]
      const deleteObjectsMock = rustContextMock.deleteObjects
      const editSegmentsMock = rustContextMock.editSegments
      const addSegmentMock = rustContextMock.addSegment
      const addConstraintMock = rustContextMock.addConstraint

      deleteObjectsMock.mockResolvedValue({
        kclSource: { text: 'delete' },
        sceneGraphDelta: createSceneGraphDelta(postDeleteObjects),
      })
      editSegmentsMock.mockResolvedValue({
        kclSource: { text: 'edit' },
        sceneGraphDelta: createSceneGraphDelta(postDeleteObjects),
        checkpointId: null,
      })
      addSegmentMock.mockResolvedValueOnce({
        kclSource: { text: 'intersection-point' },
        sceneGraphDelta: createSceneGraphDelta(objectsWithIntersection, [16]),
      })

      let nextConstraintId = 30
      addConstraintMock.mockImplementation(
        async (
          _version: number,
          _sketchId: number,
          constraint: ApiConstraint,
          _settings: unknown,
          createCheckpoint?: boolean
        ) => {
          const constraintId = nextConstraintId++
          return {
            kclSource: { text: `constraint-${constraintId}` },
            sceneGraphDelta: createSceneGraphDelta(
              [
                ...objectsWithIntersection,
                createConstraintApiObject({ id: constraintId, constraint }),
              ],
              [constraintId]
            ),
            checkpointId: createCheckpoint ? 42 : null,
          }
        }
      )

      const result = await finalizeFilletActor({
        input: {
          selection,
          geometry,
          draft: {
            arcId: 15,
            arcStartPointId: 12,
            arcEndPointId: 13,
            arcCenterPointId: 14,
            segmentIds: [15, 12, 13, 14],
          },
          rustContext,
          kclManager,
          sketchId: 2,
        },
      })

      expect(result).not.toHaveProperty('error')
      if ('error' in result) {
        throw new Error(result.error)
      }
      expect(result.sceneGraphDelta.invalidates_ids).toBe(true)
      expect(deleteObjectsMock.mock.calls).toContainEqual([
        0,
        2,
        [11],
        [],
        expect.anything(),
      ])
      expect(editSegmentsMock.mock.calls).toHaveLength(1)
      expect(
        (editSegmentsMock.mock.calls[0][2] as Array<{ id: number }>).map(
          (edit) => edit.id
        )
      ).toEqual([6, 10, 14])
      expect(editSegmentsMock.mock.calls).toContainEqual([
        0,
        2,
        expect.arrayContaining([
          expect.objectContaining({ id: 6 }),
          expect.objectContaining({ id: 10 }),
          expect.objectContaining({ id: 14 }),
        ]),
        expect.anything(),
      ])
      expect(addSegmentMock.mock.calls).toHaveLength(1)
      expect(addConstraintMock.mock.calls).toContainEqual([
        0,
        2,
        { type: 'Tangent', input: [6, 14] },
        expect.anything(),
        false,
      ])
      expect(addConstraintMock.mock.calls).toContainEqual([
        0,
        2,
        { type: 'Tangent', input: [10, 14] },
        expect.anything(),
        true,
      ])
    })

    it('reattaches inherited dimensions to the original intersection point', async () => {
      const rustContext = createMockRustContext()
      const rustContextMock = rustContext as unknown as MockRustContext
      const kclManager = createMockKclManager()
      const lineAStart = createPointApiObject({ id: 1, x: 10, y: 0 })
      const lineAEnd = createPointApiObject({ id: 2, x: 0, y: 0 })
      const lineBStart = createPointApiObject({ id: 3, x: 0, y: 0 })
      const lineBEnd = createPointApiObject({ id: 4, x: 0, y: 10 })
      const lineA = createLineApiObject({ id: 5, start: 1, end: 2 })
      const lineB = createLineApiObject({ id: 6, start: 3, end: 4 })
      const arcStart = createPointApiObject({ id: 7, x: 2, y: 0 })
      const arcEnd = createPointApiObject({ id: 8, x: 0, y: 2 })
      const arcCenter = createPointApiObject({ id: 9, x: 2, y: 2 })
      const arc = createArcApiObject({
        id: 10,
        start: 7,
        end: 8,
        center: 9,
      })
      const cornerCoincident = createConstraintApiObject({
        id: 20,
        constraint: { type: 'Coincident', segments: [2, 3] },
      })
      const horizontalDimension = createConstraintApiObject({
        id: 21,
        constraint: {
          type: 'HorizontalDistance',
          points: [1, 2],
          distance: { value: 10, units: 'Mm' },
          source: { expr: '10', is_literal: true },
        },
      })
      const beforeObjects = createSceneGraphDelta([
        lineAStart,
        lineAEnd,
        lineBStart,
        lineBEnd,
        lineA,
        lineB,
        arcStart,
        arcEnd,
        arcCenter,
        arc,
        cornerCoincident,
        horizontalDimension,
      ]).new_graph.objects
      const selection = resolveFilletSelection({
        segmentIds: [5, 6],
        objects: beforeObjects,
      })
      if (!selection) {
        throw new Error('Expected adjacent line selection')
      }

      const geometry = solveFilletGeometry({ selection, radius: 2 })
      if (!geometry) {
        throw new Error('Expected fillet geometry')
      }

      const postDeleteObjects = [
        lineAStart,
        lineAEnd,
        lineBStart,
        lineBEnd,
        lineA,
        lineB,
        arcStart,
        arcEnd,
        arcCenter,
        arc,
      ]
      const intersectionPoint = createPointApiObject({ id: 11, x: 0, y: 0 })
      const objectsWithIntersection = [...postDeleteObjects, intersectionPoint]
      const deleteObjectsMock = rustContextMock.deleteObjects
      const editSegmentsMock = rustContextMock.editSegments
      const addSegmentMock = rustContextMock.addSegment
      const addConstraintMock = rustContextMock.addConstraint

      deleteObjectsMock.mockResolvedValue({
        kclSource: { text: 'delete' },
        sceneGraphDelta: createSceneGraphDelta(postDeleteObjects),
      })
      editSegmentsMock.mockResolvedValue({
        kclSource: { text: 'edit' },
        sceneGraphDelta: createSceneGraphDelta(postDeleteObjects),
        checkpointId: null,
      })
      addSegmentMock.mockResolvedValueOnce({
        kclSource: { text: 'intersection-point' },
        sceneGraphDelta: createSceneGraphDelta(objectsWithIntersection, [11]),
      })

      let nextConstraintId = 30
      addConstraintMock.mockImplementation(
        async (
          _version: number,
          _sketchId: number,
          constraint: ApiConstraint,
          _settings: unknown,
          createCheckpoint?: boolean
        ) => {
          const constraintId = nextConstraintId++
          return {
            kclSource: { text: `constraint-${constraintId}` },
            sceneGraphDelta: createSceneGraphDelta(
              [
                ...objectsWithIntersection,
                createConstraintApiObject({ id: constraintId, constraint }),
              ],
              [constraintId]
            ),
            checkpointId: createCheckpoint ? 42 : null,
          }
        }
      )

      const result = await finalizeFilletActor({
        input: {
          selection,
          geometry,
          draft: {
            arcId: 10,
            arcStartPointId: 7,
            arcEndPointId: 8,
            arcCenterPointId: 9,
            segmentIds: [10, 7, 8, 9],
          },
          rustContext,
          kclManager,
          sketchId: 2,
        },
      })

      expect(result).not.toHaveProperty('error')
      expect(deleteObjectsMock.mock.calls).toContainEqual([
        0,
        2,
        [20, 21],
        [],
        expect.anything(),
      ])
      expect(addConstraintMock.mock.calls).toContainEqual([
        0,
        2,
        {
          type: 'HorizontalDistance',
          points: [1, 11],
          distance: { value: 10, units: 'Mm' },
          source: { expr: '10', is_literal: true },
        },
        expect.anything(),
        true,
      ])
    })
  })
})

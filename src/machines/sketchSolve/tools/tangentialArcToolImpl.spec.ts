import {
  createMockSceneInfra,
  createArcApiObject,
  createLineApiObject,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import {
  addFirstPointListener,
  findTangentialArcCenter,
  resolveTangentInfoFromClick,
  resolveTangentialArcEndpoints,
} from '@src/machines/sketchSolve/tools/tangentialArcToolImpl'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { describe, expect, it, vi } from 'vitest'
import { isPointSegment } from '@src/machines/sketchSolve/constraints/constraintUtils'
import { Mesh } from 'three'

function createSketchApiObject({ id }: { id: number }): ApiObject {
  return {
    id,
    kind: {
      type: 'Sketch',
      args: { on: { default: 'xy' } },
      plane: 0,
      segments: [],
      constraints: [],
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  }
}

describe('tangentialArcToolImpl', () => {
  describe('findTangentialArcCenter', () => {
    it('should solve center from tangent-normal and perpendicular bisector intersection', () => {
      const center = findTangentialArcCenter({
        startPoint: [0, 0],
        endPoint: [1, 1],
        tangentDirection: [1, 0],
      })

      expect(center).toEqual([0, 1])
    })

    it('should return null for collinear endpoint on tangent direction', () => {
      const center = findTangentialArcCenter({
        startPoint: [0, 0],
        endPoint: [2, 0],
        tangentDirection: [1, 0],
      })

      expect(center).toBeNull()
    })
  })

  describe('addFirstPointListener', () => {
    it('should resolve point clicks from mouse position without relying on selected mesh ids', () => {
      const sceneInfra = createMockSceneInfra()
      const send = vi.fn()
      const sketch = createSketchApiObject({ id: 0 })
      const p1 = createPointApiObject({ id: 1, x: 0, y: 0 })
      const p2 = createPointApiObject({ id: 2, x: 20, y: 0 })
      if (isPointSegment(p1)) {
        p1.kind.segment.owner = 3
      }
      if (isPointSegment(p2)) {
        p2.kind.segment.owner = 3
      }
      const line = createLineApiObject({ id: 3, start: 1, end: 2 })
      const sceneGraphDelta = createSceneGraphDelta(
        [sketch, p1, p2, line],
        [0, 1, 2, 3]
      )

      addFirstPointListener({
        self: {
          send,
          _parent: {
            getSnapshot: () => ({
              context: {
                sketchId: 0,
                sketchExecOutcome: {
                  sceneGraphDelta,
                },
              },
            }),
          },
        } as any,
        context: {
          sceneInfra,
        } as any,
      } as any)

      const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]
      const pointBody = new Mesh()
      pointBody.userData.type = 'POINT_SEGMENT_BODY'

      callbacks.onClick({
        mouseEvent: { which: 1 },
        intersectionPoint: {
          twoD: { x: 0, y: 0 },
        },
        selected: pointBody,
      })

      expect(send).toHaveBeenCalledWith({
        type: 'select tangent info',
        data: {
          ownerId: 3,
          tangentStart: { pointId: 1, position: [0, 0] },
          tangentDirection: [-1, 0],
        },
      })
    })
  })

  describe('resolveTangentInfoFromClick', () => {
    it('should return null when clicking a line segment directly', () => {
      const p1 = createPointApiObject({ id: 1, x: 0, y: 0 })
      const p2 = createPointApiObject({ id: 2, x: 20, y: 0 })
      const line = createLineApiObject({ id: 3, start: 1, end: 2 })
      const sceneGraphDelta = createSceneGraphDelta([p1, p2, line], [1, 2, 3])

      const tangentInfo = resolveTangentInfoFromClick({
        clickedId: 3,
        sceneGraphDelta,
      })

      expect(tangentInfo).toBeNull()
    })

    it('should resolve endpoint owner line when clicking a point segment', () => {
      const p1 = createPointApiObject({ id: 1, x: 0, y: 0 })
      const p2 = createPointApiObject({ id: 2, x: 20, y: 0 })
      if (isPointSegment(p1)) {
        p1.kind.segment.owner = 3
      }
      if (isPointSegment(p2)) {
        p2.kind.segment.owner = 3
      }
      const line = createLineApiObject({ id: 3, start: 1, end: 2 })
      const sceneGraphDelta = createSceneGraphDelta([p1, p2, line], [1, 2, 3])

      const tangentInfoAtStart = resolveTangentInfoFromClick({
        clickedId: 1,
        sceneGraphDelta,
      })
      const tangentInfoAtEnd = resolveTangentInfoFromClick({
        clickedId: 2,
        sceneGraphDelta,
      })

      expect(tangentInfoAtStart).toEqual({
        ownerId: 3,
        tangentStart: { pointId: 1, position: [0, 0] },
        tangentDirection: [-1, 0],
      })
      expect(tangentInfoAtEnd).toEqual({
        ownerId: 3,
        tangentStart: { pointId: 2, position: [20, 0] },
        tangentDirection: [1, 0],
      })
    })

    it('should resolve endpoint owner arc when clicking an arc endpoint', () => {
      const center = createPointApiObject({ id: 1, x: 0, y: 0 })
      const start = createPointApiObject({ id: 2, x: 5, y: 0 })
      const end = createPointApiObject({ id: 3, x: 0, y: 5 })
      const arc = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })

      if (isPointSegment(center)) {
        center.kind.segment.owner = 4
      }
      if (isPointSegment(start)) {
        start.kind.segment.owner = 4
      }
      if (isPointSegment(end)) {
        end.kind.segment.owner = 4
      }

      const sceneGraphDelta = createSceneGraphDelta(
        [center, start, end, arc],
        [1, 2, 3, 4]
      )

      const tangentInfoAtStart = resolveTangentInfoFromClick({
        clickedId: 2,
        sceneGraphDelta,
      })
      const tangentInfoAtEnd = resolveTangentInfoFromClick({
        clickedId: 3,
        sceneGraphDelta,
      })
      const tangentInfoAtCenter = resolveTangentInfoFromClick({
        clickedId: 1,
        sceneGraphDelta,
      })

      expect(tangentInfoAtStart).toEqual({
        ownerId: 4,
        tangentStart: { pointId: 2, position: [5, 0] },
        tangentDirection: [0, -1],
      })
      expect(tangentInfoAtEnd).toEqual({
        ownerId: 4,
        tangentStart: { pointId: 3, position: [0, 5] },
        tangentDirection: [-1, 0],
      })
      expect(tangentInfoAtCenter).toBeNull()
    })

    it('should return null when the clicked segment is not a line/line endpoint', () => {
      const center = createPointApiObject({ id: 1, x: 0, y: 0 })
      const start = createPointApiObject({ id: 2, x: 10, y: 0 })
      const end = createPointApiObject({ id: 3, x: 0, y: 10 })
      const arc = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })
      const sceneGraphDelta = createSceneGraphDelta(
        [center, start, end, arc],
        [1, 2, 3, 4]
      )

      const tangentInfo = resolveTangentInfoFromClick({
        clickedId: 4,
        sceneGraphDelta,
      })

      expect(tangentInfo).toBeNull()
    })
  })

  describe('resolveTangentialArcEndpoints', () => {
    it('keeps start/end order when endpoint is on the left side of tangent direction', () => {
      const result = resolveTangentialArcEndpoints([0, 0], [1, 1], [1, 0])

      expect(result).toEqual({
        start: [0, 0],
        end: [1, 1],
        swapped: false,
      })
    })

    it('swaps start/end order when endpoint is on the right side of tangent direction', () => {
      const result = resolveTangentialArcEndpoints([0, 0], [1, -1], [1, 0])

      expect(result).toEqual({
        start: [1, -1],
        end: [0, 0],
        swapped: true,
      })
    })
  })
})

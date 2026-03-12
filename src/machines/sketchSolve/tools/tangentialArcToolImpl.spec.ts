import {
  createArcApiObject,
  createLineApiObject,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import {
  findTangentialArcCenter,
  resolveTangentInfoFromClick,
  resolveTangentialArcEndpoints,
} from '@src/machines/sketchSolve/tools/tangentialArcToolImpl'
import { describe, expect, it } from 'vitest'
import { isPointSegment } from '@src/machines/sketchSolve/constraints/constraintUtils'

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
        lineId: 3,
        tangentStart: { id: 1, point: [0, 0] },
        tangentDirection: [-1, 0],
      })
      expect(tangentInfoAtEnd).toEqual({
        lineId: 3,
        tangentStart: { id: 2, point: [20, 0] },
        tangentDirection: [1, 0],
      })
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

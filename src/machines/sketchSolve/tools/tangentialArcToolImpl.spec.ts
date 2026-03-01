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
    it('should resolve nearest endpoint when clicking a line segment', () => {
      const p1 = createPointApiObject({ id: 1, x: 0, y: 0 })
      const p2 = createPointApiObject({ id: 2, x: 20, y: 0 })
      const line = createLineApiObject({ id: 3, start: 1, end: 2 })
      const sceneGraphDelta = createSceneGraphDelta([p1, p2, line], [1, 2, 3])

      const tangentInfoNearStart = resolveTangentInfoFromClick({
        clickedId: 3,
        clickPoint: [1, 0],
        sceneGraphDelta,
      })
      const tangentInfoNearEnd = resolveTangentInfoFromClick({
        clickedId: 3,
        clickPoint: [19, 0],
        sceneGraphDelta,
      })

      expect(tangentInfoNearStart).toEqual({
        lineId: 3,
        tangentStart: { id: 1, point: [0, 0] },
        tangentDirection: [1, 0],
      })
      expect(tangentInfoNearEnd).toEqual({
        lineId: 3,
        tangentStart: { id: 2, point: [20, 0] },
        tangentDirection: [1, 0],
      })
    })

    it('should resolve endpoint owner line when clicking a point segment', () => {
      const p1 = createPointApiObject({ id: 1, x: 0, y: 0 })
      const p2 = createPointApiObject({ id: 2, x: 20, y: 0 })
      if (p1.kind.type === 'Segment' && p1.kind.segment.type === 'Point') {
        p1.kind.segment.owner = 3
      }
      if (p2.kind.type === 'Segment' && p2.kind.segment.type === 'Point') {
        p2.kind.segment.owner = 3
      }
      const line = createLineApiObject({ id: 3, start: 1, end: 2 })
      const sceneGraphDelta = createSceneGraphDelta([p1, p2, line], [1, 2, 3])

      const tangentInfo = resolveTangentInfoFromClick({
        clickedId: 2,
        clickPoint: [20, 0],
        sceneGraphDelta,
      })

      expect(tangentInfo).toEqual({
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
        clickPoint: [2, 2],
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

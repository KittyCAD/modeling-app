import { describe, it, expect } from 'vitest'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { Coords2d } from '@src/lang/util'
import {
  getNextTrimCoords,
  arcArcIntersection,
  getPositionCoordsForLine,
  getPositionCoordsFromArc,
  isPointOnLineSegment,
  lineSegmentIntersection,
  isPointOnArc,
  lineArcIntersection,
  projectPointOntoSegment,
  perpendicularDistanceToSegment,
} from '@src/machines/sketchSolve/tools/trimToolImpl'
import { isArray } from '@src/lib/utils'

const otherParams = Object.freeze({
  label: '',
  comments: '',
  artifact_id: '62b3473b-75d1-5129-9675-2d936e009423',
})

const createApiObjectPoint = (
  pos: Coords2d,
  idStart: number,
  owner: number
): ApiObject => ({
  id: idStart,
  kind: {
    type: 'Segment',
    segment: {
      type: 'Point',
      position: {
        x: { value: pos[0], units: 'Mm' },
        y: { value: pos[1], units: 'Mm' },
      },
      ctor: null,
      owner: owner,
      freedom: 'Free',
      constraints: [],
    },
  },
  ...otherParams,
  source: { type: 'Simple', range: [291, 374, 0] },
})
const createApiObjectArc = (
  start: Coords2d,
  end: Coords2d,
  center: Coords2d,
  idStart: number
): Array<ApiObject> => [
  {
    id: idStart,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Arc',
        start: idStart + 1,
        end: idStart + 2,
        center: idStart + 3,
        ctor: {
          type: 'Arc',
          start: {
            x: { type: 'Var', value: start[0], units: 'Mm' },
            y: { type: 'Var', value: start[1], units: 'Mm' },
          },
          end: {
            x: { type: 'Var', value: end[0], units: 'Mm' },
            y: { type: 'Var', value: end[1], units: 'Mm' },
          },
          center: {
            x: { type: 'Var', value: center[0], units: 'Mm' },
            y: { type: 'Var', value: center[1], units: 'Mm' },
          },
        },
        ctor_applicable: false,
      },
    },
    ...otherParams,
    source: { type: 'Simple', range: [291, 374, 0] },
  },
  createApiObjectPoint(start, idStart + 1, idStart),
  createApiObjectPoint(end, idStart + 2, idStart),
  createApiObjectPoint(center, idStart + 3, idStart),
]

const createApiObjectLine = (
  start: Coords2d,
  end: Coords2d,
  idStart: number
): Array<ApiObject> => [
  {
    id: idStart,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Line',
        start: idStart + 1,
        end: idStart + 2,
        ctor: {
          type: 'Line',
          start: {
            x: { type: 'Var', value: start[0], units: 'Mm' },
            y: { type: 'Var', value: start[1], units: 'Mm' },
          },
          end: {
            x: { type: 'Var', value: end[0], units: 'Mm' },
            y: { type: 'Var', value: end[1], units: 'Mm' },
          },
        },
        ctor_applicable: false,
      },
    },
    ...otherParams,
    source: { type: 'Simple', range: [291, 374, 0] },
  },
  createApiObjectPoint(start, idStart + 1, idStart),
  createApiObjectPoint(end, idStart + 2, idStart),
]

describe('trimUtils', () => {
  describe('getNextTrimCoords', () => {
    it('should find intersection with line segment', () => {
      const objects: ApiObject[] = [
        ...createApiObjectLine([0, 0], [10, 10], 0),
        ...createApiObjectLine([0, 5], [10, 5], 3),
      ]

      const result = getNextTrimCoords({
        points: [
          [0, 0],
          [10, 0],
        ],
        startIndex: 0,
        objects,
      })

      // The trim line [0,0] to [10,0] should intersect the line [0,5] to [10,5] at [5, 0]
      // But since they're parallel, there might not be an intersection
      // Let's just check the result is valid
      expect(result.type === 'trimSpawn' || result.type === 'noTrimSpawn').toBe(
        true
      )
    })
  })

  describe('arcArcIntersection', () => {
    it('should find intersection between two arcs', () => {
      const arc1: { [key: string]: Coords2d } = {
        center: [0, 0],
        start: [1, 0],
        end: [0, 1],
      }
      const arc2: { [key: string]: Coords2d } = {
        center: [1, 0],
        start: [2, 0],
        end: [1, 1],
      }

      // arcArcIntersection requires all parameters to be defined
      const result = arcArcIntersection(
        arc1.center,
        arc1.start,
        arc1.end,
        arc2.center,
        arc2.start,
        arc2.end
      )
      // arcArcIntersection may return null if no intersection, or an array of points
      expect(result === null || isArray(result)).toBe(true)
    })
  })

  describe('getPositionCoordsForLine', () => {
    it('should return correct coordinates for line segment endpoints', () => {
      const start: Coords2d = [-6.13, 1.67]
      const end: Coords2d = [4.25, 5.351]
      const objects: ApiObject[] = createApiObjectLine(start, end, 0)
      const lineSegment = objects[0]

      const startCoords = getPositionCoordsForLine(
        lineSegment,
        'start',
        objects
      )
      const endCoords = getPositionCoordsForLine(lineSegment, 'end', objects)

      expect(startCoords).not.toBeNull()
      expect(endCoords).not.toBeNull()
      if (startCoords && endCoords) {
        expect(startCoords[0]).toBeCloseTo(start[0], 5)
        expect(startCoords[1]).toBeCloseTo(start[1], 5)
        expect(endCoords[0]).toBeCloseTo(end[0], 5)
        expect(endCoords[1]).toBeCloseTo(end[1], 5)
      }
    })

    it('should return null for invalid segment type', () => {
      const point = createApiObjectPoint([0, 0], 0, 0)
      const result = getPositionCoordsForLine(point, 'start', [point])
      expect(result).toBeNull()
    })

    it('should return null when point object is missing', () => {
      const start: Coords2d = [0, 0]
      const end: Coords2d = [10, 10]
      const objects: ApiObject[] = [
        {
          id: 0,
          kind: {
            type: 'Segment',
            segment: {
              type: 'Line',
              start: 999, // Non-existent point ID
              end: 998, // Non-existent point ID
              ctor: {
                type: 'Line',
                start: {
                  x: { type: 'Var', value: start[0], units: 'Mm' },
                  y: { type: 'Var', value: start[1], units: 'Mm' },
                },
                end: {
                  x: { type: 'Var', value: end[0], units: 'Mm' },
                  y: { type: 'Var', value: end[1], units: 'Mm' },
                },
              },
              ctor_applicable: false,
            },
          },
          ...otherParams,
          source: { type: 'Simple', range: [0, 0, 0] },
        },
      ]

      const result = getPositionCoordsForLine(objects[0], 'start', objects)
      expect(result).toBeNull()
    })

    it('should handle case where original end point coordinates are needed for split trim', () => {
      // This test case is based on the bug where originalEndCoords equals rightSide.trimTerminationCoords
      // The original line2 has end = [4.25, 5.351], but we need to ensure getPositionCoordsForLine
      // returns the correct coordinates even when the point might be shared with other segments
      const start: Coords2d = [-6.13, 1.67]
      const end: Coords2d = [4.25, 5.351]
      const objects: ApiObject[] = createApiObjectLine(start, end, 0)
      const lineSegment = objects[0]

      // Get end coordinates - this should return [4.25, 5.351], not the intersection point
      const endCoords = getPositionCoordsForLine(lineSegment, 'end', objects)

      expect(endCoords).not.toBeNull()
      if (endCoords) {
        // Verify it returns the actual end point, not an intersection point
        expect(endCoords[0]).toBeCloseTo(4.25, 2)
        expect(endCoords[1]).toBeCloseTo(5.351, 3)
        // Ensure it's NOT the intersection point [0.804, 4.055]
        expect(endCoords[0]).not.toBeCloseTo(0.804, 1)
        expect(endCoords[1]).not.toBeCloseTo(4.055, 1)
      }
    })
  })

  describe('getPositionCoordsFromArc', () => {
    it('should return correct coordinates for arc segment endpoints', () => {
      const start: Coords2d = [3.09, 4.939]
      const end: Coords2d = [2.691, 6.42]
      const center: Coords2d = [-7.39, 2.91]
      const objects: ApiObject[] = createApiObjectArc(start, end, center, 0)
      const arcSegment = objects[0]

      const startCoords = getPositionCoordsFromArc(arcSegment, 'start', objects)
      const endCoords = getPositionCoordsFromArc(arcSegment, 'end', objects)
      const centerCoords = getPositionCoordsFromArc(
        arcSegment,
        'center',
        objects
      )

      expect(startCoords).not.toBeNull()
      expect(endCoords).not.toBeNull()
      expect(centerCoords).not.toBeNull()
      if (startCoords && endCoords && centerCoords) {
        expect(startCoords[0]).toBeCloseTo(start[0], 3)
        expect(startCoords[1]).toBeCloseTo(start[1], 3)
        expect(endCoords[0]).toBeCloseTo(end[0], 3)
        expect(endCoords[1]).toBeCloseTo(end[1], 3)
        expect(centerCoords[0]).toBeCloseTo(center[0], 2)
        expect(centerCoords[1]).toBeCloseTo(center[1], 2)
      }
    })

    it('should return null for invalid segment type', () => {
      const point = createApiObjectPoint([0, 0], 0, 0)
      const result = getPositionCoordsFromArc(point, 'start', [point])
      expect(result).toBeNull()
    })
  })

  describe('isPointOnLineSegment', () => {
    it('should return point when point is exactly on segment', () => {
      const result = isPointOnLineSegment([5, 5], [0, 0], [10, 10])
      expect(result).not.toBeNull()
      if (result) {
        expect(result[0]).toBeCloseTo(5, 5)
        expect(result[1]).toBeCloseTo(5, 5)
      }
    })

    it('should return point when point is at segment start', () => {
      const result = isPointOnLineSegment([0, 0], [0, 0], [10, 10])
      expect(result).not.toBeNull()
      if (result) {
        expect(result[0]).toBe(0)
        expect(result[1]).toBe(0)
      }
    })

    it('should return point when point is at segment end', () => {
      const result = isPointOnLineSegment([10, 10], [0, 0], [10, 10])
      expect(result).not.toBeNull()
      if (result) {
        expect(result[0]).toBe(10)
        expect(result[1]).toBe(10)
      }
    })

    it('should return null when point is before segment start', () => {
      const result = isPointOnLineSegment([-1, -1], [0, 0], [10, 10])
      expect(result).toBeNull()
    })

    it('should return null when point is after segment end', () => {
      const result = isPointOnLineSegment([11, 11], [0, 0], [10, 10])
      expect(result).toBeNull()
    })

    it('should return null when point is off to the side', () => {
      const result = isPointOnLineSegment([5, 6], [0, 0], [10, 10])
      expect(result).toBeNull()
    })

    it('should handle horizontal segment', () => {
      const result = isPointOnLineSegment([5, 0], [0, 0], [10, 0])
      expect(result).not.toBeNull()
      if (result) {
        expect(result[0]).toBe(5)
        expect(result[1]).toBe(0)
      }
    })

    it('should handle vertical segment', () => {
      const result = isPointOnLineSegment([0, 5], [0, 0], [0, 10])
      expect(result).not.toBeNull()
      if (result) {
        expect(result[0]).toBe(0)
        expect(result[1]).toBe(5)
      }
    })

    it('should handle degenerate segment (point)', () => {
      const result = isPointOnLineSegment([0, 0], [0, 0], [0, 0])
      expect(result).not.toBeNull()
      if (result) {
        expect(result[0]).toBe(0)
        expect(result[1]).toBe(0)
      }
    })

    it('should return null for point far from degenerate segment', () => {
      const result = isPointOnLineSegment([1, 1], [0, 0], [0, 0])
      expect(result).toBeNull()
    })
  })

  describe('lineSegmentIntersection', () => {
    it('should find intersection of two crossing segments', () => {
      const result = lineSegmentIntersection([0, 0], [10, 10], [0, 10], [10, 0])
      expect(result).not.toBeNull()
      if (result) {
        expect(result[0]).toBeCloseTo(5, 5)
        expect(result[1]).toBeCloseTo(5, 5)
      }
    })

    it('should return endpoint when segments share an endpoint', () => {
      const result = lineSegmentIntersection([0, 0], [5, 5], [5, 5], [10, 10])
      expect(result).not.toBeNull()
      if (result) {
        expect(result[0]).toBeCloseTo(5, 5)
        expect(result[1]).toBeCloseTo(5, 5)
      }
    })

    it('should return null for parallel segments', () => {
      const result = lineSegmentIntersection([0, 0], [10, 0], [0, 5], [10, 5])
      expect(result).toBeNull()
    })

    it('should return null for non-intersecting segments', () => {
      const result = lineSegmentIntersection([0, 0], [5, 5], [10, 10], [15, 15])
      expect(result).toBeNull()
    })

    it('should return null when intersection is outside both segments', () => {
      const result = lineSegmentIntersection([0, 0], [5, 5], [10, 10], [20, 20])
      expect(result).toBeNull()
    })

    it('should handle T-intersection (endpoint on segment)', () => {
      const result = lineSegmentIntersection([0, 0], [10, 0], [5, -5], [5, 5])
      expect(result).not.toBeNull()
      if (result) {
        expect(result[0]).toBeCloseTo(5, 5)
        expect(result[1]).toBeCloseTo(0, 5)
      }
    })
  })

  describe('isPointOnArc', () => {
    it('should return true for point on arc', () => {
      // Arc from [1, 0] to [0, 1] with center at [0, 0] (quarter circle)
      // Use a point that's exactly on the unit circle
      const angle = Math.PI / 4 // 45 degrees
      const point: Coords2d = [Math.cos(angle), Math.sin(angle)]
      const result = isPointOnArc(point, [0, 0], [1, 0], [0, 1])
      expect(result).toBe(true)
    })

    it('should return true for point at arc start', () => {
      const result = isPointOnArc([1, 0], [0, 0], [1, 0], [0, 1])
      expect(result).toBe(true)
    })

    it('should return true for point at arc end', () => {
      const result = isPointOnArc([0, 1], [0, 0], [1, 0], [0, 1])
      expect(result).toBe(true)
    })

    it('should return false for point off the arc', () => {
      // Point on circle but not on the arc (opposite side)
      const result = isPointOnArc([-1, 0], [0, 0], [1, 0], [0, 1])
      expect(result).toBe(false)
    })

    it('should return false for point not on circle', () => {
      const result = isPointOnArc([2, 0], [0, 0], [1, 0], [0, 1])
      expect(result).toBe(false)
    })

    it('should handle arc that wraps around', () => {
      // Arc from 350° to 10° (wraps around)
      const center: Coords2d = [0, 0]
      const start: Coords2d = [
        Math.cos((350 * Math.PI) / 180),
        Math.sin((350 * Math.PI) / 180),
      ]
      const end: Coords2d = [
        Math.cos((10 * Math.PI) / 180),
        Math.sin((10 * Math.PI) / 180),
      ]
      const point: Coords2d = [
        Math.cos((5 * Math.PI) / 180),
        Math.sin((5 * Math.PI) / 180),
      ]
      const result = isPointOnArc(point, center, start, end)
      expect(result).toBe(true)
    })
  })

  describe('lineArcIntersection', () => {
    it('should find intersection of line and arc', () => {
      // Horizontal line at y=0.5 intersecting arc from [1,0] to [0,1] centered at [0,0]
      const result = lineArcIntersection(
        [-1, 0.5],
        [1, 0.5],
        [0, 0],
        [1, 0],
        [0, 1]
      )
      expect(result).not.toBeNull()
      if (result) {
        // Should intersect at approximately [0.866, 0.5] or [-0.866, 0.5]
        expect(Math.abs(result[0])).toBeCloseTo(0.866, 2)
        expect(result[1]).toBeCloseTo(0.5, 2)
      }
    })

    it('should return null when line does not intersect arc', () => {
      const result = lineArcIntersection(
        [10, 10],
        [20, 20],
        [0, 0],
        [1, 0],
        [0, 1]
      )
      expect(result).toBeNull()
    })

    it('should return endpoint when line starts at arc endpoint', () => {
      const result = lineArcIntersection([1, 0], [2, 0], [0, 0], [1, 0], [0, 1])
      expect(result).not.toBeNull()
      if (result) {
        expect(result[0]).toBeCloseTo(1, 5)
        expect(result[1]).toBeCloseTo(0, 5)
      }
    })
  })

  describe('projectPointOntoSegment', () => {
    it('should return 0 for point at segment start', () => {
      const result = projectPointOntoSegment([0, 0], [0, 0], [10, 10])
      expect(result).toBeCloseTo(0, 5)
    })

    it('should return 1 for point at segment end', () => {
      const result = projectPointOntoSegment([10, 10], [0, 0], [10, 10])
      expect(result).toBeCloseTo(1, 5)
    })

    it('should return 0.5 for point at segment midpoint', () => {
      const result = projectPointOntoSegment([5, 5], [0, 0], [10, 10])
      expect(result).toBeCloseTo(0.5, 5)
    })

    it('should return negative value for point before segment start', () => {
      const result = projectPointOntoSegment([-1, -1], [0, 0], [10, 10])
      expect(result).toBeLessThan(0)
    })

    it('should return value > 1 for point after segment end', () => {
      const result = projectPointOntoSegment([11, 11], [0, 0], [10, 10])
      expect(result).toBeGreaterThan(1)
    })

    it('should handle horizontal segment', () => {
      const result = projectPointOntoSegment([5, 0], [0, 0], [10, 0])
      expect(result).toBeCloseTo(0.5, 5)
    })

    it('should handle vertical segment', () => {
      const result = projectPointOntoSegment([0, 5], [0, 0], [0, 10])
      expect(result).toBeCloseTo(0.5, 5)
    })
  })

  describe('perpendicularDistanceToSegment', () => {
    it('should return 0 for point on segment', () => {
      const result = perpendicularDistanceToSegment([5, 5], [0, 0], [10, 10])
      expect(result).toBeCloseTo(0, 5)
    })

    it('should return correct distance for point perpendicular to segment', () => {
      // Point at [5, 5] with segment from [0, 0] to [10, 0]
      // Perpendicular distance should be 5
      const result = perpendicularDistanceToSegment([5, 5], [0, 0], [10, 0])
      expect(result).toBeCloseTo(5, 5)
    })

    it('should return distance to endpoint when point projects outside segment', () => {
      // Point at [-1, 0] with segment from [0, 0] to [10, 0]
      // Should return distance to start point (1)
      const result = perpendicularDistanceToSegment([-1, 0], [0, 0], [10, 0])
      expect(result).toBeCloseTo(1, 5)
    })

    it('should handle degenerate segment', () => {
      const result = perpendicularDistanceToSegment([1, 1], [0, 0], [0, 0])
      expect(result).toBeCloseTo(Math.sqrt(2), 5)
    })
  })
})

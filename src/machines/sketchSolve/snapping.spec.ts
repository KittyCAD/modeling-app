import { describe, expect, it } from 'vitest'

import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  X_AXIS_TARGET,
  Y_AXIS_TARGET,
  getConstraintForSnapTarget,
  getCoincidentSegmentsForSnapTarget,
  getSnappingCandidates,
} from '@src/machines/sketchSolve/snapping'
import {
  createArcApiObject,
  createCircleApiObject,
  createLineApiObject,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

function createObjectsArray(objects: ApiObject[]) {
  return createSceneGraphDelta(objects).new_graph.objects
}

describe('snapping', () => {
  describe('getCoincidentSegmentsForSnapTarget', () => {
    it('supports line, arc, and circle snap targets', () => {
      expect(
        getCoincidentSegmentsForSnapTarget(5, { type: 'line', id: 10 })
      ).toEqual([5, 10])
      expect(
        getCoincidentSegmentsForSnapTarget(5, { type: 'arc', id: 11 })
      ).toEqual([5, 11])
      expect(
        getCoincidentSegmentsForSnapTarget(5, { type: 'circle', id: 12 })
      ).toEqual([5, 12])
    })
  })

  describe('getConstraintForSnapTarget', () => {
    it('uses horizontal point alignment when snapping to the x axis', () => {
      expect(getConstraintForSnapTarget(5, { type: X_AXIS_TARGET })).toEqual({
        type: 'Horizontal',
        points: [5, 'ORIGIN'],
      })
    })

    it('uses vertical point alignment when snapping to the y axis', () => {
      expect(getConstraintForSnapTarget(5, { type: Y_AXIS_TARGET })).toEqual({
        type: 'Vertical',
        points: [5, 'ORIGIN'],
      })
    })
  })

  describe('getSnappingCandidates', () => {
    it('projects line snap candidates onto the closest point on the segment', () => {
      const start = createPointApiObject({ id: 1, x: 0, y: 20 })
      const end = createPointApiObject({ id: 2, x: 40, y: 20 })
      const line = createLineApiObject({ id: 3, start: 1, end: 2 })

      const result = getSnappingCandidates(
        [12, 25],
        createObjectsArray([start, end, line]),
        createMockSceneInfra()
      )

      expect(result[0]).toEqual({
        target: { type: 'line', id: 3 },
        distance: 5,
        position: [12, 20],
      })
    })

    it('projects arc snap candidates onto the closest point on the arc', () => {
      const center = createPointApiObject({ id: 1, x: 0, y: 0 })
      const start = createPointApiObject({ id: 2, x: 30, y: 0 })
      const end = createPointApiObject({ id: 3, x: 0, y: 30 })
      const arc = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })

      const result = getSnappingCandidates(
        [20, 20],
        createObjectsArray([center, start, end, arc]),
        createMockSceneInfra()
      )

      expect(result[0]?.target).toEqual({ type: 'arc', id: 4 })
      expect(result[0]?.position[0]).toBeCloseTo(21.213203, 5)
      expect(result[0]?.position[1]).toBeCloseTo(21.213203, 5)
    })

    it('projects circle snap candidates onto the closest point on the circle', () => {
      const center = createPointApiObject({ id: 1, x: 40, y: 40 })
      const start = createPointApiObject({ id: 2, x: 70, y: 40 })
      const circle = createCircleApiObject({ id: 3, center: 1, start: 2 })

      const result = getSnappingCandidates(
        [40, 62],
        createObjectsArray([center, start, circle]),
        createMockSceneInfra()
      )

      expect(result[0]?.target).toEqual({ type: 'circle', id: 3 })
      expect(result[0]?.position[0]).toBeCloseTo(40, 5)
      expect(result[0]?.position[1]).toBeCloseTo(70, 5)
    })

    it('keeps points ahead of non-point segment targets', () => {
      const start = createPointApiObject({ id: 1, x: 0, y: 20 })
      const end = createPointApiObject({ id: 2, x: 40, y: 20 })
      const line = createLineApiObject({ id: 3, start: 1, end: 2 })
      const point = createPointApiObject({ id: 4, x: 20, y: 29 })

      const result = getSnappingCandidates(
        [20, 20],
        createObjectsArray([start, end, line, point]),
        createMockSceneInfra()
      )

      expect(result[0]?.target).toEqual({ type: 'point', id: 4 })
      expect(result[1]?.target).toEqual({ type: 'line', id: 3 })
    })
  })
})

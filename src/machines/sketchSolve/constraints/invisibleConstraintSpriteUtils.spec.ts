import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { describe, expect, it } from 'vitest'

import {
  findInvisibleConstraintClusterIds,
  findInvisibleConstraintsForSegment,
  findSegmentsForInvisibleConstraint,
  getInvisibleConstraintAnchor,
  isInvisibleConstraintObject,
  type InvisibleConstraintObject,
} from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'
import {
  createArcApiObject,
  createLineApiObject,
  createPointApiObject,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

function createObjectsArray(objects: ApiObject[]) {
  const array: ApiObject[] = []
  for (const object of objects) {
    array[object.id] = object
  }
  return array
}

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

describe('invisibleConstraintSpriteUtils', () => {
  it('recognizes non-visual constraints and excludes visual ones', () => {
    expect(
      isInvisibleConstraintObject(
        createConstraintApiObject(10, {
          type: 'Parallel',
          lines: [1, 2],
        })
      )
    ).toBe(true)

    expect(
      isInvisibleConstraintObject(
        createConstraintApiObject(11, {
          type: 'Angle',
          lines: [1, 2],
          angle: { value: 90, units: 'Deg' },
          source: { expr: '90deg', is_literal: true },
        })
      )
    ).toBe(false)
  })

  it('anchors a parallel constraint farther past the first line midpoint', () => {
    const p1 = createPointApiObject({ id: 1, x: 0, y: 0 })
    const p2 = createPointApiObject({ id: 2, x: 10, y: 0 })
    const p3 = createPointApiObject({ id: 3, x: 0, y: 10 })
    const p4 = createPointApiObject({ id: 4, x: 10, y: 20 })
    const line1 = createLineApiObject({ id: 10, start: 1, end: 2 })
    const line2 = createLineApiObject({ id: 11, start: 3, end: 4 })
    const constraint = createConstraintApiObject(20, {
      type: 'Parallel',
      lines: [10, 11],
    })

    const anchor = getInvisibleConstraintAnchor(
      constraint as InvisibleConstraintObject,
      createObjectsArray([p1, p2, p3, p4, line1, line2, constraint])
    )

    expect(anchor?.toArray()).toEqual([7, 0, 0])
  })

  it('anchors a tangent constraint at the shared endpoint when one exists', () => {
    const center = createPointApiObject({ id: 1, x: 5, y: 5 })
    const arcStart = createPointApiObject({ id: 2, x: 0, y: 0 })
    const sharedEnd = createPointApiObject({ id: 3, x: 10, y: 0 })
    const lineEnd = createPointApiObject({ id: 4, x: 20, y: 0 })
    const arc = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })
    const line = createLineApiObject({ id: 11, start: 3, end: 4 })
    const constraint = createConstraintApiObject(21, {
      type: 'Tangent',
      input: [10, 11],
    })

    const anchor = getInvisibleConstraintAnchor(
      constraint as InvisibleConstraintObject,
      createObjectsArray([
        center,
        arcStart,
        sharedEnd,
        lineEnd,
        arc,
        line,
        constraint,
      ])
    )

    expect(anchor?.toArray()).toEqual([10, 0, 0])
  })

  it('finds the invisible constraints related to a hovered line', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 10, y: 0 })
    const otherStart = createPointApiObject({ id: 3, x: 0, y: 10 })
    const otherEnd = createPointApiObject({ id: 4, x: 10, y: 10 })
    const line = createLineApiObject({ id: 10, start: 1, end: 2 })
    const otherLine = createLineApiObject({ id: 11, start: 3, end: 4 })
    const parallel = createConstraintApiObject(20, {
      type: 'Parallel',
      lines: [10, 11],
    })
    const coincident = createConstraintApiObject(21, {
      type: 'Coincident',
      segments: [2, 4],
    })

    const relatedConstraintIds = findInvisibleConstraintsForSegment(
      line,
      createObjectsArray([
        start,
        end,
        otherStart,
        otherEnd,
        line,
        otherLine,
        parallel,
        coincident,
      ])
    )

    expect(relatedConstraintIds).toEqual([20])
  })

  it('finds the invisible constraints related to a hovered point', () => {
    const point = createPointApiObject({ id: 1, x: 0, y: 0 })
    const otherPoint = createPointApiObject({ id: 2, x: 10, y: 0 })
    const line = createLineApiObject({ id: 10, start: 1, end: 2 })
    const coincident = createConstraintApiObject(20, {
      type: 'Coincident',
      segments: [1, 2],
    })
    const horizontal = createConstraintApiObject(21, {
      type: 'Horizontal',
      line: 10,
    } as ApiConstraint)

    const relatedConstraintIds = findInvisibleConstraintsForSegment(
      point,
      createObjectsArray([point, otherPoint, line, coincident, horizontal])
    )

    expect(relatedConstraintIds).toEqual([20])
  })

  it('finds point-list axis constraints related to a hovered point', () => {
    const point = createPointApiObject({ id: 1, x: 0, y: 0, owner: 10 })
    const otherPoint = createPointApiObject({ id: 2, x: 10, y: 0, owner: 11 })
    const line = createLineApiObject({ id: 10, start: 1, end: 3 })
    const otherLine = createLineApiObject({ id: 11, start: 2, end: 4 })
    const extraPointA = createPointApiObject({ id: 3, x: -10, y: 5, owner: 10 })
    const extraPointB = createPointApiObject({ id: 4, x: 20, y: 5, owner: 11 })
    const horizontal = createConstraintApiObject(21, {
      type: 'Horizontal',
      points: [1, 2],
    } as ApiConstraint)

    const relatedConstraintIds = findInvisibleConstraintsForSegment(
      point,
      createObjectsArray([
        point,
        otherPoint,
        extraPointA,
        extraPointB,
        line,
        otherLine,
        horizontal,
      ])
    )

    expect(relatedConstraintIds).toEqual([21])
  })

  it('highlights constrained points and owners for point-list axis constraints', () => {
    const pointA = createPointApiObject({ id: 1, x: 0, y: 5, owner: 10 })
    const pointB = createPointApiObject({ id: 2, x: 10, y: 5, owner: 11 })
    const extraPointA = createPointApiObject({ id: 3, x: 0, y: 0, owner: 10 })
    const extraPointB = createPointApiObject({ id: 4, x: 10, y: 10, owner: 11 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 3 })
    const lineB = createLineApiObject({ id: 11, start: 2, end: 4 })
    const horizontal = createConstraintApiObject(21, {
      type: 'Horizontal',
      points: [1, 2, 'ORIGIN'],
    } as ApiConstraint)

    const segmentIds = findSegmentsForInvisibleConstraint(
      horizontal as InvisibleConstraintObject,
      createObjectsArray([
        pointA,
        pointB,
        extraPointA,
        extraPointB,
        lineA,
        lineB,
        horizontal,
      ])
    )
    const anchor = getInvisibleConstraintAnchor(
      horizontal as InvisibleConstraintObject,
      createObjectsArray([
        pointA,
        pointB,
        extraPointA,
        extraPointB,
        lineA,
        lineB,
        horizontal,
      ])
    )

    expect(segmentIds).toEqual([1, 2, 10, 11])
    expect(anchor?.x).toBeCloseTo(10 / 3)
    expect(anchor?.y).toBeCloseTo(10 / 3)
    expect(anchor?.z).toBe(0)
  })

  it('finds the invisible constraint cluster for a coincident point cluster', () => {
    const pointA = createPointApiObject({ id: 1, x: 0, y: 0 })
    const pointB = createPointApiObject({ id: 2, x: 0, y: 0 })
    const pointC = createPointApiObject({ id: 3, x: 0, y: 0 })
    const coincidentAB = createConstraintApiObject(20, {
      type: 'Coincident',
      segments: [1, 2],
    })
    const coincidentBC = createConstraintApiObject(21, {
      type: 'Coincident',
      segments: [2, 3],
    })

    const clusterConstraintIds = findInvisibleConstraintClusterIds(
      coincidentAB as InvisibleConstraintObject,
      createObjectsArray([pointA, pointB, pointC, coincidentAB, coincidentBC])
    )

    expect(clusterConstraintIds).toEqual([20, 21])
  })

  it('finds invisible constraints for points in the same coincident cluster', () => {
    const pointA = createPointApiObject({ id: 1, x: 0, y: 0 })
    const pointB = createPointApiObject({ id: 2, x: 0, y: 0 })
    const pointC = createPointApiObject({ id: 3, x: 0, y: 0 })
    const coincidentAB = createConstraintApiObject(20, {
      type: 'Coincident',
      segments: [1, 2],
    })
    const coincidentBC = createConstraintApiObject(21, {
      type: 'Coincident',
      segments: [2, 3],
    })

    const relatedConstraintIds = findInvisibleConstraintsForSegment(
      pointA,
      createObjectsArray([pointA, pointB, pointC, coincidentAB, coincidentBC])
    )

    expect(relatedConstraintIds).toEqual([20, 21])
  })

  it('finds tangent constraints related to a hovered arc', () => {
    const center = createPointApiObject({ id: 1, x: 5, y: 5 })
    const arcStart = createPointApiObject({ id: 2, x: 0, y: 0 })
    const sharedEnd = createPointApiObject({ id: 3, x: 10, y: 0 })
    const lineEnd = createPointApiObject({ id: 4, x: 20, y: 0 })
    const arc = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })
    const line = createLineApiObject({ id: 11, start: 3, end: 4 })
    const tangent = createConstraintApiObject(20, {
      type: 'Tangent',
      input: [10, 11],
    })

    const relatedConstraintIds = findInvisibleConstraintsForSegment(
      arc,
      createObjectsArray([
        center,
        arcStart,
        sharedEnd,
        lineEnd,
        arc,
        line,
        tangent,
      ])
    )

    expect(relatedConstraintIds).toEqual([20])
  })

  it('finds constrained segments for a hovered invisible constraint', () => {
    const center = createPointApiObject({ id: 1, x: 5, y: 5 })
    const arcStart = createPointApiObject({ id: 2, x: 0, y: 0 })
    const sharedEnd = createPointApiObject({ id: 3, x: 10, y: 0 })
    const lineEnd = createPointApiObject({ id: 4, x: 20, y: 0 })
    const arc = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })
    const line = createLineApiObject({ id: 11, start: 3, end: 4 })
    const tangent = createConstraintApiObject(20, {
      type: 'Tangent',
      input: [10, 11],
    })

    const segmentIds = findSegmentsForInvisibleConstraint(
      tangent as InvisibleConstraintObject,
      createObjectsArray([
        center,
        arcStart,
        sharedEnd,
        lineEnd,
        arc,
        line,
        tangent,
      ])
    )

    expect(segmentIds).toEqual([10, 11])
  })

  it('includes owner line and arc segments when highlighting a coincident constraint', () => {
    const pointA = createPointApiObject({ id: 1, x: 0, y: 0, owner: 10 })
    const pointB = createPointApiObject({ id: 2, x: 0, y: 0, owner: 12 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 3 })
    const arcCenter = createPointApiObject({ id: 11, x: 5, y: 5 })
    const arcB = createArcApiObject({ id: 12, center: 11, start: 4, end: 2 })
    const otherPointA = createPointApiObject({ id: 3, x: -10, y: 0, owner: 10 })
    const arcStart = createPointApiObject({ id: 4, x: 10, y: 0, owner: 12 })
    const coincident = createConstraintApiObject(20, {
      type: 'Coincident',
      segments: [1, 2],
    })

    const segmentIds = findSegmentsForInvisibleConstraint(
      coincident as InvisibleConstraintObject,
      createObjectsArray([
        pointA,
        pointB,
        otherPointA,
        arcStart,
        lineA,
        arcCenter,
        arcB,
        coincident,
      ])
    )

    expect(segmentIds).toEqual([1, 2, 10, 12])
  })

  it('includes directly constrained segments in a coincident constraint highlight', () => {
    const point = createPointApiObject({ id: 1, x: 0, y: 0, owner: 10 })
    const otherPoint = createPointApiObject({ id: 2, x: 10, y: 0, owner: 10 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineStart = createPointApiObject({ id: 3, x: 20, y: 0, owner: 11 })
    const lineEnd = createPointApiObject({ id: 4, x: 20, y: 10, owner: 11 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const coincident = createConstraintApiObject(20, {
      type: 'Coincident',
      segments: [1, 11],
    })

    const segmentIds = findSegmentsForInvisibleConstraint(
      coincident as InvisibleConstraintObject,
      createObjectsArray([
        point,
        otherPoint,
        lineA,
        lineStart,
        lineEnd,
        lineB,
        coincident,
      ])
    )

    expect(segmentIds).toEqual(expect.arrayContaining([1, 10, 11]))
    expect(segmentIds).toHaveLength(3)
  })
})

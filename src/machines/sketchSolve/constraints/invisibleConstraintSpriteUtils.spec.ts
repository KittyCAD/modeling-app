import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { describe, expect, it } from 'vitest'

import {
  findInvisibleConstraintsForSegment,
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

  it('anchors a parallel constraint at the average of its line midpoints', () => {
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

    expect(anchor?.toArray()).toEqual([5, 7.5, 0])
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
    })

    const relatedConstraintIds = findInvisibleConstraintsForSegment(
      point,
      createObjectsArray([point, otherPoint, line, coincident, horizontal])
    )

    expect(relatedConstraintIds).toEqual([20])
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
})

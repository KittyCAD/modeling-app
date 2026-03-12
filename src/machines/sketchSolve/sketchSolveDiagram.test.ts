import { describe, expect, it } from 'vitest'
import type {
  ApiObject,
  ApiStartOrEnd,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  createArcApiObject,
  createLineApiObject,
  createPointApiObject,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import {
  buildAngleConstraintInput,
  buildTangentConstraintInput,
  isArcSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'

function createObjectsArray(objects: ApiObject[]) {
  const array: ApiObject[] = []
  for (const object of objects) {
    array[object.id] = object
  }
  return array
}

describe('buildAngleConstraintInput', () => {
  it('builds a 45deg angle constraint for lines (0,0)->(0,10) and (0,0)->(10,10)', () => {
    const origin = createPointApiObject({ id: 1, x: 0, y: 0 })
    const up = createPointApiObject({ id: 2, x: 0, y: 10 })
    const diag = createPointApiObject({ id: 3, x: 10, y: 10 })

    const verticalLine = createLineApiObject({ id: 10, start: 1, end: 2 })
    const diagonalLine = createLineApiObject({ id: 11, start: 1, end: 3 })
    const objects = createObjectsArray([
      origin,
      up,
      diag,
      verticalLine,
      diagonalLine,
    ])

    const constraint = buildAngleConstraintInput(
      diagonalLine,
      verticalLine,
      objects
    )

    expect(constraint).toEqual({
      type: 'Angle',
      lines: [11, 10],
      angle: { value: 45, units: 'Deg' },
      source: { expr: '45deg', is_literal: true },
    })
  })

  it('builds a 225deg angle constraint when one line direction is inverted', () => {
    const origin = createPointApiObject({ id: 1, x: 0, y: 0 })
    const up = createPointApiObject({ id: 2, x: 0, y: 10 })
    const diag = createPointApiObject({ id: 3, x: 10, y: 10 })

    const verticalLineInverted = createLineApiObject({
      id: 12,
      start: 2,
      end: 1,
    })
    const diagonalLine = createLineApiObject({ id: 11, start: 1, end: 3 })
    const objects = createObjectsArray([
      origin,
      up,
      diag,
      verticalLineInverted,
      diagonalLine,
    ])

    const constraint = buildAngleConstraintInput(
      diagonalLine,
      verticalLineInverted,
      objects
    )

    expect(constraint).toEqual({
      type: 'Angle',
      lines: [11, 12],
      angle: { value: 225, units: 'Deg' },
      source: { expr: '225deg', is_literal: true },
    })
  })
})

describe('buildTangentConstraintInput', () => {
  it('builds a tangent constraint for one selected line and one selected arc', () => {
    const center = createPointApiObject({ id: 1, x: 5, y: 5 })
    const arcStart = createPointApiObject({ id: 2, x: 0, y: 0 })
    const arcEnd = createPointApiObject({ id: 3, x: 10, y: 0 })
    const lineStart = createPointApiObject({ id: 4, x: 0, y: 0 })
    const lineEnd = createPointApiObject({ id: 5, x: 10, y: 0 })
    const arc = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })
    const line = createLineApiObject({ id: 11, start: 4, end: 5 })
    const objects = createObjectsArray([
      center,
      arcStart,
      arcEnd,
      lineStart,
      lineEnd,
      arc,
      line,
    ])

    expect(buildTangentConstraintInput([11, 10], objects)).toEqual({
      type: 'Tangent',
      input: [11, 10],
    })
    expect(buildTangentConstraintInput([10, 11], objects)).toEqual({
      type: 'Tangent',
      input: [11, 10],
    })
  })

  it('returns null unless exactly one line and one arc are selected', () => {
    const p1 = createPointApiObject({ id: 1, x: 0, y: 0 })
    const p2 = createPointApiObject({ id: 2, x: 10, y: 0 })
    const p3 = createPointApiObject({ id: 3, x: 20, y: 0 })
    const line1 = createLineApiObject({ id: 10, start: 1, end: 2 })
    const line2 = createLineApiObject({ id: 11, start: 2, end: 3 })
    const objects = createObjectsArray([p1, p2, p3, line1, line2])

    expect(buildTangentConstraintInput([], objects)).toBeNull()
    expect(buildTangentConstraintInput([10], objects)).toBeNull()
    expect(buildTangentConstraintInput([10, 11], objects)).toBeNull()
  })

  it('rejects arcs whose ctor is not a plain Arc', () => {
    const center = createPointApiObject({ id: 1, x: 5, y: 5 })
    const arcStart = createPointApiObject({ id: 2, x: 0, y: 0 })
    const arcEnd = createPointApiObject({ id: 3, x: 10, y: 0 })
    const lineStart = createPointApiObject({ id: 4, x: 0, y: 0 })
    const lineEnd = createPointApiObject({ id: 5, x: 10, y: 0 })
    const arc = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })
    const line = createLineApiObject({ id: 11, start: 4, end: 5 })

    if (isArcSegment(arc) && arc.kind.segment.ctor.type === 'Arc') {
      const arcCtor = arc.kind.segment.ctor
      arc.kind.segment.ctor = {
        type: 'TangentArc',
        start: arcCtor.start,
        end: arcCtor.end,
        tangent: {
          type: 'Start',
          value: line.id,
        } as unknown as ApiStartOrEnd<number>,
      }
    }

    const objects = createObjectsArray([
      center,
      arcStart,
      arcEnd,
      lineStart,
      lineEnd,
      arc,
      line,
    ])

    expect(buildTangentConstraintInput([11, 10], objects)).toBeNull()
  })
})

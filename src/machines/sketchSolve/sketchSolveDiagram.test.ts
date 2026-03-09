import { describe, expect, it } from 'vitest'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  createLineApiObject,
  createPointApiObject,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { buildAngleConstraintInput } from '@src/machines/sketchSolve/constraints/constraintUtils'

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

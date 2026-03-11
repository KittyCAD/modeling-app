import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  calculateArcRenderInput,
  MIN_NON_OVERLAP_ANGLE_CONSTRAINT_RADIUS_PX,
} from '@src/machines/sketchSolve/constraints/AngleConstraintBuilder'
import { describe, expect, it } from 'vitest'

function makePoint(id: number, x: number, y: number): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Point',
        position: {
          x: { value: x, units: 'Mm', type: 'Var' },
          y: { value: y, units: 'Mm', type: 'Var' },
        },
      },
    },
  } as ApiObject
}

function makeLine(id: number, start: number, end: number): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Line',
        start,
        end,
      },
    },
  } as ApiObject
}

function makeAngleConstraint(
  id: number,
  line1: number,
  line2: number,
  angleDeg: number
): ApiObject {
  return {
    id,
    kind: {
      type: 'Constraint',
      constraint: {
        type: 'Angle',
        lines: [line1, line2],
        angle: { value: angleDeg, units: 'Deg' },
      },
    },
  } as ApiObject
}

describe('calculateArcRenderInput', () => {
  it('uses a minimum fallback radius when the shared point collapses the overlap', () => {
    const objects = [
      makePoint(0, -10, 0),
      makePoint(1, 0, 0),
      makePoint(2, 0, 10),
      makeLine(3, 0, 1),
      makeLine(4, 1, 2),
    ]
    const constraint = makeAngleConstraint(5, 3, 4, 90)

    const renderInput = calculateArcRenderInput(constraint, objects, 1)

    expect(renderInput).not.toBeNull()
    expect(renderInput?.radius).toBe(MIN_NON_OVERLAP_ANGLE_CONSTRAINT_RADIUS_PX)
    expect(renderInput?.labelPosition[0]).toBeCloseTo(
      MIN_NON_OVERLAP_ANGLE_CONSTRAINT_RADIUS_PX / Math.sqrt(2)
    )
    expect(renderInput?.labelPosition[1]).toBeCloseTo(
      MIN_NON_OVERLAP_ANGLE_CONSTRAINT_RADIUS_PX / Math.sqrt(2)
    )
  })

  it('keeps the geometric radius when the lines really overlap, even at large scale', () => {
    const objects = [
      makePoint(0, 0, 0),
      makePoint(1, 10, 0),
      makePoint(2, 0, 10),
      makeLine(3, 0, 1),
      makeLine(4, 0, 2),
    ]
    const constraint = makeAngleConstraint(5, 3, 4, 90)

    const renderInput = calculateArcRenderInput(constraint, objects, 100)

    expect(renderInput).not.toBeNull()
    expect(renderInput?.radius).toBeCloseTo(1.5)
  })
})

import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { calculateArcRenderInput as calculateArcInput } from '@src/machines/sketchSolve/constraints/AngleConstraintBuilder'
import {
  createLineApiObject,
  createPointApiObject,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it } from 'vitest'

function createObjectsArray(objects: ApiObject[]) {
  const array: ApiObject[] = []
  for (const object of objects) {
    array[object.id] = object
  }
  return array
}

function createAngleConstraintApiObject({
  id,
  lines,
  angle,
  sector,
  inverse,
  labelPosition,
}: {
  id: number
  lines: [number, number]
  angle: number
  sector?: 1 | 2 | 3 | 4
  inverse?: boolean
  labelPosition?: [number, number]
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Constraint',
      constraint: {
        type: 'Angle',
        lines,
        angle: { value: angle, units: 'Deg' },
        sector,
        inverse,
        labelPosition: labelPosition
          ? {
              x: { value: labelPosition[0], units: 'Mm' },
              y: { value: labelPosition[1], units: 'Mm' },
            }
          : undefined,
        source: { expr: `${angle}deg`, is_literal: true },
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function createSectorTestObjects(
  sector: 1 | 2 | 3 | 4,
  angle = 60,
  inverse = false
) {
  const origin = createPointApiObject({ id: 1, x: 0, y: 0 })
  const east = createPointApiObject({ id: 2, x: 10, y: 0 })
  const sixtyDegrees = createPointApiObject({
    id: 3,
    x: 5,
    y: 5 * Math.sqrt(3),
  })
  const horizontalLine = createLineApiObject({ id: 10, start: 1, end: 2 })
  const angledLine = createLineApiObject({ id: 11, start: 1, end: 3 })
  const angleConstraint = createAngleConstraintApiObject({
    id: 20,
    lines: [10, 11],
    angle,
    sector,
    inverse,
  })

  return {
    angleConstraint,
    objects: createObjectsArray([
      origin,
      east,
      sixtyDegrees,
      horizontalLine,
      angledLine,
      angleConstraint,
    ]),
  }
}

describe('calculateArcRenderInput', () => {
  it('renders sector 1 from line0 forward to line1 forward', () => {
    const { angleConstraint, objects } = createSectorTestObjects(1)

    const arcInput = calculateArcInput(angleConstraint, objects, 1)

    expect(arcInput?.line1).toEqual([
      [0, 0],
      [10, 0],
    ])
    expect(arcInput?.line2).toEqual([
      [0, 0],
      [5, 5 * Math.sqrt(3)],
    ])
    expect(arcInput?.startAngle).toBeCloseTo(0)
    expect(arcInput?.sweepAngle).toBeCloseTo(Math.PI / 3)
  })

  it('renders the inverse sweep of the selected sector', () => {
    const { angleConstraint, objects } = createSectorTestObjects(1, 300, true)

    const arcInput = calculateArcInput(angleConstraint, objects, 1)

    expect(arcInput?.line1).toEqual([
      [0, 0],
      [5, 5 * Math.sqrt(3)],
    ])
    expect(arcInput?.line2).toEqual([
      [0, 0],
      [10, 0],
    ])
    expect(arcInput?.startAngle).toBeCloseTo(Math.PI / 3)
    expect(arcInput?.sweepAngle).toBeCloseTo((5 * Math.PI) / 3)
  })

  it('uses explicit label position for sector angle rendering', () => {
    const { objects } = createSectorTestObjects(1)
    const angleConstraint = createAngleConstraintApiObject({
      id: 20,
      lines: [10, 11],
      angle: 60,
      sector: 1,
      labelPosition: [20, 30],
    })
    objects[20] = angleConstraint

    const arcInput = calculateArcInput(angleConstraint, objects, 1)

    expect(arcInput?.labelPosition).toEqual([20, 30])
    expect(arcInput?.labelAngle).toBeCloseTo(Math.atan2(30, 20))
    expect(arcInput?.radius).toBeCloseTo(Math.hypot(20, 30))
    expect(arcInput?.startAngle).toBeCloseTo(0)
    expect(arcInput?.sweepAngle).toBeCloseTo(Math.PI / 3)
  })

  it('does not infer inverse sweep from a major angle value', () => {
    const { angleConstraint, objects } = createSectorTestObjects(1, 300)

    const arcInput = calculateArcInput(angleConstraint, objects, 1)

    expect(arcInput?.line1).toEqual([
      [0, 0],
      [10, 0],
    ])
    expect(arcInput?.line2).toEqual([
      [0, 0],
      [5, 5 * Math.sqrt(3)],
    ])
    expect(arcInput?.startAngle).toBeCloseTo(0)
    expect(arcInput?.sweepAngle).toBeCloseTo(Math.PI / 3)
  })

  it('renders sector 2 from line1 forward to line0 reverse', () => {
    const { angleConstraint, objects } = createSectorTestObjects(2, 120)

    const arcInput = calculateArcInput(angleConstraint, objects, 1)

    expect(arcInput?.line1).toEqual([
      [0, 0],
      [5, 5 * Math.sqrt(3)],
    ])
    expect(arcInput?.line2).toEqual([
      [0, 0],
      [10, 0],
    ])
    expect(arcInput?.startAngle).toBeCloseTo(Math.PI / 3)
    expect(arcInput?.sweepAngle).toBeCloseTo((2 * Math.PI) / 3)
  })

  it('renders sector 3 from line0 reverse to line1 reverse', () => {
    const { angleConstraint, objects } = createSectorTestObjects(3)

    const arcInput = calculateArcInput(angleConstraint, objects, 1)

    expect(arcInput?.line1).toEqual([
      [0, 0],
      [10, 0],
    ])
    expect(arcInput?.line2).toEqual([
      [0, 0],
      [5, 5 * Math.sqrt(3)],
    ])
    expect(arcInput?.startAngle).toBeCloseTo(-Math.PI)
    expect(arcInput?.sweepAngle).toBeCloseTo(Math.PI / 3)
  })

  it('renders sector 4 from line1 reverse to line0 forward', () => {
    const { angleConstraint, objects } = createSectorTestObjects(4, 120)

    const arcInput = calculateArcInput(angleConstraint, objects, 1)

    expect(arcInput?.line1).toEqual([
      [0, 0],
      [5, 5 * Math.sqrt(3)],
    ])
    expect(arcInput?.line2).toEqual([
      [0, 0],
      [10, 0],
    ])
    expect(arcInput?.startAngle).toBeCloseTo((-2 * Math.PI) / 3)
    expect(arcInput?.sweepAngle).toBeCloseTo((2 * Math.PI) / 3)
  })

  it('uses the legacy heuristic when sector metadata is absent', () => {
    const { angleConstraint, objects } = createSectorTestObjects(1)
    if (
      angleConstraint.kind.type === 'Constraint' &&
      angleConstraint.kind.constraint.type === 'Angle'
    ) {
      delete angleConstraint.kind.constraint.sector
    }

    const arcInput = calculateArcInput(angleConstraint, objects, 1)

    expect(arcInput?.startAngle).toBeCloseTo(0)
    expect(arcInput?.sweepAngle).toBeCloseTo(Math.PI / 3)
  })

  it('uses explicit label position for legacy angle rendering', () => {
    const { objects } = createSectorTestObjects(1)
    const angleConstraint = createAngleConstraintApiObject({
      id: 20,
      lines: [10, 11],
      angle: 60,
      labelPosition: [21, 31],
    })
    objects[20] = angleConstraint

    const arcInput = calculateArcInput(angleConstraint, objects, 1)

    expect(arcInput?.labelPosition).toEqual([21, 31])
    expect(arcInput?.labelAngle).toBeCloseTo(Math.atan2(31, 21))
    expect(arcInput?.radius).toBeCloseTo(Math.hypot(21, 31))
    expect(arcInput?.startAngle).toBeCloseTo(0)
    expect(arcInput?.sweepAngle).toBeCloseTo(Math.PI / 3)
  })
})

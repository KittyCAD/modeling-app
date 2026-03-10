import { describe, expect, it } from 'vitest'
import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  getConstraintIconPath,
  getNonVisualConstraintAnchor,
  getNonVisualConstraintPlacement,
  isEditableConstraint,
  isNonVisualConstraint,
  type NonVisualConstraintObject,
} from '@src/machines/sketchSolve/constraints/constraintUtils'

function createPoint(id: number, x: number, y: number): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Point',
        position: {
          x: { value: x, units: 'Mm' },
          y: { value: y, units: 'Mm' },
        },
        ctor: null,
        owner: null,
        freedom: 'Free',
        constraints: [],
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  }
}

function createLine(id: number, start: number, end: number): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Line',
        start,
        end,
        ctor: {
          type: 'Line',
          start: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          end: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
        },
        ctor_applicable: true,
        construction: false,
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  }
}

function createArc(
  id: number,
  center: number,
  start: number,
  end: number
): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Arc',
        center,
        start,
        end,
        ctor: {
          type: 'Arc',
          center: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          start: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          end: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
        },
        ctor_applicable: true,
        construction: false,
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  }
}

function createConstraint(id: number, constraint: ApiConstraint): ApiObject {
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
  }
}

describe('constraintUtils', () => {
  it('identifies non-visual and editable constraint types', () => {
    const parallel = createConstraint(10, {
      type: 'Parallel',
      lines: [1, 2],
    })
    const distance = createConstraint(11, {
      type: 'Distance',
      points: [1, 2],
      distance: { value: 10, units: 'Mm' },
      source: { expr: '10', is_literal: true },
    })

    expect(isNonVisualConstraint(parallel)).toBe(true)
    expect(isEditableConstraint(parallel)).toBe(false)
    expect(isEditableConstraint(distance)).toBe(true)
  })

  it('maps supported non-visual constraint types to icon paths', () => {
    expect(getConstraintIconPath('Coincident')).toBeTruthy()
    expect(getConstraintIconPath('Parallel')).toBeTruthy()
    expect(getConstraintIconPath('Perpendicular')).toBeTruthy()
    expect(getConstraintIconPath('LinesEqualLength')).toBeTruthy()
    expect(getConstraintIconPath('Horizontal')).toBeTruthy()
    expect(getConstraintIconPath('Vertical')).toBeTruthy()
  })

  it('positions horizontal constraints at the constrained line midpoint', () => {
    const objects: ApiObject[] = []
    objects[1] = createPoint(1, 0, 0)
    objects[2] = createPoint(2, 10, 0)
    objects[3] = createLine(3, 1, 2)
    const horizontal = createConstraint(4, {
      type: 'Horizontal',
      line: 3,
    }) as NonVisualConstraintObject

    const anchor = getNonVisualConstraintAnchor(horizontal, objects)

    expect(anchor?.x).toBe(5)
    expect(anchor?.y).toBe(0)
  })

  it('positions line-pair constraints at the average of their midpoints', () => {
    const objects: ApiObject[] = []
    objects[1] = createPoint(1, 0, 0)
    objects[2] = createPoint(2, 10, 0)
    objects[3] = createPoint(3, 0, 10)
    objects[4] = createPoint(4, 10, 10)
    objects[5] = createLine(5, 1, 2)
    objects[6] = createLine(6, 3, 4)
    const parallel = createConstraint(7, {
      type: 'Parallel',
      lines: [5, 6],
    }) as NonVisualConstraintObject

    const anchor = getNonVisualConstraintAnchor(parallel, objects)

    expect(anchor?.x).toBe(5)
    expect(anchor?.y).toBe(5)
  })

  it('uses the midpoint along an arc for coincident anchors', () => {
    const objects: ApiObject[] = []
    objects[1] = createPoint(1, 0, 0)
    objects[2] = createPoint(2, 10, 0)
    objects[3] = createPoint(3, 0, 10)
    objects[4] = createArc(4, 1, 2, 3)
    const coincident = createConstraint(5, {
      type: 'Coincident',
      segments: [4],
    }) as NonVisualConstraintObject

    const anchor = getNonVisualConstraintAnchor(coincident, objects)

    expect(anchor?.x).toBeCloseTo(Math.sqrt(50))
    expect(anchor?.y).toBeCloseTo(Math.sqrt(50))
  })

  it('offsets point-based coincident constraints from the point in screen space', () => {
    const objects: ApiObject[] = []
    objects[1] = createPoint(1, 2, 3)
    objects[2] = createPoint(2, 10, 3)
    objects[3] = createLine(3, 1, 2)
    const coincident = createConstraint(4, {
      type: 'Coincident',
      segments: [1, 3],
    }) as NonVisualConstraintObject

    const placement = getNonVisualConstraintPlacement(coincident, objects)

    expect(placement?.anchor.x).toBe(2)
    expect(placement?.anchor.y).toBe(3)
    expect(placement?.offsetPx).toEqual({ x: 10, y: 10 })
  })
})

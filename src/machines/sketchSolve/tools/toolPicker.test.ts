import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  createArcApiObject,
  createCircleApiObject,
  createControlPointSplineApiObject,
  createLineApiObject,
  createPointApiObject,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import {
  type DirectlyPickableTool,
  getToolForApiObject,
  getToolForConstraintType,
  resolveToolPickerSelection,
} from '@src/machines/sketchSolve/tools/toolPicker'
import { describe, expect, it } from 'vitest'

const expectedConstraintTools = {
  Coincident: 'coincidentConstraintTool',
  Distance: 'dimensionTool',
  Angle: 'dimensionTool',
  Diameter: 'dimensionTool',
  EqualRadius: 'equalLengthConstraintTool',
  Fixed: 'fixedConstraintTool',
  HorizontalDistance: 'dimensionTool',
  VerticalDistance: 'dimensionTool',
  Horizontal: 'horizontalConstraintTool',
  LinesEqualLength: 'equalLengthConstraintTool',
  Midpoint: 'midpointConstraintTool',
  Parallel: 'parallelConstraintTool',
  Perpendicular: 'perpendicularConstraintTool',
  Radius: 'dimensionTool',
  Symmetric: 'symmetricConstraintTool',
  Tangent: 'tangentConstraintTool',
  Vertical: 'verticalConstraintTool',
} satisfies Record<ApiConstraint['type'], DirectlyPickableTool | null>

function createHorizontalConstraintApiObject(id: number): ApiObject {
  return {
    id,
    kind: {
      type: 'Constraint',
      constraint: { type: 'Horizontal', line: 3 },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

describe('toolPicker', () => {
  it('maps every constraint type to its matching tool', () => {
    for (const [constraintType, tool] of Object.entries(
      expectedConstraintTools
    )) {
      expect(
        getToolForConstraintType(constraintType as ApiConstraint['type'])
      ).toBe(tool ?? undefined)
    }
  })

  it('maps standalone points, lines, arcs, circles, and constraint objects to their tools', () => {
    const point = createPointApiObject({ id: 12 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const arc = createArcApiObject({ id: 7, center: 4, start: 5, end: 6 })
    const circle = createCircleApiObject({ id: 10, center: 8, start: 9 })
    const constraint = createHorizontalConstraintApiObject(11)

    expect(getToolForApiObject(point)).toBe('pointTool')
    expect(getToolForApiObject(line)).toBe('lineTool')
    expect(getToolForApiObject(arc)).toBe('centerArcTool')
    expect(getToolForApiObject(circle)).toBe('circleTool')
    expect(getToolForApiObject(constraint)).toBe('horizontalConstraintTool')
  })

  it('skips an owned endpoint to pick the line underneath it', () => {
    const point = createPointApiObject({ id: 1, owner: 3 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })

    expect(resolveToolPickerSelection([point, line])).toEqual({
      type: 'equip',
      tool: 'lineTool',
    })
  })

  it('treats draft-only candidates as empty space', () => {
    const draftPoint = createPointApiObject({ id: 2, owner: 3 })
    const draftLine = createLineApiObject({ id: 3, start: 1, end: 2 })

    expect(
      resolveToolPickerSelection([draftPoint, draftLine], new Set([3]))
    ).toEqual({ type: 'empty' })
  })

  it('distinguishes unsupported geometry from empty space', () => {
    const spline = createControlPointSplineApiObject({
      id: 4,
      controls: [1, 2, 3],
    })

    expect(resolveToolPickerSelection([spline])).toEqual({
      type: 'unsupported',
    })
    expect(resolveToolPickerSelection([])).toEqual({ type: 'empty' })
  })
})

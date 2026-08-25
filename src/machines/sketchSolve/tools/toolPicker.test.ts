import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { EquipTool } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  createArcApiObject,
  createCircleApiObject,
  createLineApiObject,
  createPointApiObject,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import {
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
} satisfies Record<ApiConstraint['type'], EquipTool>

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
      ).toBe(tool)
    }
  })

  it('maps lines, circles, and constraint objects to their tools', () => {
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const circle = createCircleApiObject({ id: 6, center: 4, start: 5 })
    const constraint = createHorizontalConstraintApiObject(7)

    expect(getToolForApiObject(line)).toBe('lineTool')
    expect(getToolForApiObject(circle)).toBe('circleTool')
    expect(getToolForApiObject(constraint)).toBe('horizontalConstraintTool')
  })

  it('skips an unsupported point to pick the line underneath it', () => {
    const point = createPointApiObject({ id: 1 })
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
    const arc = createArcApiObject({
      id: 4,
      center: 1,
      start: 2,
      end: 3,
    })

    expect(resolveToolPickerSelection([arc])).toEqual({ type: 'unsupported' })
    expect(resolveToolPickerSelection([])).toEqual({ type: 'empty' })
  })
})

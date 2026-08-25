import { getConstraintBadgeTooltipPosition } from '@src/machines/sketchSolve/constraints/constraintBadgeTooltip'
import {
  constraintToolMetadata,
  invisibleConstraintMetadata,
} from '@src/machines/sketchSolve/constraints/constraintMetadata'
import { describe, expect, it } from 'vitest'

describe('constraint badge tooltip content', () => {
  it('covers every invisible constraint type', () => {
    expect(Object.keys(invisibleConstraintMetadata).sort()).toEqual([
      'Coincident',
      'EqualRadius',
      'Horizontal',
      'LinesEqualLength',
      'Midpoint',
      'Parallel',
      'Perpendicular',
      'Symmetric',
      'Tangent',
      'Vertical',
    ])
  })

  it.each([
    {
      constraintType: 'Coincident',
      toolName: 'coincidentConstraintTool',
    },
    { constraintType: 'Horizontal', toolName: 'horizontalConstraintTool' },
    { constraintType: 'Vertical', toolName: 'verticalConstraintTool' },
    { constraintType: 'Midpoint', toolName: 'midpointConstraintTool' },
    { constraintType: 'Parallel', toolName: 'parallelConstraintTool' },
    {
      constraintType: 'Perpendicular',
      toolName: 'perpendicularConstraintTool',
    },
    { constraintType: 'Tangent', toolName: 'tangentConstraintTool' },
    { constraintType: 'Symmetric', toolName: 'symmetricConstraintTool' },
  ] as const)(
    'reuses $toolName metadata for $constraintType',
    ({ constraintType, toolName }) => {
      expect(invisibleConstraintMetadata[constraintType]).toBe(
        constraintToolMetadata[toolName]
      )
    }
  )

  it('uses the realized equal constraint names', () => {
    expect(invisibleConstraintMetadata.LinesEqualLength).toEqual({
      title: 'Equal length',
      description: 'Constrain lines to have equal length.',
    })
    expect(invisibleConstraintMetadata.EqualRadius).toEqual({
      title: 'Equal radius',
      description: 'Constrain arcs and circles to have equal radius.',
    })
  })
})

describe('getConstraintBadgeTooltipPosition', () => {
  const bounds = { left: 100, top: 50, right: 500, bottom: 350 }
  const tooltipSize = { width: 160, height: 80 }

  it.each([
    {
      name: 'below and right when there is room',
      pointer: { x: 200, y: 120 },
      expected: { x: 208, y: 128 },
    },
    {
      name: 'left near the right edge',
      pointer: { x: 490, y: 120 },
      expected: { x: 322, y: 128 },
    },
    {
      name: 'above near the bottom edge',
      pointer: { x: 200, y: 340 },
      expected: { x: 208, y: 252 },
    },
    {
      name: 'inside the padded bounds at the top-left corner',
      pointer: { x: 100, y: 50 },
      expected: { x: 108, y: 58 },
    },
  ])('$name', ({ pointer, expected }) => {
    expect(
      getConstraintBadgeTooltipPosition({ pointer, tooltipSize, bounds })
    ).toEqual(expected)
  })

  it('clamps a tooltip that is wider than the available space', () => {
    expect(
      getConstraintBadgeTooltipPosition({
        pointer: { x: 115, y: 65 },
        tooltipSize: { width: 500, height: 400 },
        bounds,
      })
    ).toEqual({ x: 108, y: 58 })
  })
})

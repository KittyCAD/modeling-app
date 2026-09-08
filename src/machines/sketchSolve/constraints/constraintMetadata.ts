import type { InvisibleConstraint } from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'
import type { ConstraintToolName } from '@src/machines/sketchSolve/tools/constraintToolModel'

export type ConstraintMetadata = {
  title: string
  description: string
}

export const constraintToolMetadata = {
  coincidentConstraintTool: {
    title: 'Coincident',
    description: 'Constrain points or curves to be coincident.',
  },
  midpointConstraintTool: {
    title: 'Midpoint',
    description: 'Constrain a point to lie at the midpoint of a selected line.',
  },
  tangentConstraintTool: {
    title: 'Tangent',
    description:
      'Constrain a selected line and arc, or two arcs, to be tangent at their shared contact.',
  },
  parallelConstraintTool: {
    title: 'Parallel',
    description: 'Constrain lines or curves to be parallel.',
  },
  perpendicularConstraintTool: {
    title: 'Perpendicular',
    description: 'Constrain lines or curves to be perpendicular.',
  },
  equalLengthConstraintTool: {
    title: 'Equal',
    description:
      'Constrain lines to have equal length, or arcs and circles to have equal radius.',
  },
  symmetricConstraintTool: {
    title: 'Symmetric',
    description:
      'Constrain two points, two arc-like segments, or two lines to be symmetric across a selected axis line.',
  },
  verticalConstraintTool: {
    title: 'Vertical',
    description: 'Constrain lines to be vertical.',
  },
  horizontalConstraintTool: {
    title: 'Horizontal',
    description: 'Constrain lines to be horizontal.',
  },
  fixedConstraintTool: {
    title: 'Fixed',
    description: 'Lock selected points to their current x and y positions.',
  },
} satisfies Record<ConstraintToolName, ConstraintMetadata>

export const invisibleConstraintMetadata = {
  Coincident: constraintToolMetadata.coincidentConstraintTool,
  Horizontal: constraintToolMetadata.horizontalConstraintTool,
  Vertical: constraintToolMetadata.verticalConstraintTool,
  LinesEqualLength: {
    title: 'Equal length',
    description: 'Constrain lines to have equal length.',
  },
  Midpoint: constraintToolMetadata.midpointConstraintTool,
  EqualRadius: {
    title: 'Equal radius',
    description: 'Constrain arcs and circles to have equal radius.',
  },
  Parallel: constraintToolMetadata.parallelConstraintTool,
  Perpendicular: constraintToolMetadata.perpendicularConstraintTool,
  Tangent: constraintToolMetadata.tangentConstraintTool,
  Symmetric: constraintToolMetadata.symmetricConstraintTool,
} satisfies Record<InvisibleConstraint['type'], ConstraintMetadata>

import type { InvisibleConstraint } from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'

export type ConstraintBadgeTooltipContent = {
  title: string
  description: string
}

export const constraintBadgeTooltipContent = {
  Coincident: {
    title: 'Coincident',
    description: 'Constrain points or curves to be coincident.',
  },
  Horizontal: {
    title: 'Horizontal',
    description: 'Constrain a line or two points to be horizontal.',
  },
  Vertical: {
    title: 'Vertical',
    description: 'Constrain a line or two points to be vertical.',
  },
  LinesEqualLength: {
    title: 'Equal length',
    description: 'Constrain lines to have equal length.',
  },
  Midpoint: {
    title: 'Midpoint',
    description: 'Constrain a point to lie at the midpoint of a line or arc.',
  },
  EqualRadius: {
    title: 'Equal radius',
    description: 'Constrain arcs and circles to have equal radius.',
  },
  Parallel: {
    title: 'Parallel',
    description: 'Constrain lines to be parallel.',
  },
  Perpendicular: {
    title: 'Perpendicular',
    description: 'Constrain lines to be perpendicular.',
  },
  Tangent: {
    title: 'Tangent',
    description:
      'Constrain a line and arc-like curve, or two arc-like curves, to be tangent.',
  },
  Symmetric: {
    title: 'Symmetric',
    description:
      'Constrain two points, two arc-like segments, or two lines to be symmetric across a selected axis line.',
  },
} satisfies Record<InvisibleConstraint['type'], ConstraintBadgeTooltipContent>

export type ConstraintBadgeTooltipPoint = {
  x: number
  y: number
}

export type ConstraintBadgeTooltipBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

export function getConstraintBadgeTooltipPosition({
  pointer,
  tooltipSize,
  bounds,
  gap = 8,
  padding = 8,
}: {
  pointer: ConstraintBadgeTooltipPoint
  tooltipSize: { width: number; height: number }
  bounds: ConstraintBadgeTooltipBounds
  gap?: number
  padding?: number
}): ConstraintBadgeTooltipPoint {
  const minX = bounds.left + padding
  const minY = bounds.top + padding
  const maxX = Math.max(minX, bounds.right - padding - tooltipSize.width)
  const maxY = Math.max(minY, bounds.bottom - padding - tooltipSize.height)

  const preferredX = pointer.x + gap
  const preferredY = pointer.y + gap
  const flippedX = pointer.x - gap - tooltipSize.width
  const flippedY = pointer.y - gap - tooltipSize.height

  return {
    x: clamp(
      preferredX + tooltipSize.width <= bounds.right - padding
        ? preferredX
        : flippedX,
      minX,
      maxX
    ),
    y: clamp(
      preferredY + tooltipSize.height <= bounds.bottom - padding
        ? preferredY
        : flippedY,
      minY,
      maxY
    ),
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

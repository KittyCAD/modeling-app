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

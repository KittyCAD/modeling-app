/**
 * Utility functions for handling arc endpoint swapping logic.
 * These functions determine when and how to swap arc start/end points
 * when dragging an arc endpoint, particularly when crossing the 0/360° seam.
 */

/**
 * Determines if start and end points should be swapped when dragging an arc endpoint.
 * Swaps when the endpoint crosses past the other endpoint (causing the arc to
 * shrink to zero and then grow in the opposite direction).
 *
 * Only swaps when crossing the 0/360° boundary (e.g., 1° to 359°), not when
 * going from 179° to 181° (which is still in the same direction, just a longer arc).
 *
 * @param isSwapped - Whether start/end are currently swapped
 * @param center - Arc center point
 * @param start - Current start point (may be swapped)
 * @param end - Current end point (may be swapped)
 * @param previousEnd - Previous end point position (for detecting seam crossing)
 * @returns true if start/end should be swapped
 */
export function shouldSwapStartEnd({
  isSwapped,
  center,
  start,
  end,
  previousEnd,
}: {
  isSwapped: boolean
  center: [number, number]
  start: [number, number]
  end: [number, number]
  previousEnd?: [number, number]
}): boolean {
  if (!previousEnd) return false
  const τ = 2 * Math.PI
  const norm = (a: number) => ((a % τ) + τ) % τ
  const startPointAngle = norm(
    Math.atan2(start[1] - center[1], start[0] - center[0])
  )
  const prevEndPointAngle = norm(
    Math.atan2(previousEnd[1] - center[1], previousEnd[0] - center[0])
  )
  const endPointAngle = norm(Math.atan2(end[1] - center[1], end[0] - center[0]))

  // Calculate CCW arc-lengths from start to each endpoint
  const ΔPrevious = (prevEndPointAngle - startPointAngle + τ) % τ
  const ΔCurrent = (endPointAngle - startPointAngle + τ) % τ

  // Calculate the raw change angle
  let rawDiff = ΔCurrent - ΔPrevious

  // Check if we crossed the 0/360° seam: if |rawDiff| > π, we crossed
  const crossed = Math.abs(rawDiff) > Math.PI
  if (!crossed) {
    return false
  }

  // Normalize the difference to [-π, π] to get the shortest path direction
  while (rawDiff > Math.PI) rawDiff -= τ
  while (rawDiff < -Math.PI) rawDiff += τ

  // If rawDiff > 0, we moved CCW; if < 0, we moved CW
  // Since ezpz always goes CCW from start to end, if we're currently swapped (CW),
  // and we moved CCW, we should unswap. If we're not swapped (CCW) and we moved CW, we should swap.
  const movedCCW = rawDiff > 0
  // If we're swapped, we want CW direction. If movedCCW, we should unswap (return true to swap back)
  // If we're not swapped, we want CCW direction. If movedCW, we should swap (return true)
  return movedCCW === isSwapped
}

/**
 * Determines the swap state and final start/end points for an arc when editing an endpoint.
 * This function encapsulates the logic for:
 * 1. Determining initial swap state (on first edit, when previousEnd is undefined)
 * 2. Detecting seam crossing and updating swap state (on subsequent edits)
 * 3. Calculating the final start/end points based on swap state
 *
 * @param center - Arc center point
 * @param startPoint - Current start point (may be swapped)
 * @param newEndPoint - New end point position (normalized to radius)
 * @param previousEnd - Previous end point position (for seam crossing detection)
 * @param currentIsSwapped - Current swap state
 * @returns Object with new swap state and final start/end points
 */
export function calculateArcSwapState({
  center,
  startPoint,
  newEndPoint,
  previousEnd,
  currentIsSwapped,
}: {
  center: [number, number]
  startPoint: [number, number]
  newEndPoint: [number, number]
  previousEnd?: [number, number]
  currentIsSwapped: boolean
}): {
  isSwapped: boolean
  finalStart: [number, number]
  finalEnd: [number, number]
} {
  let isSwapped = currentIsSwapped

  // On the first edit (no previousEnd), determine initial direction based on angle
  if (previousEnd === undefined) {
    const startAngle = Math.atan2(
      startPoint[1] - center[1],
      startPoint[0] - center[0]
    )
    const endAngle = Math.atan2(
      newEndPoint[1] - center[1],
      newEndPoint[0] - center[0]
    )

    // Normalize angles to [0, 2π]
    let normalizedStartAngle = startAngle
    let normalizedEndAngle = endAngle
    while (normalizedStartAngle < 0) {
      normalizedStartAngle += 2 * Math.PI
    }
    while (normalizedEndAngle < 0) {
      normalizedEndAngle += 2 * Math.PI
    }

    // Calculate arc angle difference
    let arcAngle = normalizedEndAngle - normalizedStartAngle
    // If the angle is > π, go the other way (shorter path) - swap start/end
    if (arcAngle > Math.PI) {
      arcAngle = arcAngle - 2 * Math.PI
      isSwapped = true
    } else if (arcAngle < -Math.PI) {
      arcAngle = arcAngle + 2 * Math.PI
      isSwapped = false
    } else {
      // CCW is positive angle, so if negative we need to swap
      isSwapped = arcAngle < 0
    }
  } else {
    // Check if we should swap start/end when dragging past the opposite endpoint
    const shouldSwap = shouldSwapStartEnd({
      isSwapped,
      center,
      start: startPoint,
      end: newEndPoint,
      previousEnd: previousEnd,
    })
    if (shouldSwap) {
      isSwapped = !isSwapped
    }
  }

  // If swapped, swap start and end points for the arc
  let finalStart = startPoint
  let finalEnd: [number, number] = newEndPoint
  if (isSwapped) {
    finalStart = newEndPoint
    finalEnd = startPoint
  }

  return {
    isSwapped,
    finalStart,
    finalEnd,
  }
}

import type { Freedom, ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  packRgbToColor,
  SKETCH_SELECTION_COLOR,
  SKETCH_SELECTION_RGB,
} from '@src/lib/constants'

// TODO get this from theme or CSS?
const TEXT_COLOR = 0xffffff

// Brand blue for unconstrained segments - KCL_DEFAULT_COLOR is "#3c73ff" which is 0x3c73ff
const UNCONSTRAINED_COLOR = 0x3c73ff

// Conflict color - red
// A softer, more pinkish-red with a hint of orange. For example: "#ff5e5b" (~coral red)
const CONFLICT_COLOR = 0xff5e5b

/**
 * Derives segment freedom from point freedom.
 * A segment is considered fully constrained (Fixed) only if all its points are Fixed.
 * If any point is Conflict, the segment is Conflict.
 * If any point is Free, the segment is Free.
 */
export function deriveSegmentFreedom(
  segment: ApiObject,
  objects: Array<ApiObject>
): Freedom | null {
  if (segment.kind.type !== 'Segment') {
    return null
  }

  const getObjById = (id?: number) =>
    typeof id === 'number' ? (objects.find((o) => o?.id === id) ?? null) : null

  const segmentData = segment.kind.segment

  if (segmentData.type === 'Point') {
    // Points have freedom directly
    return segmentData.freedom ?? null
  }

  // For segments, we need to check all their points
  const pointFreedoms: Array<Freedom | null> = []

  if (segmentData.type === 'Line') {
    const startPoint = getObjById(segmentData.start)
    const endPoint = getObjById(segmentData.end)
    if (
      startPoint?.kind?.type === 'Segment' &&
      startPoint.kind.segment.type === 'Point'
    ) {
      pointFreedoms.push(startPoint.kind.segment.freedom ?? null)
    }
    if (
      endPoint?.kind?.type === 'Segment' &&
      endPoint.kind.segment.type === 'Point'
    ) {
      pointFreedoms.push(endPoint.kind.segment.freedom ?? null)
    }
  } else if (segmentData.type === 'Arc') {
    const startPoint = getObjById(segmentData.start)
    const endPoint = getObjById(segmentData.end)
    const centerPoint = getObjById(segmentData.center)
    if (
      startPoint?.kind?.type === 'Segment' &&
      startPoint.kind.segment.type === 'Point'
    ) {
      pointFreedoms.push(startPoint.kind.segment.freedom ?? null)
    }
    if (
      endPoint?.kind?.type === 'Segment' &&
      endPoint.kind.segment.type === 'Point'
    ) {
      pointFreedoms.push(endPoint.kind.segment.freedom ?? null)
    }
    if (
      centerPoint?.kind?.type === 'Segment' &&
      centerPoint.kind.segment.type === 'Point'
    ) {
      pointFreedoms.push(centerPoint.kind.segment.freedom ?? null)
    }
  } else if (segmentData.type === 'Circle') {
    // Circle has a start point (center) - need to check if there are other points
    // For now, just check the start point
    const startPoint = getObjById(segmentData.start)
    if (
      startPoint?.kind?.type === 'Segment' &&
      startPoint.kind.segment.type === 'Point'
    ) {
      pointFreedoms.push(startPoint.kind.segment.freedom ?? null)
    }
  }

  // Filter out nulls
  const validFreedoms = pointFreedoms.filter((f): f is Freedom => f !== null)

  if (validFreedoms.length === 0) {
    return null
  }

  // Merge freedoms: Conflict > Free > Fixed
  // A segment is Fixed only if ALL points are Fixed
  let hasConflict = false
  let hasFree = false
  let allFixed = true

  for (const freedom of validFreedoms) {
    if (freedom === 'Conflict') {
      hasConflict = true
      allFixed = false
    } else if (freedom === 'Free') {
      hasFree = true
      allFixed = false
    }
  }

  if (hasConflict) {
    return 'Conflict'
  }
  if (hasFree) {
    return 'Free'
  }
  if (allFixed) {
    return 'Fixed'
  }

  return null
}

/**
 * Color precedence system:
 * 1. Draft color (priority 1) - grey
 * 2. Hover color (priority 2) - lighter version of selection color
 * 3. Select color (priority 3) - SKETCH_SELECTION_COLOR
 * 4. Conflict color (priority 4) - CONFLICT_COLOR (red)
 * 5. Constrained color (priority 5) - TEXT_COLOR (white)
 * 6. Unconstrained color (priority 6) - UNCONSTRAINED_COLOR (brand blue)
 * 7. Default color (lowest priority) - UNCONSTRAINED_COLOR
 */
export function getSegmentColor({
  isDraft,
  isHovered,
  isSelected,
  freedom,
}: {
  isDraft?: boolean
  isHovered?: boolean
  isSelected?: boolean
  freedom?: Freedom | null
}): number {
  // Priority 1: Draft color
  if (isDraft) {
    return 0x888888 // Grey for draft
  }

  // Priority 2: Hover color
  if (isHovered) {
    // Lighter version of selection color (70% brightness)
    const hoverColor = packRgbToColor(
      SKETCH_SELECTION_RGB.map((val) => Math.round(val * 0.7))
    )
    return hoverColor
  }

  // Priority 3: Select color
  if (isSelected) {
    return SKETCH_SELECTION_COLOR
  }

  // Priority 4: Conflict color (red)
  if (freedom === 'Conflict') {
    return CONFLICT_COLOR
  }

  // Priority 5: Unconstrained color (blue)
  if (freedom === 'Free') {
    return UNCONSTRAINED_COLOR
  }

  // Priority 6: Constrained color (white) - Fixed or null (default to constrained)
  if (freedom === 'Fixed') {
    return TEXT_COLOR
  }

  // Default: unconstrained color (blue) for null/unknown
  return UNCONSTRAINED_COLOR
}

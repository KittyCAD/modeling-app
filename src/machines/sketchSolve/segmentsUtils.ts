import type { Freedom, ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  SKETCH_HIGHLIGHT_COLOR,
  SKETCH_SELECTION_COLOR,
} from '@src/lib/constants'
import { getResolvedTheme, Themes } from '@src/lib/theme'

export const DARK_CONSTRAINED_COLOR = 0x000000
export const LIGHT_CONSTRAINED_COLOR = 0xffffff

const CONSTRAINED_COLOR = {
  [Themes.Dark]: DARK_CONSTRAINED_COLOR,
  [Themes.Light]: LIGHT_CONSTRAINED_COLOR,
} as const

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
    if (isPointSegment(startPoint)) {
      pointFreedoms.push(startPoint.kind.segment.freedom ?? null)
    }
    if (isPointSegment(endPoint)) {
      pointFreedoms.push(endPoint.kind.segment.freedom ?? null)
    }
  } else if (segmentData.type === 'Arc') {
    const startPoint = getObjById(segmentData.start)
    const endPoint = getObjById(segmentData.end)
    const centerPoint = getObjById(segmentData.center)
    if (isPointSegment(startPoint)) {
      pointFreedoms.push(startPoint.kind.segment.freedom ?? null)
    }
    if (isPointSegment(endPoint)) {
      pointFreedoms.push(endPoint.kind.segment.freedom ?? null)
    }
    if (isPointSegment(centerPoint)) {
      pointFreedoms.push(centerPoint.kind.segment.freedom ?? null)
    }
  } else if (segmentData.type === 'Circle') {
    const startPoint = getObjById(segmentData.start)
    const centerPoint = getObjById(segmentData.center)
    if (isPointSegment(startPoint)) {
      pointFreedoms.push(startPoint.kind.segment.freedom ?? null)
    }
    if (isPointSegment(centerPoint)) {
      pointFreedoms.push(centerPoint.kind.segment.freedom ?? null)
    }
  } else if (segmentData.type === 'ControlPointSpline') {
    for (const controlId of segmentData.controls) {
      const point = getObjById(controlId)
      if (isPointSegment(point)) {
        pointFreedoms.push(point.kind.segment.freedom ?? null)
      }
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
 * 4. Conflict/solver-failure color (priority 4) - CONFLICT_COLOR (red)
 * 5. Constrained color (priority 5) - theme-aware for sketch scene contrast
 * 6. Unconstrained color (priority 6) - UNCONSTRAINED_COLOR (brand blue)
 * 7. Default color (lowest priority) - UNCONSTRAINED_COLOR
 */
export function getSegmentColor({
  isDraft = false,
  isHovered,
  isSelected,
  hasSolveErrors = false,
  freedom,
  theme,
}: {
  isDraft?: boolean
  isHovered?: boolean
  isSelected?: boolean
  hasSolveErrors?: boolean
  freedom?: Freedom | null
  theme: Themes
}): number {
  // Priority 1: Draft color
  if (isDraft) {
    return 0x888888 // Grey for draft
  }

  // Priority 2: Hover color
  if (isHovered) {
    return SKETCH_HIGHLIGHT_COLOR
  }

  // Priority 3: Select color
  if (isSelected) {
    return SKETCH_SELECTION_COLOR
  }

  // Priority 4: Conflict / solver failure color (red)
  if (hasSolveErrors || freedom === 'Conflict') {
    return CONFLICT_COLOR
  }

  // Priority 5: Unconstrained color (blue)
  if (freedom === 'Free') {
    return UNCONSTRAINED_COLOR
  }

  // Priority 6: Constrained color (theme-aware) - Fixed or null (default to constrained)
  if (freedom === 'Fixed') {
    return CONSTRAINED_COLOR[getResolvedTheme(theme)]
  }

  // Default: unconstrained color (blue) for null/unknown
  return UNCONSTRAINED_COLOR
}

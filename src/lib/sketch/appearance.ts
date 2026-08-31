import type { Freedom } from '@rust/kcl-lib/bindings/FrontendApi'

/**
 * What a sketch looks like, ported from the existing app.
 *
 * A near-verbatim port of `src/machines/sketchSolve/segmentsUtils.ts` and the
 * sketch constants it reads, kept recognisable on purpose so the two can be
 * diffed. Everything here is the *result* of tuning somebody did against real
 * geometry — which red reads as an error without shouting, how much bigger a
 * point has to get before a hover is obvious, how long a construction dash is
 * before it stops reading as a dash — and none of it is recoverable by taste.
 *
 * The one deliberate difference is representation: the original stores colours as
 * THREE.js integers and this stores the same values as CSS strings, because the
 * overlay is SVG. The numbers are the same numbers.
 */

/** Sketch geometry that is fully constrained, per theme. */
export const DARK_CONSTRAINED_COLOR = '#000000'
export const LIGHT_CONSTRAINED_COLOR = '#ffffff'

/** Brand blue, for geometry that is still free to move. */
export const UNCONSTRAINED_COLOR = '#3c73ff'

/**
 * Conflict.
 *
 * The original's note: "A softer, more pinkish-red with a hint of orange" —
 * a solver conflict is information, not an alarm.
 */
export const CONFLICT_COLOR = '#ff5e5b'

/** Geometry being drawn but not yet committed. */
export const DRAFT_COLOR = '#888888'

/** A spline's control polygon, when the spline owns the point. */
export const CONTROL_POLYGON_COLOR = '#8a8a8a'

/** Selection, and a hover at 70% of it. Both from the existing app. */
export const SKETCH_SELECTION_RGB = [255, 183, 39] as const
export const SKETCH_HIGHLIGHT_RGB = SKETCH_SELECTION_RGB.map((value) =>
  Math.round(value * 0.7)
)

const hex = (rgb: readonly number[]) =>
  `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`

export const SKETCH_SELECTION_COLOR = hex(SKETCH_SELECTION_RGB)
export const SKETCH_HIGHLIGHT_COLOR = hex(SKETCH_HIGHLIGHT_RGB)

/** Stroke width of a segment, in pixels. */
export const SEGMENT_WIDTH_PX = 1.6

/** Radius of a point, in pixels. */
export const POINT_SEGMENT_RADIUS = 3

/** Screen-space dash for construction geometry, in pixels. */
export const CONSTRUCTION_DASH_PX = 8
export const CONSTRUCTION_GAP_PX = 6

const HOVERED_POINT_SEGMENT_SCALE = 1.5
const SECONDARY_HOVERED_POINT_SEGMENT_SCALE = 2
const SECONDARY_HOVER_LINE_WIDTH_MULTIPLIER = 2.25

const CONSTRAINED_COLOR = {
  dark: DARK_CONSTRAINED_COLOR,
  light: LIGHT_CONSTRAINED_COLOR,
} as const

export type SketchTheme = keyof typeof CONSTRAINED_COLOR

/**
 * Colour precedence, in the original's own order:
 *
 * 1. Draft — grey
 * 2. Hover — a darker version of the selection colour
 * 3. Selected — the selection colour
 * 4. Conflict or solver failure — red
 * 5. Free — brand blue
 * 6. Fixed — theme-aware, for contrast against the sketch scene
 * 7. Unknown — brand blue
 *
 * The order is the interesting part and it is not obvious. A *selected* segment
 * in conflict shows as selected, not as an error: you are looking at it because
 * you selected it, and the error is still reported elsewhere. Getting this
 * backwards makes a selection appear not to have worked.
 */
export function getSegmentColor({
  isDraft = false,
  isHovered,
  hoverColor,
  isSelected,
  hasSolveErrors = false,
  freedom,
  theme,
}: {
  isDraft?: boolean
  isHovered?: boolean
  hoverColor?: string
  isSelected?: boolean
  hasSolveErrors?: boolean
  freedom?: Freedom | null
  theme: SketchTheme
}): string {
  if (isDraft) return DRAFT_COLOR
  if (isHovered) return hoverColor ?? SKETCH_HIGHLIGHT_COLOR
  if (isSelected) return SKETCH_SELECTION_COLOR
  if (hasSolveErrors || freedom === 'Conflict') return CONFLICT_COLOR
  if (freedom === 'Free') return UNCONSTRAINED_COLOR
  if (freedom === 'Fixed') return CONSTRAINED_COLOR[theme]

  // Unknown freedom is drawn as unconstrained: a point the solver has not
  // spoken about yet is not a point that has been pinned down.
  return UNCONSTRAINED_COLOR
}

/**
 * How much bigger a point gets when the pointer is near it.
 *
 * The secondary scale is for the point a *constraint* is hovering — bigger
 * again, so it reads as the reason rather than as another candidate.
 */
export function getPointSegmentScale({
  isHovered,
  isSecondaryHovered,
}: {
  isHovered?: boolean
  isSecondaryHovered?: boolean
}): number {
  if (!isHovered) return 1

  return isSecondaryHovered
    ? SECONDARY_HOVERED_POINT_SEGMENT_SCALE
    : HOVERED_POINT_SEGMENT_SCALE
}

/**
 * How wide a segment is drawn.
 *
 * Only a *secondary* hover thickens a line; an ordinary hover recolours it and
 * leaves the width alone, so a row of segments does not shift as the pointer
 * crosses them.
 *
 * The original multiplies by `devicePixelRatio` because a THREE `LineMaterial`
 * width is in device pixels. SVG works in CSS pixels, so it does not.
 */
export function getSegmentLineWidth({
  isHovered,
  isSecondaryHovered,
}: {
  isHovered?: boolean
  isSecondaryHovered?: boolean
}): number {
  return isHovered && isSecondaryHovered
    ? SEGMENT_WIDTH_PX * SECONDARY_HOVER_LINE_WIDTH_MULTIPLIER
    : SEGMENT_WIDTH_PX
}

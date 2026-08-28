import type { Expr, SegmentCtor } from '@rust/kcl-lib/bindings/FrontendApi'
import type { PlanePoint } from '@src/lib/scene/projection'
import type { SketchShape } from '@src/lib/sketch/drawing'

/**
 * What a sketch tool is, without any of the machinery around it.
 *
 * A reducer over one event — a point was placed — plus cancelling. That really
 * is the whole input vocabulary: every tool in the existing app's sketch solver
 * is a state machine whose only interesting transition is "the user clicked
 * somewhere", and the rest of its states exist to keep a machine happy rather
 * than to describe the tool.
 *
 * So there is no machine here, in the same way `createOperationRunner` replaced
 * `modelingMachine`: a tool is a value holding the points collected so far, and
 * placing one either collects it or completes a shape. Pure, and testable
 * without a scene.
 *
 * Points are in the sketch plane, in millimetres, which is what the projection
 * hands back.
 */

export type SketchToolId = 'line'

export interface SketchToolState {
  tool: SketchToolId
  /** Points collected so far, oldest first. Empty means nothing started. */
  points: readonly PlanePoint[]
}

/** Something for the frontend to do, once a tool has collected enough. */
export interface SketchToolAction {
  kind: 'segment'
  segment: SegmentCtor
}

export interface SketchToolStep {
  state: SketchToolState
  actions: readonly SketchToolAction[]
}

/**
 * A coordinate, spelled the way KCL writes one.
 *
 * Always millimetres, because that is what the plane hands back and writing it
 * down in the unit it was measured in is the only version that cannot be wrong.
 * A file written in inches therefore gains `line(end = [25.4mm, 0mm])`, which is
 * correct and reads oddly — worth revisiting once there is somewhere to ask what
 * the file prefers.
 */
const expr = (value: number): Expr => ({
  type: 'Number',
  // Rounded to a micron. The pointer's precision is a pixel and a plane
  // measured in floating point does not land on round numbers by itself, so
  // without this every segment is written with seventeen digits.
  value: Math.round(value * 1000) / 1000,
  units: 'Mm',
})

const coordinate = (point: PlanePoint) => ({
  x: expr(point.x),
  y: expr(point.y),
})

export const equipTool = (tool: SketchToolId): SketchToolState => ({
  tool,
  points: [],
})

/** Drop whatever was part way through, keeping the tool equipped. */
export const cancelTool = (state: SketchToolState): SketchToolState => ({
  tool: state.tool,
  points: [],
})

/**
 * Place a point, and see what the tool makes of it.
 *
 * A tool that completed something reports the action *and* resets, so the caller
 * never has to know how many points a shape takes. Chaining — where the end of
 * one segment starts the next — is deliberately absent: it changes what the
 * reset does, not what a click means, and it is worth adding once there is more
 * than one tool to be consistent across.
 */
export function placePoint(
  state: SketchToolState,
  at: PlanePoint
): SketchToolStep {
  const collected = [...state.points, at]

  switch (state.tool) {
    case 'line': {
      const [start, end] = collected
      if (!start || !end)
        return { state: { ...state, points: collected }, actions: [] }

      return {
        state: cancelTool(state),
        actions: [
          {
            kind: 'segment',
            segment: {
              type: 'Line',
              start: coordinate(start),
              end: coordinate(end),
            },
          },
        ],
      }
    }
  }
}

/**
 * What to draw while a tool is part way through.
 *
 * A shape rather than something a renderer has to special-case: the rubber band
 * from the first click to the pointer is a line, and drawing it with the same
 * code that draws real lines is what stops the preview looking like a different
 * kind of thing from the segment it becomes.
 *
 * Null when there is nothing yet, or when the pointer is not over the plane.
 */
export function previewOf(
  state: SketchToolState,
  at: PlanePoint | null
): SketchShape | null {
  if (!at) return null

  switch (state.tool) {
    case 'line': {
      const [start] = state.points
      return start
        ? {
            kind: 'line',
            // Not a real id: the preview is not in the graph, and anything that
            // matched it against one would be matching against a segment that
            // does not exist yet.
            id: -1,
            from: start,
            to: at,
            construction: false,
            freedom: 'Free',
          }
        : null
    }
  }
}

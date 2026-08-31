import type {
  ApiObjectId,
  Expr,
  SegmentCtor,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneGraph } from '@rust/kcl-lib/bindings/FrontendApi'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import { objectAt } from '@src/lib/sketch/sceneGraph'
import type { PlanePoint } from '@src/lib/scene/projection'
import type { SketchToolId } from '@src/lib/sketch/tools'

/**
 * Drawing as the existing app does it: the rubber band is a real segment.
 *
 * The idea is worth stating plainly because it changes everything downstream.
 * The first click does not remember a position — it *writes a zero-length
 * segment into the sketch* and keeps hold of its end point. Every pointer move
 * then asks the solver to move that end point, and what gets drawn is whatever
 * the solver says. So the line you are dragging out is already constrained,
 * already snapped, and already the thing you will get; there is no second
 * geometry model that can disagree with the solver about what you are doing.
 *
 * That is also what makes chaining possible. Committing a segment leaves its end
 * point behind, and the next segment is *chained* from it — which writes the
 * coincidence as a constraint, so a run of lines is a profile rather than a pile
 * of separate edges.
 *
 * This module is the state and the transitions, with no service in sight. It is
 * a port of `lineToolDiagram`'s seven states, written as a discriminated union
 * rather than as a machine: the states are real and worth naming, but the
 * transitions are a `switch`, and a machine library would add a vocabulary
 * without adding an answer.
 */

/** What the tool is in the middle of. */
export type DraftState =
  /** Nothing started. The next click begins a segment. */
  | { kind: 'idle' }
  /**
   * Clicks collected, with nothing in the sketch yet.
   *
   * For the shapes that cannot exist from one click. A circle of no radius is
   * not a circle the solver can hold an opinion about, so its centre is
   * remembered here and the segment is written on the second click — which is
   * what the existing app does too.
   *
   * The pointer is deliberately *not* stored. Whatever draws the preview already
   * follows the pointer for hovering, so keeping a copy here would be a second
   * source of truth updated on every pointer event.
   */
  | { kind: 'pending'; points: readonly PlanePoint[] }
  /**
   * Rubber-banding. `pointId` is the end being dragged.
   *
   * `segmentIds` is everything this draft created, so abandoning it can take all
   * of it away again.
   */
  | {
      kind: 'drawing'
      pointId: ApiObjectId
      segmentIds: readonly ApiObjectId[]
    }
  /**
   * A segment was committed and the chain may continue.
   *
   * Deliberately a state of its own with no draft in it. The next segment is not
   * created until the pointer moves, which means finishing a chain — a
   * double-click, or Escape — never has to delete anything. The existing app
   * arrived at the same arrangement and it is the reason its escape path is
   * simple.
   */
  | { kind: 'chaining'; fromPointId: ApiObjectId }
  /**
   * Something already in the sketch being moved.
   *
   * In the same union as the draft states rather than beside them, because they
   * are the same machinery pointed at different geometry — a preview solve per
   * move, a commit on release — and because they are mutually exclusive: you
   * cannot be rubber-banding a new line and dragging an old corner at once.
   *
   * `objectId` may be a point *or* a whole segment, which is the difference
   * between moving a corner and moving an edge.
   *
   * `from` is where the pointer was when the last solve was accepted, not where
   * the drag began. Translating a body needs a vector, and measuring it from the
   * last *good* position is what stops a refused solve from leaving the pointer
   * and the geometry offset for the rest of the drag.
   */
  | { kind: 'dragging'; objectId: ApiObjectId; from: PlanePoint }

/** What the tool wants the frontend to do. */
export type DraftAction =
  /**
   * Write a segment.
   *
   * `hold` is what happens next: `end` takes hold of the new segment's end point
   * so the pointer drags it open, and `none` is a shape that is finished the
   * moment it exists — a point, or a circle whose radius came from the click that
   * created it.
   */
  | {
      kind: 'begin'
      segment: SegmentCtor
      label: string
      hold: 'end' | 'none'
    }
  /** Move the draft's end point. `commit` false is a preview solve. */
  | { kind: 'move'; pointId: ApiObjectId; to: PlanePoint; commit: boolean }
  /**
   * Move existing geometry, which takes a plan rather than a position.
   *
   * Kept apart from `move` because the two are different requests: a draft's end
   * point is *put* somewhere, while a drag may translate a body, carry a cluster
   * of coincident points with it, and anchor a segment against the cursor. What
   * exactly it asks for depends on the graph, so it is worked out where the graph
   * is — see `planDrag`.
   */
  | {
      kind: 'drag'
      objectId: ApiObjectId
      from: PlanePoint
      to: PlanePoint
      commit: boolean
    }
  /** Start the next segment from a committed point. */
  | {
      kind: 'chain'
      fromPointId: ApiObjectId
      segment: SegmentCtor
      label: string
    }
  /** Throw a draft away. */
  | { kind: 'discard'; segmentIds: readonly ApiObjectId[] }

export interface DraftStep {
  state: DraftState
  actions: readonly DraftAction[]
}

/** The labels the existing app gives what it writes, kept identical. */
export const LINE_SEGMENT_LABEL = 'line-segment'
export const POINT_SEGMENT_LABEL = 'point'
export const CIRCLE_SEGMENT_LABEL = 'circle'

/**
 * Two decimal places, which is `roundOff`'s default in the existing app.
 *
 * The pointer's precision is a pixel, and a plane measured in floating point
 * does not land on round numbers by itself — so without this every segment is
 * written with seventeen digits of noise that somebody then has to read.
 */
export const roundOff = (value: number, precision = 2): number => {
  const scale = 10 ** precision
  return Math.round(value * scale) / scale
}

/**
 * A coordinate, spelled the way the existing app spells one.
 *
 * `Var` rather than `Number`, and this is not a detail: a `Var` becomes a
 * *variable* in the KCL, which is what lets the solver move the point
 * afterwards. Written as a literal it would be a value the solver is not
 * allowed to touch, and the first constraint applied to it would conflict.
 */
export const expr = (value: number, units: NumericSuffix): Expr => ({
  type: 'Var',
  value: roundOff(value),
  units,
})

const coordinate = (point: PlanePoint, units: NumericSuffix) => ({
  x: expr(point.x, units),
  y: expr(point.y, units),
})

/** A line with both ends in the same place, ready to be dragged open. */
export const zeroLengthLine = (
  at: PlanePoint,
  units: NumericSuffix
): SegmentCtor => ({
  type: 'Line',
  start: coordinate(at, units),
  end: coordinate(at, units),
})

/** A standalone point, which is a segment of its own in the graph. */
export const pointSegment = (
  at: PlanePoint,
  units: NumericSuffix
): SegmentCtor => ({
  type: 'Point',
  position: coordinate(at, units),
})

/**
 * A circle from its centre and a point on it.
 *
 * The rim point is what the graph stores rather than a radius, which is why the
 * second click is the shape rather than a number: the point stays in the sketch
 * and can be dragged, constrained and dimensioned afterwards.
 */
export const circleFrom = (
  center: PlanePoint,
  rim: PlanePoint,
  units: NumericSuffix
): SegmentCtor => ({
  type: 'Circle',
  center: coordinate(center, units),
  start: coordinate(rim, units),
})

/** Where a point should go, as an edit to an existing one. */
export const pointAt = (at: PlanePoint, units: NumericSuffix): SegmentCtor => ({
  type: 'Point',
  position: coordinate(at, units),
})

export interface DraftContext {
  /**
   * The equipped tool, or none.
   *
   * Nullable because dragging is not a tool. Moving a committed point happens
   * with the pointer alone — there is nothing to equip for it, and requiring a
   * tool is what used to stop a drag previewing at all.
   */
  tool: SketchToolId | null
  units: NumericSuffix
}

/**
 * A click.
 *
 * Three cases, which are the three states: nothing started begins a segment;
 * rubber-banding commits it and offers to chain; and a click while chaining
 * cannot happen, because the chain's next segment is created by the *move* that
 * precedes the click.
 */
export function place(
  state: DraftState,
  at: PlanePoint,
  context: DraftContext
): DraftStep {
  switch (state.kind) {
    case 'idle':
      return first(at, context)

    case 'pending': {
      const [start] = state.points
      // A tool that collects clicks but has no second step is a bug in the
      // table below rather than something to guess about.
      if (!start || context.tool !== 'circle') {
        return { state: { kind: 'idle' }, actions: [] }
      }

      return {
        state: { kind: 'idle' },
        actions: [
          {
            kind: 'begin',
            segment: circleFrom(start, at, context.units),
            label: CIRCLE_SEGMENT_LABEL,
            hold: 'none',
          },
        ],
      }
    }

    case 'drawing':
      return {
        state: { kind: 'chaining', fromPointId: state.pointId },
        actions: [
          { kind: 'move', pointId: state.pointId, to: at, commit: true },
        ],
      }

    case 'chaining':
      // Nothing to commit: the pointer has not moved since the last click, so
      // no segment exists to be finished.
      return { state, actions: [] }

    case 'dragging':
      // A drag ends on release, not on a click.
      return { state, actions: [] }
  }
}

/**
 * The first click of a shape.
 *
 * Where the tools differ most, so it is one place rather than a branch inside
 * every transition. Three answers: write a finished shape, write something to
 * drag open, or remember the click because one click is not yet a shape.
 */
function first(at: PlanePoint, context: DraftContext): DraftStep {
  switch (context.tool) {
    case 'line':
      return {
        // The point id is not known until the frontend answers, so the state
        // stays idle here and the caller settles it with `begun`.
        state: { kind: 'idle' },
        actions: [
          {
            kind: 'begin',
            segment: zeroLengthLine(at, context.units),
            label: LINE_SEGMENT_LABEL,
            hold: 'end',
          },
        ],
      }

    case 'point':
      // Finished the moment it exists. There is nothing to drag open and nothing
      // to chain from, so the tool stays equipped and the next click is another
      // point.
      return {
        state: { kind: 'idle' },
        actions: [
          {
            kind: 'begin',
            segment: pointSegment(at, context.units),
            label: POINT_SEGMENT_LABEL,
            hold: 'none',
          },
        ],
      }

    case 'circle':
      /*
       * Remembered rather than written.
       *
       * A circle of no radius is degenerate — there is no rim point for the
       * solver to hold an opinion about — so nothing goes into the sketch until
       * the second click says how big it is. The preview in between is drawn
       * from this state and the pointer, and is the one thing on screen that is
       * not solver truth; there is no solver truth to be had yet.
       */
      return { state: { kind: 'pending', points: [at] }, actions: [] }

    case null:
      return { state: { kind: 'idle' }, actions: [] }
  }
}

/**
 * A pointer move.
 *
 * Drags the draft when there is one, and *creates* one when a chain is waiting —
 * which is the lazy step that keeps the escape path free of deletions.
 */
export function moveTo(
  state: DraftState,
  at: PlanePoint,
  context: DraftContext
): DraftStep {
  switch (state.kind) {
    case 'idle':
      return { state, actions: [] }

    case 'pending':
      // The preview is drawn from the collected clicks and the pointer, so a
      // move asks the frontend for nothing at all.
      return { state, actions: [] }

    case 'drawing':
      return {
        state,
        actions: [
          // A preview: solved, drawn, and thrown away on the next move. Settling
          // the guesses here would leave a trail of committed positions from
          // wherever the pointer happened to pass.
          { kind: 'move', pointId: state.pointId, to: at, commit: false },
        ],
      }

    case 'chaining': {
      // The only state whose next step is to *create* something, so the only
      // one that needs to know what tool is drawing. Only a line chains.
      if (context.tool !== 'line') return { state, actions: [] }

      return {
        state,
        actions: [
          {
            kind: 'chain',
            fromPointId: state.fromPointId,
            segment: zeroLengthLine(at, context.units),
            label: LINE_SEGMENT_LABEL,
          },
        ],
      }
    }

    case 'dragging':
      return {
        state,
        actions: [
          {
            kind: 'drag',
            objectId: state.objectId,
            from: state.from,
            to: at,
            commit: false,
          },
        ],
      }
  }
}

/**
 * Take hold of something that is already in the sketch.
 *
 * The position matters: a body is moved by a vector, so where the grab happened
 * is what the first move is measured from.
 */
export const beginDrag = (
  objectId: ApiObjectId,
  at: PlanePoint
): DraftState => ({
  kind: 'dragging',
  objectId,
  from: at,
})

/**
 * Where the drag is measured from, once a solve has been accepted.
 *
 * Only called for a solve that worked. A refused one deliberately leaves this
 * behind, so the next move asks for the whole remaining distance rather than for
 * one frame of it.
 */
export const advanceDrag = (state: DraftState, to: PlanePoint): DraftState =>
  state.kind === 'dragging' ? { ...state, from: to } : state

/**
 * Let go, committing where it ended up.
 *
 * The position comes from the caller rather than being remembered, because the
 * release is the authority on where the point went: the last preview may have
 * been superseded, and a pointer can move between the last move event and the
 * release.
 */
export function endDrag(state: DraftState, at: PlanePoint): DraftStep {
  if (state.kind !== 'dragging') return { state, actions: [] }

  return {
    state: { kind: 'idle' },
    actions: [
      {
        kind: 'drag',
        objectId: state.objectId,
        from: state.from,
        to: at,
        commit: true,
      },
    ],
  }
}

/**
 * Escape, or putting the tool down.
 *
 * A draft in progress is thrown away; a chain waiting to continue simply stops,
 * because there is nothing in the file that should not be there.
 */
export function abandon(state: DraftState): DraftStep {
  // A drag has nothing to throw away: the point it moved was already in the
  // sketch, and where it is now is where the last preview left it.
  if (state.kind === 'dragging') return { state: { kind: 'idle' }, actions: [] }

  if (state.kind === 'drawing') {
    return {
      state: { kind: 'idle' },
      actions: [{ kind: 'discard', segmentIds: state.segmentIds }],
    }
  }

  // Nothing was written, so there is nothing to take away: collected clicks
  // live here and nowhere else.
  if (state.kind === 'pending') return { state: { kind: 'idle' }, actions: [] }

  return { state: { kind: 'idle' }, actions: [] }
}

/** Whether Escape has something of its own to undo before it leaves the tool. */
export const isMidDraft = (state: DraftState) => state.kind !== 'idle'

/**
 * The segment ids a draft owns, for drawing them as a draft.
 *
 * Empty while chaining: at that moment everything in the sketch is committed,
 * and colouring the last segment grey would say it was still provisional.
 */
export const draftSegmentIds = (state: DraftState): readonly ApiObjectId[] =>
  state.kind === 'drawing' ? state.segmentIds : []

/**
 * What a `begin` or `chain` call actually created.
 *
 * The frontend answers with a list of new object ids and a graph; which of them
 * is the end to drag is not stated, so it is read back: find the line among them
 * and take its `end`. The existing app takes the last point in the list instead,
 * which is the same answer by construction and stops being the same answer the
 * moment a call creates two.
 *
 * Null when no line came back, which means the call did something other than
 * what was asked and the caller must not start dragging a point that may not
 * exist.
 */
export function begun(
  graph: SceneGraph,
  newObjects: readonly ApiObjectId[]
): { pointId: ApiObjectId; segmentIds: readonly ApiObjectId[] } | null {
  const segmentIds = newObjects.filter((id) => {
    const object = objectAt(graph, id)
    return object?.kind.type === 'Segment'
  })

  for (const id of [...newObjects].reverse()) {
    const object = objectAt(graph, id)
    if (object?.kind.type !== 'Segment') continue
    if (object.kind.segment.type !== 'Line') continue

    return { pointId: object.kind.segment.end, segmentIds }
  }

  return null
}

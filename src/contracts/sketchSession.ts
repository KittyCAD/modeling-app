import { defineContract, defineService } from '@kittycad/registry'
import type { ApiObjectId } from '@rust/kcl-lib/bindings/FrontendApi'
import type { ReadonlySignal } from '@preact/signals'
import type { PlaneFrame, PlanePoint } from '@src/lib/scene/projection'
import type { ConstraintToolId } from '@src/lib/sketch/constraints'
import type { DraftState } from '@src/lib/sketch/draft'
import type { SketchToolId } from '@src/lib/sketch/tools'

/** A sketch open for editing. */
export interface OpenSketch {
  /** The frontend's id for it, which every mutation is addressed to. */
  sketchId: ApiObjectId
  /** What the file calls it, for saying which sketch is open. */
  name: string
  /**
   * Where the sketch is in the world, so it can be drawn over the scene.
   *
   * Null when nothing could place it — a sketch on geometry the last run did not
   * describe. The session still opens, because editing the KCL is worth doing
   * without an overlay and refusing to open would be a worse answer than a blank
   * one; `planeProblem` says why it is blank.
   *
   * Fixed for the life of the session: a plane does not move while you draw on
   * it, and re-deriving it per frame would be work with one possible answer.
   */
  plane: PlaneFrame | null
  /** Why there is no plane, when there is none. */
  planeProblem: string | null
}

/**
 * Something selected inside a sketch.
 *
 * Its own id space, and the reason is the origin: it is a real thing to select —
 * constraints name it, `ConstraintSegment` has a literal for it — and it is the
 * one such thing that is *not* an object in the graph. Modelling it as an object
 * id would mean inventing an id for it, and then keeping the invention out of
 * every lookup.
 */
export type SketchSelectionId = ApiObjectId | 'origin'

/**
 * Editing one sketch, from opening it to writing it back.
 *
 * Deliberately not the same thing as the Sketch *toolbar mode*, and the
 * difference is the whole design. The mode is derived, free and reversible: a
 * selection inside a sketch offers it. A session is none of those — it has to be
 * opened, it can only be opened when a real execution has produced the object ids
 * a sketch is solved against, and leaving it costs a full re-execution to get the
 * geometry rendered. So it is opened deliberately and left deliberately, and
 * nothing about it happens because a selection changed.
 *
 * While one is open the session is the only thing writing the file. Every
 * mutation answers with the whole text, so a second writer would have its work
 * overwritten by the next segment drawn.
 */
export interface SketchSessionService {
  /** The sketch being edited, or null. */
  readonly open: ReadonlySignal<OpenSketch | null>
  /** True while entering or leaving, both of which are round trips. */
  readonly busy: ReadonlySignal<boolean>
  /** Why the last attempt did not work, in words a user can act on. */
  readonly error: ReadonlySignal<string | null>
  /** Put the last failure away. It is a report, not a state to be stuck in. */
  dismissError(): void
  /** Whether a session could be opened right now. */
  readonly canEnter: ReadonlySignal<boolean>

  /**
   * The tool the next click goes to.
   *
   * Null means clicking selects rather than draws, which is the state a session
   * starts and returns to. Held here rather than in the toolbar because it is
   * part of what the session *is*: leaving takes the tool with it.
   */
  readonly tool: ReadonlySignal<SketchToolId | null>
  /**
   * What the tool is in the middle of drawing.
   *
   * A *real* segment, not a remembered position: the first click writes a
   * zero-length line into the sketch and every pointer move asks the solver to
   * move its end. So what is being dragged out is already constrained, already
   * snapped, and already the thing you will get.
   *
   * Exposed so a drawing can colour the draft as provisional — it is in the
   * graph like everything else, and nothing but this says it is not finished.
   */
  readonly draft: ReadonlySignal<DraftState>

  /**
   * What is selected, in the order it was picked.
   *
   * Order matters and is not decoration: a constraint's meaning depends on it —
   * a midpoint takes a point *and* a line and would be a different request the
   * other way round — so this is a list rather than a set.
   *
   * Dropped whenever a solve renumbers the graph, because an id that survives a
   * renumbering names whatever now sits in that slot.
   */
  readonly selection: ReadonlySignal<readonly SketchSelectionId[]>

  /**
   * Open the sketch the cursor or selection is in.
   *
   * No argument, because "which sketch" is already answered by where the user is
   * — the same answer the toolbar mode uses.
   */
  enter(): Promise<void>
  /** Write the sketch back and leave, which runs the program. */
  exit(): Promise<void>

  /** Pick up a tool, or put one down. */
  equip(tool: SketchToolId | null): void
  /**
   * Place a point, in the sketch plane's own millimetres.
   *
   * Everything about *where the pointer was* has already happened by the time
   * this is called: the session never learns about pixels, elements or cameras,
   * which is what lets a different renderer drive the same tools.
   */
  place(at: PlanePoint): void
  /**
   * The pointer moved, in the plane's own millimetres.
   *
   * Drives the rubber band, which is a solve rather than a drawn line — so this
   * is a request the frontend answers, and the session keeps only the most
   * recent one while an answer is outstanding.
   */
  moveTo(at: PlanePoint): void
  /** Stop a chain of segments without leaving the tool. */
  finishChain(): void
  /**
   * Take hold of something that is already in the sketch.
   *
   * The same machinery the rubber band uses, pointed at existing geometry: a
   * preview solve per move, and a commit on release. So dragging is constrained
   * as it moves rather than snapping into place when let go.
   *
   * A point *or* a whole segment, which are two different requests: a point is
   * put where the pointer is, while a segment is translated and held against the
   * cursor by the solver. `at` is where the grab happened, which is what the
   * translation is measured from.
   */
  beginDrag(objectId: ApiObjectId, at: PlanePoint): void
  /** Let go, committing where it ended up. */
  endDrag(at: PlanePoint): void
  /** Abandon what the tool was part way through, keeping it equipped. */
  cancelTool(): void

  /**
   * Select something, or add it to what is selected.
   *
   * `add` is the shift-click reading: extend rather than replace, and toggle
   * something already in the list, which is how a selection is corrected without
   * starting again.
   */
  select(id: SketchSelectionId, options?: { add?: boolean }): void
  /** Select nothing. */
  clearSelection(): void
  /**
   * Apply a constraint to what is selected.
   *
   * The tool decides what the selection means — a point and a line make a
   * different midpoint request in each order — and refuses rather than guesses
   * when the selection does not make one. Whether it *can* be applied is a pure
   * question anybody can ask, which is what lets the button be disabled instead
   * of the click failing.
   */
  applyConstraint(tool: ConstraintToolId): void

  /**
   * Dimension what is selected.
   *
   * Exactly two things, and what they are decides what the dimension is: two
   * points give their separation, a point and a line the distance between them,
   * two parallel lines their separation, and two lines that cross the angle
   * between them. The value is measured off the geometry as it is now, because
   * that is what applying a dimension means — *this* distance, from here on.
   */
  applyDimension(): void
  /**
   * Change what a dimension says.
   *
   * An expression rather than a number, because that is what goes into the file:
   * `2 * width` is as valid as `40`, and being able to type the second and later
   * edit it into the first is how a sketch becomes parametric.
   */
  setDimension(constraintId: ApiObjectId, expression: string): void

  /**
   * Delete what is selected.
   *
   * Segments and constraints both, because both are selectable and both are
   * things a user means to remove — taking a constraint off is as ordinary an
   * edit as taking a line out.
   */
  deleteSelection(): void
}

export const sketchSessionContract = defineContract({
  sketchSessionService: defineService<SketchSessionService>('sketch.session'),
})

export const { sketchSessionService } = sketchSessionContract

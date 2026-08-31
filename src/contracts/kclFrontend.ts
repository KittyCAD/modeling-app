import { defineContract, defineService } from '@kittycad/registry'
import type {
  ApiObjectId,
  ExistingSegmentCtor,
  SceneGraph,
  SegmentCtor,
  SegmentDragAnchor,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { ReadonlySignal } from '@preact/signals'

/**
 * What a sketch mutation answers with.
 *
 * The whole new file and the whole new scene, despite `SourceDelta`'s name. Both
 * are snapshots: the caller replaces what it had rather than patching it, and
 * recovers a minimal buffer edit with `textDiff` on the way past.
 */
export interface SketchOutcome {
  /** The entire file, as the frontend would now write it. */
  text: string
  graph: SceneGraph
  /** Ids minted by this call, for selecting what was just drawn. */
  newObjects: readonly ApiObjectId[]
  /**
   * True when every id in the previous graph is meaningless.
   *
   * Anything holding one — a selection, a hover, a tool part way through — has to
   * drop it rather than look it up and find whatever now sits in that slot.
   */
  invalidatesIds: boolean
  /** For sketch-local undo, which is a checkpoint restore rather than a text undo. */
  checkpointId: number | null
  /**
   * Why the solve did not work, or null when it did.
   *
   * A mutation that could not satisfy the constraints *resolves* — it reports
   * the failure in its execution outcome rather than rejecting — so a caller
   * that only catches rejections believes a refused edit succeeded. Reading it
   * here means every caller gets the verdict without having to know where in the
   * outcome it is written.
   */
  problem: string | null
}

/**
 * What building a scene from a program did.
 *
 * Three outcomes, because kcl-lib has three: it built one, it ran the program
 * and the program was wrong, or there was nothing to run it with.
 */
export type SetProgramResult =
  | { kind: 'built'; graph: SceneGraph }
  /** The program ran and failed. `reason` is the KCL error's own words. */
  | { kind: 'failed'; reason: string }
  /** No WASM context yet, so nothing has run and nothing can. */
  | { kind: 'unavailable' }

/**
 * KCL's sketch frontend, as a service.
 *
 * kcl-lib holds its own copy of the project and solves sketches against it
 * *without touching the engine* — that is what makes editing a sketch cheap, and
 * why leaving one costs a real execution to get the geometry rendered.
 *
 * Everything that calls the frontend calls it through here. That is the seam: if
 * the executor later moves onto the same API, the producer of `sceneGraph`
 * changes and no consumer does.
 */
export interface KclFrontendService {
  /** The latest scene the frontend produced. Null before anything has run. */
  readonly sceneGraph: ReadonlySignal<SceneGraph | null>
  /** Whether the frontend has a project open and can answer. */
  readonly ready: ReadonlySignal<boolean>

  /**
   * Mirror a file's text into the frontend's own copy.
   *
   * Cheap and idempotent: the frontend needs the same bytes the buffer has before
   * it can be asked about a sketch in them.
   */
  sync(path: string, text: string): Promise<void>

  /**
   * Build a scene from a program, so there is something to name a sketch with.
   *
   * The one call here that reaches the engine, and the reason opening a sketch
   * costs a run: a sketch is solved against object ids only a real execution
   * produces.
   *
   * Answers with *why* rather than with null, because "the program has not been
   * run" and "the program ran and failed on line 12" are different problems with
   * different remedies, and kcl-lib reports the second as an ordinary outcome
   * rather than as a rejection. Collapsing them told everybody to run a file
   * they had just run.
   */
  setProgram(programAst: unknown): Promise<SetProgramResult>

  /** Open a sketch for editing. The graph reports it as the active one. */
  editSketch(sketchId: ApiObjectId): Promise<SketchOutcome>
  /**
   * Close it.
   *
   * Answers with the scene and *no text*, which is the one place the frontend's
   * naming misleads: every segment was already written into the file when it was
   * drawn, so leaving changes the model rather than the source. Whoever leaves
   * still has to get the file executed — until then the engine has never seen
   * any of it.
   */
  exitSketch(sketchId: ApiObjectId): Promise<SceneGraph | null>
  addSegment(
    sketchId: ApiObjectId,
    segment: SegmentCtor,
    options?: { label?: string; checkpoint?: boolean }
  ): Promise<SketchOutcome>

  /**
   * Move existing geometry, and solve.
   *
   * The call that makes a rubber band real. Dragging a draft point through this
   * on every pointer move means the line you are dragging out is the line the
   * solver produced — snapped, constrained and possibly refused — rather than a
   * straight line drawn between two positions that the solver may disagree with
   * the moment you let go.
   *
   * `commit` is the difference between a preview and an edit. A preview solves
   * and hands back the result without settling the initial guesses, so it can be
   * thrown away; a commit keeps them. kcl-lib refuses a checkpoint on a preview,
   * which is the same statement from the other side.
   */
  editSegments(
    sketchId: ApiObjectId,
    segments: readonly ExistingSegmentCtor[],
    options?: {
      checkpoint?: boolean
      commit?: boolean
      /**
       * Cursor points a segment body must pass through while solving.
       *
       * kcl-lib's own mechanism, and the thing that makes dragging an *edge*
       * work: translating a constrained segment's points is a request the
       * constraints may refuse outright, while an anchor asks the solver to slide
       * the segment along whatever freedom it has left so that it still passes
       * through the cursor.
       */
      anchors?: readonly SegmentDragAnchor[]
      /**
       * Segments to hold rigid for the duration of the solve.
       *
       * Temporary fixed constraints on everything else being edited, so pulling
       * one part of a selection does not reshape the rest. Absent means kcl-lib's
       * default, which is to anchor every edited segment.
       */
      anchorSegmentIds?: readonly ApiObjectId[]
    }
  ): Promise<SketchOutcome>

  /**
   * Add a segment starting where another ended, joined to it.
   *
   * Not the same as adding a segment that happens to start at the same place:
   * this writes the coincidence as a constraint, which is what makes a chain of
   * lines a profile rather than a pile of separate edges.
   */
  chainSegment(
    sketchId: ApiObjectId,
    previousEndPointId: ApiObjectId,
    segment: SegmentCtor,
    options?: { label?: string; checkpoint?: boolean }
  ): Promise<SketchOutcome>

  /** Remove geometry — an abandoned draft, most often. */
  deleteObjects(
    sketchId: ApiObjectId,
    objects: {
      constraintIds?: readonly ApiObjectId[]
      segmentIds?: readonly ApiObjectId[]
    }
  ): Promise<SketchOutcome>
}

export const kclFrontendContract = defineContract({
  kclFrontendService: defineService<KclFrontendService>('kcl.frontend'),
})

export const { kclFrontendService } = kclFrontendContract

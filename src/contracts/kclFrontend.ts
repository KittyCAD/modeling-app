import { defineContract, defineService } from '@kittycad/registry'
import type {
  ApiObjectId,
  SceneGraph,
  SegmentCtor,
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
}

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

  /** Open a sketch for editing. The graph reports it as the active one. */
  editSketch(sketchId: ApiObjectId): Promise<SketchOutcome>
  /** Close it, answering with the text to write back. */
  exitSketch(sketchId: ApiObjectId): Promise<SketchOutcome>
  addSegment(
    sketchId: ApiObjectId,
    segment: SegmentCtor,
    options?: { label?: string; checkpoint?: boolean }
  ): Promise<SketchOutcome>
}

export const kclFrontendContract = defineContract({
  kclFrontendService: defineService<KclFrontendService>('kcl.frontend'),
})

export const { kclFrontendService } = kclFrontendContract

import { defineContract, defineService } from '@kittycad/registry'
import type { ApiObjectId } from '@rust/kcl-lib/bindings/FrontendApi'
import type { ReadonlySignal } from '@preact/signals'

/** A sketch open for editing. */
export interface OpenSketch {
  /** The frontend's id for it, which every mutation is addressed to. */
  sketchId: ApiObjectId
  /** What the file calls it, for saying which sketch is open. */
  name: string
}

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
  /** Whether a session could be opened right now. */
  readonly canEnter: ReadonlySignal<boolean>

  /**
   * Open the sketch the cursor or selection is in.
   *
   * No argument, because "which sketch" is already answered by where the user is
   * — the same answer the toolbar mode uses.
   */
  enter(): Promise<void>
  /** Write the sketch back and leave, which runs the program. */
  exit(): Promise<void>
}

export const sketchSessionContract = defineContract({
  sketchSessionService: defineService<SketchSessionService>('sketch.session'),
})

export const { sketchSessionService } = sketchSessionContract

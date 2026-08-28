import { defineContract, defineService } from '@kittycad/registry'
import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import type { ReadonlySignal } from '@preact/signals'
import type { ScenePoint } from '@src/contracts/scene'

/**
 * One thing the user has selected.
 *
 * The entity id is the engine's; the kind and the source range come from the
 * artifact graph and are null when the graph cannot name it — a click on
 * geometry from a run that has since failed, or on something with no code behind
 * it at all. That is a normal state, not an error: the engine is still
 * highlighting it and the user can still see what they picked.
 */
export interface SelectedEntity {
  entityId: string
  kind: Artifact['type'] | null
  sourceRange: SourceRange | null
}

/** Whether a new pick replaces the selection, joins it, or leaves it. */
export type SelectionMode = 'replace' | 'add' | 'remove'

/**
 * Whatever can say what is under a point.
 *
 * The same seam as `cameraDriverService`, for the same reason: *that* a click
 * selects is true of any renderer, and *how you find out what was clicked* is
 * not. The streamed engine is asked over a websocket and answers with a uuid; a
 * renderer in this process would pick against its own scene and answer
 * immediately.
 *
 * Optional, and absent until something is rendering. A viewport you cannot pick
 * in is not broken; it is a viewport with nothing in it.
 */
export interface ScenePicker {
  /** `engine`, for diagnostics. */
  readonly id: string
  readonly ready: ReadonlySignal<boolean>
  /** The entity under a point, or null for empty space. */
  pick(at: ScenePoint): Promise<string | null>
}

/**
 * What is selected.
 *
 * Renderer-independent by construction: it holds entity ids and what the
 * artifact graph says about them, and never learns how a pick was made. That is
 * what lets a click, a cursor position, and a modelling operation's argument all
 * talk about the same selection.
 */
export interface SelectionService {
  readonly entities: ReadonlySignal<readonly SelectedEntity[]>
  /** True while a pick is in flight, so a click can show it is working. */
  readonly picking: ReadonlySignal<boolean>
  /** Select by entity id, resolving what the graph knows about each. */
  select(entityIds: readonly string[], mode?: SelectionMode): void
  /** Ask what is at a point and select it. Empty space clears. */
  selectAt(at: ScenePoint, mode?: SelectionMode): Promise<void>
  clear(): void
}

export const selectionContract = defineContract({
  selectionService: defineService<SelectionService>('selection.service'),
  scenePickerService: defineService<ScenePicker>('selection.scenePicker'),
})

export const { selectionService, scenePickerService } = selectionContract

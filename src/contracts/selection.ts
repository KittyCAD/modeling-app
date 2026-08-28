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
  /**
   * How to write this as a `region`, when it has no artifact.
   *
   * A region is the V2 way to name an area to extrude, and it has none: it does
   * not exist until it is written into the file. What the engine can say about
   * the area under the cursor is which two curves border it and how they meet,
   * which is what `region` takes — so a selection can be a *pending* region,
   * carrying what it would take to write it.
   */
  region: PickedRegion | null
  /**
   * The curve the engine says made this face, when the file could not say.
   *
   * Asked at selection time and only when needed, because it is a round trip and
   * usually restates what the graph already holds: kcl-lib builds a wall's
   * segment from this very curve. Kept on the selection rather than fetched later
   * so that turning a selection into KCL stays synchronous — the click is where
   * the engine is available and the waiting is already happening.
   */
  originCurve?: string | null
  /**
   * The engine's index for this face, when nothing else could name it.
   *
   * Verified rather than guessed: the engine was asked which uuid each index
   * means, and this is the one that answered with the face under the pointer. So
   * a reference written from it refers to the right face *now* — the index is
   * only as stable as the model, which is why it is the last resort.
   */
  faceIndex?: number | null
}

/** What the engine knows about an area that is not in the file yet. */
export interface PickedRegion {
  /** Engine ids of the two bordering curves, walking curve first. */
  segmentIds: readonly string[]
  intersectionIndex: number
  intersectionCount: number
  clockwise: boolean
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
/**
 * One face of a swept solid, as the engine sees it.
 *
 * `curve` is the curve the face was swept from — the engine's own answer to the
 * question the artifact graph loses when a region is involved. `cap` says whether
 * the face is an end rather than a side, in the engine's vocabulary rather than
 * ours.
 */
export interface SweptFace {
  face: string
  curve: string | null
  /** `none` for a side face; the ends say which end. */
  cap: 'none' | 'top' | 'bottom' | 'both'
}

export interface ScenePicker {
  /** `engine`, for diagnostics. */
  readonly id: string
  readonly ready: ReadonlySignal<boolean>
  /** The entity under a point, or null for empty space. */
  pick(at: ScenePoint): Promise<string | null>
  /**
   * How to write this entity as a region, if it is one.
   *
   * Asked only when the artifact graph cannot name the entity, because that is
   * the situation a region is in — it has no artifact. Null for anything that is
   * not a region, which includes every entity the graph *could* name.
   */
  describeRegion(entityId: string): Promise<PickedRegion | null>
  /**
   * Which curve made each face of a swept solid.
   *
   * `solid3d_get_extrusion_face_info` in engine terms, and the same command
   * kcl-lib uses to *build* wall artifacts — it sets a wall's segment to the
   * curve reported here. So for a graph built from a successful run the two
   * agree, and this earns its round trip only where they do not: a run that
   * failed after sweeping, a solid the graph never described, or an engine that
   * knows an origin the graph flattened.
   *
   * Empty rather than throwing for a solid that was not swept. Asking is how you
   * find out, and "no faces" is an answer.
   */
  sweptFaces(solidId: string): Promise<readonly SweptFace[]>
  /**
   * The uuid of a solid's *n*th face.
   *
   * `solid3d_get_face_uuid`, which is the command KCL's own `faceId(body, index
   * = n)` sends. Asking it is how a face index can be *verified* rather than
   * guessed: the engine says which uuid an index means, so a reference written
   * from it refers to the face that was actually clicked.
   *
   * Null for an index the solid does not have, which is also how you find out
   * how many it has.
   */
  faceUuid(solidId: string, index: number): Promise<string | null>
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
  /**
   * Ask what is at a point and select it. Empty space clears.
   *
   * Answers with the entity it selected, or null for a click on nothing — which
   * the caller needs, because a click on nothing is a *statement* rather than a
   * failed selection, and only the click knows what to do about it.
   */
  selectAt(at: ScenePoint, mode?: SelectionMode): Promise<string | null>
  clear(): void
}

export const selectionContract = defineContract({
  selectionService: defineService<SelectionService>('selection.service'),
  scenePickerService: defineService<ScenePicker>('selection.scenePicker'),
})

export const { selectionService, scenePickerService } = selectionContract

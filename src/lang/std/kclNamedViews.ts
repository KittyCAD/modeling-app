import type { ArtifactVisibility } from '@rust/kcl-lib/bindings/Artifact'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'

import { filterArtifacts } from '@src/lang/std/artifactGraph'
import type {
  Artifact,
  ArtifactGraph,
  ArtifactId,
  ExecState,
  KclNamedViewArtifact,
} from '@src/lang/wasm'

/**
 * The name of the view a successful execution leaves behind.
 *
 * `RESERVED_DEFAULT_VIEW_NAME` in `rust/kcl-lib/src/execution/named_views.rs`
 * declares the same string. Changing one alone fails a test on each side.
 */
export const KCL_DEFAULT_VIEW_NAME = 'Default View'

/**
 * A KclNamedView is one `view::named` artifact and the module that declared it.
 *
 * The `NamedView` of `@rust/kcl-lib/bindings/NamedView` is a different feature:
 * the project-global camera stored in `project.toml`.
 */
export interface KclNamedView {
  artifact: KclNamedViewArtifact
  /** The module that declared the view. */
  moduleId: number
  /** Absent when `filenames` has no entry for `moduleId`. */
  modulePath: ModulePath | undefined
}

/**
 * Returns every named view an execution produced, in the order the executor
 * registered them.
 *
 * Views from imported modules are included. Two modules may declare one display
 * name, and both are returned.
 *
 * `Default View` is never among them. It is computed, not declared.
 */
export function listNamedViews({
  artifactGraph,
  filenames,
}: {
  artifactGraph: ArtifactGraph
  filenames: ExecState['filenames']
}): KclNamedView[] {
  const views = filterArtifacts({ types: ['namedView'] }, artifactGraph)

  return Array.from(views.values(), (artifact) => {
    const moduleId = artifact.codeRef.range[2]
    return {
      artifact,
      moduleId,
      modulePath: filenames[moduleId],
    }
  })
}

/**
 * The artifact kinds a view can show or hide.
 *
 * Adding a kind here without an arm in `isIndependentlyHideable` and
 * `engineIdForArtifact` fails to compile. `kclNamedViews.test.ts` compares the
 * list against the types `except` accepts.
 */
export const VISIBILITY_KINDS = [
  'sweep',
  'compositeSolid',
  'path',
  'gdtAnnotation',
] as const satisfies readonly Artifact['type'][]

export type VisibilityKind = (typeof VISIBILITY_KINDS)[number]

type VisibilityArtifact = Extract<Artifact, { type: VisibilityKind }>

/**
 * A VisibilityUniverse is every object a view can address, keyed by artifact id.
 *
 * A pattern copy is keyed by its copy id and valued with the `pattern` artifact,
 * because that artifact is what `engineIdForArtifact` needs to translate the
 * copy id.
 */
export type VisibilityUniverse = Map<ArtifactId, VisibilityUniverseMember>

export type VisibilityUniverseMember =
  | VisibilityArtifact
  | Extract<Artifact, { type: 'pattern' }>

/**
 * A DesiredVisibility is the state a view asks for, keyed by universe member id.
 *
 * True hides.
 */
export type DesiredVisibility = Map<ArtifactId, boolean>

function isIndependentlyHideable(artifact: VisibilityArtifact): boolean {
  switch (artifact.type) {
    case 'sweep':
    case 'compositeSolid':
    case 'path':
      return !artifact.consumed
    case 'gdtAnnotation':
      return true
    default: {
      const _exhaustiveCheck: never = artifact
      return _exhaustiveCheck
    }
  }
}

/**
 * Returns the body a pattern made its copies from.
 *
 * - `sourceId` names a `sweep` or a `compositeSolid`: that artifact.
 * - `sourceId` names anything else, such as the sketch a patterned solid was
 *   built from: the body whose `patternIds` contains this pattern's id.
 */
function sourceBodyForPattern(
  pattern: Extract<Artifact, { type: 'pattern' }>,
  artifactGraph: ArtifactGraph
): Extract<Artifact, { type: 'sweep' | 'compositeSolid' }> | undefined {
  const directSource = artifactGraph.get(pattern.sourceId)
  if (
    directSource?.type === 'sweep' ||
    directSource?.type === 'compositeSolid'
  ) {
    return directSource
  }

  return [...artifactGraph.values()].find(
    (
      candidate
    ): candidate is Extract<Artifact, { type: 'sweep' | 'compositeSolid' }> =>
      (candidate.type === 'sweep' || candidate.type === 'compositeSolid') &&
      (candidate.patternIds ?? []).includes(pattern.id)
  )
}

/**
 * Returns every object a view can address in the given execution.
 *
 * Kinds outside `VISIBILITY_KINDS` are excluded by decision. `setPlaneHidden`
 * owns the default planes. Helixes and imported geometry wait until `except` can
 * name them.
 */
export function getViewUniverse(
  artifactGraph: ArtifactGraph
): VisibilityUniverse {
  const universe: VisibilityUniverse = new Map(
    filterArtifacts(
      { types: [...VISIBILITY_KINDS], predicate: isIndependentlyHideable },
      artifactGraph
    )
  )

  // Each pattern copy is an engine object addressed by its copy id. Copies join
  // only when their source body is a member, so a pattern whose source a later
  // boolean consumed contributes nothing.
  for (const artifact of artifactGraph.values()) {
    if (artifact.type !== 'pattern') continue

    const sourceBody = sourceBodyForPattern(artifact, artifactGraph)
    if (!sourceBody || !universe.has(sourceBody.id)) continue

    for (const copyId of artifact.copyIds) {
      universe.set(copyId, artifact)
    }
  }

  return universe
}

/**
 * Returns the engine object id of a swept body.
 *
 * - `loft` and `blend`: the artifact id. Both override the base sketch's id with
 *   their own command id.
 * - Any other subtype whose base path points back through `Path.sweepId`:
 *   `pathId`. The body answers to the path's id.
 * - Any other subtype without that back-link: the artifact id. `mirror3d` copied
 *   this node from the source body, overwrote `id` with the mirrored body's
 *   engine object id, and left `pathId` naming the source body's path
 *   (`rust/kcl-lib/src/execution/artifact.rs:1286-1294`). `pathId` here
 *   addresses the source body.
 */
function engineIdForSweep(
  sweep: Extract<Artifact, { type: 'sweep' }>,
  artifactGraph: ArtifactGraph
): ArtifactId {
  switch (sweep.subType) {
    case 'extrusion':
    case 'extrusionTwist':
    case 'revolve':
    case 'revolveAboutEdge':
    case 'sweep': {
      const basePath = artifactGraph.get(sweep.pathId)
      const pathPointsBack =
        basePath?.type === 'path' && basePath.sweepId === sweep.id
      return pathPointsBack ? sweep.pathId : sweep.id
    }
    case 'loft':
    case 'blend':
      return sweep.id
    default: {
      const _exhaustiveCheck: never = sweep.subType
      return _exhaustiveCheck
    }
  }
}

/**
 * Returns the engine object id that addresses a universe entry.
 *
 * - `compositeSolid`, `path`, `gdtAnnotation`: the artifact id is also the
 *   engine object id.
 * - `pattern`: the key is the copy id the engine assigned.
 *
 * `hide_id_contract_kcl_test_pins.rs` pins which kinds hold one uuid and which
 * hold two.
 */
export function engineIdForArtifact({
  id,
  artifact,
  artifactGraph,
}: {
  id: ArtifactId
  artifact: VisibilityUniverseMember
  artifactGraph: ArtifactGraph
}): ArtifactId {
  switch (artifact.type) {
    case 'sweep':
      return engineIdForSweep(artifact, artifactGraph)
    case 'compositeSolid':
    case 'path':
    case 'gdtAnnotation':
      return artifact.id
    case 'pattern':
      return id
    default: {
      const _exhaustiveCheck: never = artifact
      return _exhaustiveCheck
    }
  }
}

/**
 * Rekeys a visibility from artifact ids to engine object ids.
 *
 * - An artifact id absent from the universe is skipped. Its entry is what says
 *   how to translate it.
 * - Two entries translating to one engine object id resolve to hidden. A
 *   universe from `getViewUniverse` cannot produce that, but the resolution is
 *   fixed anyway: hiding one object too many is recoverable, showing one too
 *   many reveals geometry a program hid.
 */
export function engineIdsForVisibility({
  visibility,
  universe,
  artifactGraph,
}: {
  visibility: DesiredVisibility
  universe: VisibilityUniverse
  artifactGraph: ArtifactGraph
}): Map<string, boolean> {
  const hiddenByObjectId = new Map<string, boolean>()

  for (const [id, hidden] of visibility) {
    const artifact = universe.get(id)
    if (!artifact) continue

    const objectId = engineIdForArtifact({ id, artifact, artifactGraph })
    hiddenByObjectId.set(
      objectId,
      hidden || (hiddenByObjectId.get(objectId) ?? false)
    )
  }

  return hiddenByObjectId
}

export function visibilityForView({
  universe,
  view,
}: {
  universe: VisibilityUniverse
  view: KclNamedViewArtifact
}): DesiredVisibility {
  const exceptIds = new Set(
    view.baseline === 'show' ? view.hideIds : view.showIds
  )

  return visibilityForBaseline(universe, view.baseline, exceptIds)
}

/**
 * Returns the visibility of `Default View`, the resulting scene from a successful execution.
 *
 * That scene is a `show` baseline excepting the objects the program's own
 * `hide()` calls named, so activating it needs no re-execution.
 * `hiddenArtifactIdsFromOperations` collects those ids. Objects the executor hid
 * without a `hide()` call are already outside the universe.
 */
export function visibilityForKclDefault({
  universe,
  hiddenIds,
}: {
  universe: VisibilityUniverse
  hiddenIds: ReadonlySet<ArtifactId>
}): DesiredVisibility {
  return visibilityForBaseline(universe, 'show', hiddenIds)
}

/**
 * Applies a baseline and its exceptions to every universe member.
 *
 * Every member gets an explicit state, because the engine cannot be asked what
 * it is showing. An exception id that is not a member is ignored.
 */
function visibilityForBaseline(
  universe: VisibilityUniverse,
  baseline: ArtifactVisibility,
  exceptIds: ReadonlySet<ArtifactId>
): DesiredVisibility {
  const visibility: DesiredVisibility = new Map()

  for (const id of universe.keys()) {
    const isException = exceptIds.has(id)
    visibility.set(id, baseline === 'show' ? isException : !isException)
  }

  return visibility
}

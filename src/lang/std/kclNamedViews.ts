import type { ArtifactVisibility } from '@rust/kcl-lib/bindings/Artifact'
import type { NamedView } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import { Vector3 } from 'three'

import { filterArtifacts } from '@src/lang/std/artifactGraph'
import type {
  Artifact,
  ArtifactGraph,
  ArtifactId,
  ExecState,
  KclNamedViewArtifact,
} from '@src/lang/wasm'
import { FILE_EXT } from '@src/lib/constants'

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

function moduleName(path: ModulePath | undefined): string | undefined {
  if (path === undefined || path.type === 'Main') {
    return undefined
  }

  const file = path.value.replace(/^.*\//, '')
  return file.endsWith(FILE_EXT) ? file.slice(0, -FILE_EXT.length) : file
}

/** Uses the same module-qualified labels in the views pane and exports. */
export function namedViewDisplayNames(views: KclNamedView[]): string[] {
  const nameCounts = new Map<string, number>()
  for (const view of views) {
    const name = view.artifact.name
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }

  return views.map((view) => {
    const name = view.artifact.name
    const module = moduleName(view.modulePath)
    const collides = (nameCounts.get(name) ?? 0) > 1
    return collides && module ? `${module}::${name}` : name
  })
}

/** Builds serializable export data without changing the live camera or scene. */
export function namedViewsForExport({
  artifactGraph,
  filenames,
  fallbackDistance,
}: {
  artifactGraph: ArtifactGraph
  filenames: ExecState['filenames']
  fallbackDistance: number
}): Record<string, NamedView> {
  const namedViews = listNamedViews({ artifactGraph, filenames })
  const names = namedViewDisplayNames(namedViews)
  const universe = getViewUniverse(artifactGraph)
  // Use a JSON object: Map entries are lost by JSON.stringify in export.
  const views: Record<string, NamedView> = Object.create(null)

  for (const [index, view] of namedViews.entries()) {
    const { baseline, camera } = view.artifact
    const target = new Vector3(
      camera.target?.x ?? 0,
      camera.target?.y ?? 0,
      camera.target?.z ?? 0
    )
    const distance = camera.distance ?? fallbackDistance
    let direction: Vector3
    let viewUp: Vector3
    if (camera.look.type === 'directed') {
      direction = new Vector3(
        camera.look.direction.x,
        camera.look.direction.y,
        camera.look.direction.z
      ).normalize()
      viewUp = new Vector3(camera.look.up.x, camera.look.up.y, camera.look.up.z)
    } else {
      // Directions point from the eye toward the target, in Z-up space.
      const directions = {
        front: new Vector3(0, 1, 0),
        back: new Vector3(0, -1, 0),
        left: new Vector3(1, 0, 0),
        right: new Vector3(-1, 0, 0),
        top: new Vector3(0, 0, -1),
        bottom: new Vector3(0, 0, 1),
        isometric: new Vector3(-1, 1, -1).normalize(),
      }
      direction = directions[camera.look.orientation]
      viewUp =
        camera.look.orientation === 'top'
          ? new Vector3(0, 1, 0)
          : camera.look.orientation === 'bottom'
            ? new Vector3(0, -1, 0)
            : new Vector3(0, 0, 1)
    }
    // Remove any component along the viewing direction to get camera up.
    viewUp.projectOnPlane(direction).normalize()
    const vantage = target.clone().addScaledVector(direction, -distance)
    const visibility = engineIdsForVisibility({
      visibility: visibilityForView({ universe, view: view.artifact }),
      universe,
      artifactGraph,
    })
    const exceptIds = [...visibility]
      .filter(([, hidden]) => (baseline === 'show' ? hidden : !hidden))
      .map(([id]) => id)

    // Different directories can contain modules with the same filename stem.
    const name = names[index]
    let exportName = name
    for (let suffix = 2; Object.hasOwn(views, exportName); suffix++) {
      exportName = `${name} (${suffix})`
    }

    views[exportName] = {
      vantage: { x: vantage.x, y: vantage.y, z: vantage.z },
      target: { x: target.x, y: target.y, z: target.z },
      up: { x: viewUp.x, y: viewUp.y, z: viewUp.z },
      projection: { type: camera.projection },
      baseline,
      except_ids: exceptIds,
    }
  }

  return views
}

/**
 * The artifact kinds a view can show or hide.
 *
 * Adding a kind here without an arm in `isIndependentlyHideable` and
 * `engineIdForArtifact` fails lint. `kclNamedViews.test.ts` compares the
 * list against the types `except` accepts.
 */
export const VISIBILITY_KINDS = [
  'sweep',
  'compositeSolid',
  'path',
  'gdtAnnotation',
  'helix',
  'plane',
  'importedGeometry',
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
    case 'gdtAnnotation':
    case 'helix':
    case 'importedGeometry':
      return true
    case 'plane':
      return artifact.pathIds.length === 0
  }
}

function isConsumed(artifact: VisibilityArtifact): boolean {
  return 'consumed' in artifact && artifact.consumed
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
 * Kinds outside `VISIBILITY_KINDS` are excluded by decision.
 *
 * - Default planes are absent from the artifact graph and remain under
 *   `setPlaneHidden`.
 * - `planeOf()` produces `planeOfFace`, which is not a visibility kind because
 *   the engine creates it hidden.
 * - A `plane` with `pathIds` supports a sketch and is excluded by
 *   `isIndependentlyHideable` because the executor hid it.
 */
export function getViewUniverse(
  artifactGraph: ArtifactGraph
): VisibilityUniverse {
  const universe: VisibilityUniverse = new Map(
    filterArtifacts(
      {
        types: [...VISIBILITY_KINDS],
        predicate: (artifact) =>
          !isConsumed(artifact) && isIndependentlyHideable(artifact),
      },
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
 * - `loft`, `blend`, and `planarSurface`: the artifact id. These create bodies
 *   with their own engine id.
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
      if (!sweep.pathId) return sweep.id

      const basePath = artifactGraph.get(sweep.pathId)
      const pathPointsBack =
        basePath?.type === 'path' && basePath.sweepId === sweep.id
      return pathPointsBack ? sweep.pathId : sweep.id
    }
    case 'loft':
    case 'blend':
    case 'planarSurface':
      return sweep.id
  }
}

/**
 * Returns the engine object id that addresses a universe entry.
 *
 * - Every non-sweep, non-pattern universe artifact uses its artifact id as its
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
    case 'helix':
    case 'plane':
    case 'importedGeometry':
      return artifact.id
    case 'pattern':
      return id
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

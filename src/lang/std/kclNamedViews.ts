import { incrementMapCounter } from '@src/lib/utils'
import type { NamedView } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import { Vector3 } from 'three'

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
    incrementMapCounter(nameCounts, name)
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
  namedViewResolution,
  fallbackDistance,
}: {
  namedViewResolution: ExecState['namedViews']
  fallbackDistance: number
}): Record<string, NamedView> {
  // Use a JSON object because JSON.stringify does not serialize Map entries.
  const views: Record<string, NamedView> = Object.create(null)
  if (!namedViewResolution) return views

  const { batch, artifacts } = namedViewResolution
  const resolvedByArtifactId = new Map(
    batch.namedViews.map((view) => [view.info.artifactId, view])
  )
  const namedViews = Array.from(artifacts.values()).flatMap((artifact) => {
    const resolved = resolvedByArtifactId.get(artifact.id)
    if (!resolved) return []
    return [
      {
        artifact,
        moduleId: resolved.info.moduleId,
        modulePath: resolved.info.modulePath,
        resolved,
      },
    ]
  })
  const names = namedViewDisplayNames(namedViews)

  for (const [index, view] of namedViews.entries()) {
    const { baseline } = view.artifact
    const { cameraIntent: camera, visibility } = view.resolved
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
    const exceptIds = Object.entries(visibility)
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
      if (!sweep.pathId) return sweep.id

      const basePath = artifactGraph.get(sweep.pathId)
      const pathPointsBack =
        basePath?.type === 'path' && basePath.sweepId === sweep.id
      return pathPointsBack ? sweep.pathId : sweep.id
    }
    case 'loft':
    case 'blend':
      return sweep.id
  }
}

type EngineIdArtifact = Extract<
  Artifact,
  {
    type:
      | 'sweep'
      | 'compositeSolid'
      | 'path'
      | 'gdtAnnotation'
      | 'helix'
      | 'plane'
      | 'importedGeometry'
      | 'pattern'
  }
>

/** Returns the engine object ID. For a pattern, pass the copy ID as `id`. */
export function engineIdForArtifact({
  id,
  artifact,
  artifactGraph,
}: {
  id: ArtifactId
  artifact: EngineIdArtifact
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

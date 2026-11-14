import type { EntityReference } from '@kittycad/lib'
import type { ArtifactGraph } from '@src/lang/wasm'
import { getEntityRefId } from '@src/lib/scene/entityReference'
import type { Mesh } from 'three'

/** Resolve rendered targets without altering engine selection. Body artifacts expand to their known surfaces. */
export function entityStyleTargets(
  references: readonly EntityReference[],
  graph: ArtifactGraph,
  byId: (id: string) => readonly Mesh[]
): Mesh[] {
  const targets = new Set<Mesh>(),
    visited = new Set<string>()
  const include = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    const direct = byId(id)
    if (direct.length) {
      for (const mesh of direct) targets.add(mesh)
      return
    }
    const artifact = graph.get(id)
    if (artifact?.type === 'sweep')
      for (const face of artifact.surfaceIds) include(face)
    else if (artifact?.type === 'compositeSolid')
      for (const solid of artifact.solidIds) include(solid)
    else if (artifact?.type === 'path') {
      if (artifact.solid2dId) include(artifact.solid2dId)
      for (const segment of artifact.segIds) include(segment)
    }
  }
  for (const reference of references) {
    // Face adjacency is not entity identity: never paint an edge's neighboring faces as the edge.
    if (reference.type === 'edge' || reference.type === 'vertex') continue
    const id = getEntityRefId(reference)
    if (id) include(id)
  }
  return [...targets]
}

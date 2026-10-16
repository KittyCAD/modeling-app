import { getArtifactFromRange } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import { isErr } from '@src/lib/trap'
import type {
  EntityReference,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'

type EdgeReference = Extract<EntityReference, { type: 'edge' }>

/** Resolve code-selected sketch edges using topology, rather than guessing a cap. */
export async function resolveSourceEdgeSelections(
  selections: Selections,
  artifactGraph: ArtifactGraph,
  queryReference: (entityId: string) => Promise<EntityReference | Error>
): Promise<Selections | Error> {
  const graphSelections: Selection[] = []
  const references = new Map<string, Promise<EntityReference | Error>>()
  for (const selection of selections.graphSelections) {
    // Viewport and migrated edit selections already identify the intended edge.
    if (selection.entityRef?.type === 'edge') {
      graphSelections.push(selection)
      continue
    }
    const artifact =
      selection.artifact ??
      (selection.entityRef?.type === 'segment'
        ? artifactGraph.get(selection.entityRef.segment_id)
        : selection.codeRef
          ? getArtifactFromRange(selection.codeRef.range, artifactGraph)
          : undefined)
    if (artifact?.type !== 'segment') {
      graphSelections.push(selection)
      continue
    }

    const candidates = [
      artifact,
      ...[...artifactGraph.values()].filter(
        (candidate) =>
          candidate.type === 'segment' &&
          candidate.originalSegId === artifact.id
      ),
    ].filter((candidate) => candidate.type === 'segment' && candidate.surfaceId)
    if (candidates.length === 0) {
      graphSelections.push(selection)
      continue
    }

    const edges = new Map<string, EdgeReference>()
    for (const candidate of candidates) {
      let pending = references.get(candidate.id)
      if (!pending) {
        pending = queryReference(candidate.id).catch((error: unknown) =>
          isErr(error)
            ? error
            : new Error('Could not resolve the selected edge topology.')
        )
        references.set(candidate.id, pending)
      }
      const reference = await pending
      if (isErr(reference)) return reference
      if (reference.type !== 'edge' || reference.side_faces.length === 0) {
        return new Error(
          'Could not resolve the selected sketch segment to a model edge.'
        )
      }
      const key = JSON.stringify({
        sideFaces: [...reference.side_faces].sort(),
        endFaces: [...(reference.end_faces ?? [])].sort(),
        index: reference.index,
      })
      edges.set(key, reference)
    }
    if (edges.size !== 1) {
      return new Error(
        'The sketch segment belongs to multiple model edges. Select the edge in the scene.'
      )
    }
    graphSelections.push({ ...selection, entityRef: [...edges.values()][0] })
  }
  return { ...selections, graphSelections }
}

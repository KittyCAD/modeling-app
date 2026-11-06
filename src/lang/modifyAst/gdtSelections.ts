import type { ArtifactGraph } from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { queryModelingCommand } from '@src/lib/engineConnection/utils'
import {
  getPrimitiveSelectionForEntity,
  isEnginePrimitiveSelection,
} from '@src/lib/selections'
import type {
  EnginePrimitiveSelection,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'

/** Engine-only adjacent faces travel with the edge they identify. */
export type DistanceSelection = Selection & {
  primitiveFaces?: EnginePrimitiveSelection[]
  frameDefaults?: DistanceFrameDefaults
}

export type DistanceFrameDefaults = {
  framePosition?: KclCommandValue
  framePlane?: string
  fontSize?: KclCommandValue
}

export type DistanceSelections = {
  graphSelections: DistanceSelection[]
  otherSelections: Selections['otherSelections']
}

export function isDistanceEdge(selection: Selection): boolean {
  return (
    selection.entityRef?.type === 'edge' ||
    selection.artifact?.type === 'segment' ||
    selection.artifact?.type === 'sweepEdge'
  )
}

export function getDistanceMeasurementMode(
  targets: ReadonlyArray<{ kind: 'face' | 'edge' }>
): 'lengths' | 'between' | Error {
  if (!targets.length) return new Error('No valid distance selections found.')
  if (targets.length === 2) return 'between'
  if (targets.every((target) => target.kind === 'edge')) return 'lengths'
  return new Error(
    'Select one or more edges for edge lengths, or exactly two faces or edges for a distance.'
  )
}

/** Convert viewport primitives to face references, keeping engine and artifact ownership distinct. */
export async function resolveDistanceSelections(
  selections: Selections,
  graph: ArtifactGraph,
  engine: ConnectionManager
): Promise<DistanceSelections | Error> {
  const normalized: DistanceSelections = {
    graphSelections: selections.graphSelections.map((selection) => ({
      ...selection,
    })),
    otherSelections: [],
  }
  const faces = new Map<string, EnginePrimitiveSelection>()
  for (const selection of selections.otherSelections) {
    if (
      !isEnginePrimitiveSelection(selection) ||
      selection.primitiveType !== 'edge'
    ) {
      normalized.otherSelections.push(selection)
      continue
    }
    const parent = await queryModelingCommand(engine, {
      type: 'entity_get_parent_id',
      entity_id: selection.entityId,
    })
    if (parent?.type !== 'entity_get_parent_id')
      return new Error('Could not resolve the selected distance edge body.')
    const adjacent = await queryModelingCommand(engine, {
      type: 'solid3d_get_all_edge_faces',
      object_id: parent.data.entity_id,
      edge_id: selection.entityId,
    })
    if (
      adjacent?.type !== 'solid3d_get_all_edge_faces' ||
      !adjacent.data.faces.length
    ) {
      return new Error(
        'Could not resolve the adjacent faces of the selected distance edge.'
      )
    }
    normalized.graphSelections.push({
      engineEntityId: selection.entityId,
      engineTopologyFallback: selection.parentEntityId
        ? {
            parentId: selection.parentEntityId,
            primitiveIndex: selection.primitiveIndex,
          }
        : undefined,
      entityRef: { type: 'edge', side_faces: adjacent.data.faces },
    })
  }
  for (const selection of normalized.graphSelections) {
    const ref = selection.entityRef
    if (ref?.type !== 'edge') continue
    if (
      !selection.engineEntityId &&
      !selection.artifact?.id &&
      ref.side_faces.length &&
      !ref.end_faces?.length &&
      ref.index === undefined
    ) {
      const parent = await queryModelingCommand(engine, {
        type: 'entity_get_parent_id',
        entity_id: ref.side_faces[0],
      })
      const edge =
        parent?.type === 'entity_get_parent_id' &&
        (await queryModelingCommand(engine, {
          type: 'solid3d_get_common_edge',
          object_id: parent.data.entity_id,
          face_ids: ref.side_faces,
        }))
      if (edge && edge.type === 'solid3d_get_common_edge' && edge.data.edge)
        selection.engineEntityId = edge.data.edge
    }
    selection.primitiveFaces = []
    for (const id of [...ref.side_faces, ...(ref.end_faces ?? [])]) {
      if (graph.has(id) && graph.get(id)?.type !== 'primitiveFace') continue
      const face =
        faces.get(id) ??
        (await getPrimitiveSelectionForEntity(id, engine, graph))
      if (
        !face ||
        face.primitiveType !== 'face' ||
        !Number.isInteger(face.primitiveIndex) ||
        face.primitiveIndex < 0
      ) {
        return new Error(
          'Could not resolve a face of the selected distance edge.'
        )
      }
      faces.set(id, face)
      selection.primitiveFaces.push(face)
    }
  }
  return normalized
}

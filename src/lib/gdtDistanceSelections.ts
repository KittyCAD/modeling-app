import { unwrapSceneCommandResponse } from '@src/lib/engineConnection/utils'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import type { ArtifactGraph } from '@src/lang/wasm'
import { uuidv4 } from '@src/lib/utils'
import type {
  EnginePrimitiveSelection,
  Selections,
} from '@src/machines/modelingSharedTypes'

export type DistanceFaceSelections = Map<string, EnginePrimitiveSelection>

/** Keep the actual adjacent faces rather than generating deprecated edgeId calls. */
export async function resolveDistanceSelections(
  selections: Selections,
  graph: ArtifactGraph,
  engine: ConnectionManager
): Promise<{ selections: Selections; faces: DistanceFaceSelections } | Error> {
  const normalized: Selections = {
    graphSelections: [...selections.graphSelections],
    otherSelections: [],
  }
  const faces: DistanceFaceSelections = new Map()
  try {
    for (const selection of selections.otherSelections) {
      if (
        typeof selection !== 'object' ||
        !('type' in selection) ||
        selection.type !== 'enginePrimitive' ||
        selection.primitiveType !== 'edge'
      ) {
        normalized.otherSelections.push(selection)
        continue
      }
      if (!selection.parentEntityId)
        return new Error('The selected distance edge has no owning body.')
      const response = unwrapSceneCommandResponse(
        await engine.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'solid3d_get_all_edge_faces',
            object_id: selection.parentEntityId,
            edge_id: selection.entityId,
          },
        })
      )
      if (
        !isModelingResponse(response) ||
        response.resp.data.modeling_response.type !==
          'solid3d_get_all_edge_faces'
      )
        return new Error(
          'Could not resolve the adjacent faces of the selected distance edge.'
        )
      const ids = response.resp.data.modeling_response.data.faces
      if (!ids.length)
        return new Error('The selected distance edge has no adjacent faces.')
      normalized.graphSelections.push({
        engineEntityId: selection.entityId,
        engineTopologyFallback: {
          parentId: selection.parentEntityId,
          primitiveIndex: selection.primitiveIndex,
        },
        entityRef: { type: 'edge', side_faces: ids },
      })
    }
    for (const [index, selection] of normalized.graphSelections.entries()) {
      if (selection.entityRef?.type !== 'edge') continue
      if (
        !selection.engineEntityId &&
        !selection.artifact?.id &&
        selection.entityRef.side_faces.length > 0 &&
        !selection.entityRef.end_faces?.length &&
        selection.entityRef.index === undefined
      ) {
        // Face references can reach codegen without the clicked edge UUID.
        // Recover an unambiguous edge for placement queries; retain the face
        // specifier for KCL. Missing/ambiguous geometry keeps the fallback.
        try {
          const parent = unwrapSceneCommandResponse(
            await engine.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: {
                type: 'entity_get_parent_id',
                entity_id: selection.entityRef.side_faces[0],
              },
            })
          )
          if (
            isModelingResponse(parent) &&
            parent.resp.data.modeling_response.type === 'entity_get_parent_id'
          ) {
            const response = unwrapSceneCommandResponse(
              await engine.sendSceneCommand({
                type: 'modeling_cmd_req',
                cmd_id: uuidv4(),
                cmd: {
                  type: 'solid3d_get_common_edge',
                  object_id: parent.resp.data.modeling_response.data.entity_id,
                  face_ids: selection.entityRef.side_faces,
                },
              })
            )
            if (
              isModelingResponse(response) &&
              response.resp.data.modeling_response.type ===
                'solid3d_get_common_edge' &&
              response.resp.data.modeling_response.data.edge
            ) {
              normalized.graphSelections[index] = {
                ...selection,
                engineEntityId: response.resp.data.modeling_response.data.edge,
              }
            }
          }
        } catch {
          /* Edge specifiers remain usable even when placement queries fail. */
        }
      }
      for (const id of [
        ...selection.entityRef.side_faces,
        ...(selection.entityRef.end_faces ?? []),
      ]) {
        if (
          faces.has(id) ||
          (graph.has(id) && graph.get(id)?.type !== 'primitiveFace')
        )
          continue
        const response = unwrapSceneCommandResponse(
          await engine.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: { type: 'entity_get_primitive_index', entity_id: id },
          })
        )
        if (
          !isModelingResponse(response) ||
          response.resp.data.modeling_response.type !==
            'entity_get_primitive_index'
        )
          return new Error(
            'Could not resolve a face index for the selected distance edge.'
          )
        const index = response.resp.data.modeling_response.data
        if (
          index.entity_type !== 'face' ||
          !Number.isInteger(index.primitive_index) ||
          index.primitive_index < 0
        )
          return new Error(
            'The engine returned an invalid face index for a distance edge.'
          )
        const parent = unwrapSceneCommandResponse(
          await engine.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: { type: 'entity_get_parent_id', entity_id: id },
          })
        )
        if (
          !isModelingResponse(parent) ||
          parent.resp.data.modeling_response.type !== 'entity_get_parent_id'
        )
          return new Error(
            'Could not resolve the body of a distance edge face.'
          )
        faces.set(id, {
          type: 'enginePrimitive',
          primitiveType: 'face',
          entityId: id,
          primitiveIndex: index.primitive_index,
          parentEntityId: parent.resp.data.modeling_response.data.entity_id,
        })
      }
    }
    return { selections: normalized, faces }
  } catch {
    return new Error(
      'Could not resolve the selected distance edges. Reconnect to the engine and try again.'
    )
  }
}

import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { resolveDistanceSelections } from '@src/lib/gdtDistanceSelections'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { describe, expect, it, vi } from 'vitest'

function engineWithFaces(wrapped: boolean) {
  const sendSceneCommand = vi.fn().mockImplementation(async ({ cmd }) => {
    const response = {
      success: true,
      resp: {
        type: 'modeling',
        data: {
          modeling_response:
            cmd.type === 'solid3d_get_all_edge_faces'
              ? {
                  type: cmd.type,
                  data: { faces: ['cap', cmd.edge_id + '-wall'] },
                }
              : cmd.type === 'solid3d_get_common_edge'
                ? { type: cmd.type, data: { edge: 'edge' } }
                : cmd.type === 'entity_get_parent_id'
                  ? { type: cmd.type, data: { entity_id: 'body' } }
                  : {
                      type: cmd.type,
                      data: {
                        entity_type: 'face',
                        primitive_index: cmd.entity_id === 'cap' ? 0 : 7,
                      },
                    },
        },
      },
    }
    return wrapped ? [response] : response
  })
  return {
    engine: { sendSceneCommand } as unknown as ConnectionManager,
    sendSceneCommand,
  }
}

describe.each([false, true])(
  'distance selection references (array response: %s)',
  (wrapped) => {
    it('recovers the edge UUID for geometry queries when only face references were selected', async () => {
      const { engine } = engineWithFaces(wrapped)
      const graph: ArtifactGraph = new Map(
        ['cap', 'wall'].map((id) => [id, { type: 'cap', id } as Artifact])
      )
      const selections: Selections = {
        graphSelections: [
          { entityRef: { type: 'edge', side_faces: ['cap', 'wall'] } },
        ],
        otherSelections: [],
      }
      const result = await resolveDistanceSelections(selections, graph, engine)
      if (result instanceof Error) throw result
      expect(result.selections.graphSelections[0]).toEqual({
        ...selections.graphSelections[0],
        engineEntityId: 'edge',
      })
      expect(selections.graphSelections[0].engineEntityId).toBeUndefined()
    })

    it('resolves primitive edges through adjacent faces, retaining the actual edge IDs for geometry', async () => {
      const { engine } = engineWithFaces(wrapped)
      const selections: Selections = {
        graphSelections: [],
        otherSelections: ['left', 'right'].map((id, index) => ({
          type: 'enginePrimitive',
          primitiveType: 'edge',
          entityId: id,
          primitiveIndex: index,
          parentEntityId: 'body',
        })),
      }
      const result = await resolveDistanceSelections(
        selections,
        new Map(),
        engine
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) throw result
      expect(result.selections.otherSelections).toEqual([])
      expect(
        result.selections.graphSelections.map((s) => s.engineEntityId)
      ).toEqual(['left', 'right'])
      expect(result.selections.graphSelections.map((s) => s.entityRef)).toEqual(
        [
          { type: 'edge', side_faces: ['cap', 'left-wall'] },
          { type: 'edge', side_faces: ['cap', 'right-wall'] },
        ]
      )
      expect(result.faces.get('left-wall')).toMatchObject({
        primitiveType: 'face',
        primitiveIndex: 7,
        parentEntityId: 'body',
      })
      expect(selections.otherSelections).toHaveLength(2)
    })

    it('keeps graph face references, their disambiguating index, and tags without re-querying their topology', async () => {
      const { engine, sendSceneCommand } = engineWithFaces(wrapped)
      const graph: ArtifactGraph = new Map(
        ['a', 'b', 'end'].map((id) => [id, { type: 'cap', id } as Artifact])
      )
      const selections: Selections = {
        graphSelections: [
          {
            engineEntityId: 'edge',
            entityRef: {
              type: 'edge',
              side_faces: ['a', 'b'],
              end_faces: ['end'],
              index: 1,
            },
          },
        ],
        otherSelections: [],
      }
      const result = await resolveDistanceSelections(selections, graph, engine)
      expect(result).toEqual({ selections, faces: new Map() })
      expect(sendSceneCommand).not.toHaveBeenCalled()
    })

    it('fails instead of falling back to a deprecated edgeId or emitting incomplete endpoints', async () => {
      const result = await resolveDistanceSelections(
        {
          graphSelections: [],
          otherSelections: [
            {
              type: 'enginePrimitive',
              primitiveType: 'edge',
              entityId: 'edge',
              primitiveIndex: 3,
              parentEntityId: 'body',
            },
          ],
        },
        new Map(),
        {
          sendSceneCommand: vi
            .fn()
            .mockRejectedValue(new Error('Disconnected')),
        } as unknown as ConnectionManager
      )
      expect(result).toBeInstanceOf(Error)
    })
  }
)

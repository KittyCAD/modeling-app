import type { ModelingCmd } from '@kittycad/lib'
import type { Artifact } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'
import {
  getMeasurementEntities,
  resolveMeasurementEntities,
} from '@src/registry/extensions/engineScene/measurementUtils'
import { describe, expect, it } from 'vitest'

function response(id: string) {
  return {
    success: true,
    resp: {
      type: 'modeling',
      data: {
        modeling_response: {
          type: 'solid3d_get_edge_uuid',
          data: { edge_id: id },
        },
      },
    },
  }
}

describe('topology measurement regressions', () => {
  it('resolves pump edge index 10, independently of adjacent faces and reference index', async () => {
    const selected: Selections = {
      graphSelections: [
        {
          entityRef: {
            type: 'edge',
            side_faces: ['boolean-side'],
            end_faces: ['boolean-cap'],
            index: 2,
          },
          engineTopologyFallback: { parentId: 'pump-body', primitiveIndex: 10 },
        },
      ],
      otherSelections: [],
    }
    const commands: ModelingCmd[] = []
    expect(
      await resolveMeasurementEntities(selected, new Map(), async (cmd) => {
        commands.push(cmd)
        return response('pump-edge-10')
      })
    ).toEqual([{ id: 'pump-edge-10', kind: 'edge' }])
    expect(commands).toEqual([
      { type: 'solid3d_get_edge_uuid', object_id: 'pump-body', edge_index: 10 },
    ])
  })

  it('uses the engine object ID of a swept body for topology lookup', async () => {
    const codeRef = {
      range: [0, 1, 0] as [number, number, number],
      pathToNode: [],
      nodePath: { steps: [] },
    }
    const sweep: Extract<Artifact, { type: 'sweep' }> = {
      type: 'sweep',
      id: 'sweep',
      pathId: 'path',
      subType: 'extrusion',
      surfaceIds: [],
      edgeIds: [],
      trajectoryId: null,
      method: 'new',
      consumed: false,
      codeRef,
    }
    const path: Extract<Artifact, { type: 'path' }> = {
      type: 'path',
      id: 'path',
      subType: 'region',
      sweepId: 'sweep',
      planeId: 'plane',
      segIds: [],
      consumed: true,
      trajectorySweepId: null,
      codeRef,
    }
    const graph = new Map<string, Artifact>([
      [sweep.id, sweep],
      [path.id, path],
    ])
    expect(
      getMeasurementEntities(
        {
          graphSelections: [
            { entityRef: { type: 'solid3d', solid3d_id: sweep.id } },
          ],
          otherSelections: [],
        },
        graph
      )
    ).toEqual([{ id: 'path', kind: 'body' }])
    const selected: Selections = {
      graphSelections: [
        {
          entityRef: { type: 'edge', side_faces: ['wall'] },
          engineTopologyFallback: { parentId: 'sweep', primitiveIndex: 0 },
        },
      ],
      otherSelections: [],
    }
    expect(
      await resolveMeasurementEntities(selected, graph, async (cmd) => {
        expect(cmd).toEqual({
          type: 'solid3d_get_edge_uuid',
          object_id: 'path',
          edge_index: 0,
        })
        return response('edge-zero')
      })
    ).toEqual([{ id: 'edge-zero', kind: 'edge' }])
  })

  it('resolves a topology-only edge even when its artifact identifies an adjacent face', async () => {
    const locator: Extract<Artifact, { type: 'wall' }> = {
      type: 'wall',
      id: 'side-face',
      segId: 'segment',
      sweepId: 'body',
      edgeCutEdgeIds: [],
      pathIds: [],
      cmdId: 'command',
      faceCodeRef: {
        range: [0, 0, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    }
    const selected: Selections = {
      graphSelections: [
        {
          artifact: locator,
          entityRef: { type: 'edge', side_faces: [locator.id] },
          engineTopologyFallback: { parentId: 'body', primitiveIndex: 0 },
        },
      ],
      otherSelections: [],
    }
    expect(
      await resolveMeasurementEntities(
        selected,
        new Map([[locator.id, locator]]),
        async (cmd) => {
          expect(cmd).toEqual({
            type: 'solid3d_get_edge_uuid',
            object_id: 'body',
            edge_index: 0,
          })
          return response('edge')
        }
      )
    ).toEqual([{ id: 'edge', kind: 'edge' }])
  })

  it('does not drop an unresolved vertex from a mixed selection', async () => {
    const selected: Selections = {
      graphSelections: [
        {
          entityRef: { type: 'edge', side_faces: ['face'] },
          engineEntityId: 'edge',
        },
        {
          entityRef: {
            type: 'vertex',
            side_faces: ['face-a', 'face-b', 'face-c'],
          },
        },
      ],
      otherSelections: [],
    }
    expect(
      await resolveMeasurementEntities(selected, new Map(), async () =>
        response('edge')
      )
    ).toBeInstanceOf(Error)
  })

  it.each([-1, 0.5, NaN, Infinity, 0x100000000])(
    'rejects invalid primitive index %s before sending a command',
    async (index) => {
      const selected: Selections = {
        graphSelections: [
          {
            entityRef: { type: 'edge', side_faces: ['face'] },
            engineTopologyFallback: { parentId: 'body', primitiveIndex: index },
          },
        ],
        otherSelections: [],
      }
      expect(
        await resolveMeasurementEntities(selected, new Map(), async () => {
          expect.fail('Invalid topology must not reach the engine')
        })
      ).toBeInstanceOf(Error)
    }
  )

  it('does not return a singleton when the second edge fails to resolve', async () => {
    const selected: Selections = {
      graphSelections: [
        {
          entityRef: { type: 'edge', side_faces: ['first-face'] },
          engineEntityId: 'first-edge',
        },
        { entityRef: { type: 'edge', side_faces: ['second-face'] } },
      ],
      otherSelections: [],
    }
    expect(
      await resolveMeasurementEntities(selected, new Map(), async () =>
        response('invented-edge')
      )
    ).toBeInstanceOf(Error)
  })
})

import type { WebSocketResponse } from '@kittycad/lib'
import type { KclManager } from '@src/lang/KclManager'
import { assertParse } from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  getEventForQueryEntityTypeWithPoint,
  getSelectionTypeDisplayText,
} from '@src/lib/selections'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { PerspectiveCamera } from 'three'
import { beforeAll, expect, it, vi } from 'vitest'

let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>
beforeAll(async () => {
  world = await buildTheWorldAndNoEngineConnection()
})

it('keeps a picked corner as a point selection and drops stale topology responses', async () => {
  const kclManager = {
    ast: assertParse('', world.instance),
    artifactGraph: new Map(),
    isShiftDown: true,
    selectionFilter: { value: ['vertex'] },
    sceneInfra: { camControls: { camera: new PerspectiveCamera() } },
  }
  let coordinateQuery = 0
  const sendSceneCommand: ConnectionManager['sendSceneCommand'] = vi.fn(
    async (request) => {
      if (request.type !== 'modeling_cmd_req') return null
      const cmd = request.cmd
      const result =
        cmd.type === 'solid3d_get_common_edge'
          ? { type: cmd.type, data: { edge: cmd.face_ids.join('-') } }
          : {
              type: 'curve_get_end_points',
              data: {
                start: { x: 25.4, y: 0, z: 20 },
                end: { x: 25.4 + ++coordinateQuery, y: 10, z: 30 },
              },
            }
      return {
        success: true,
        resp: { type: 'modeling', data: { modeling_response: result } },
      } as WebSocketResponse
    }
  )
  const deps = {
    kclManager: kclManager as unknown as KclManager,
    engineCommandManager: {
      sendSceneCommand,
      streamDimensions: { width: 100, height: 100 },
    } as unknown as ConnectionManager,
    rustContext: world.rustContext,
    wasmInstance: world.instance,
    useSegmentsBasedRegions: false,
  }
  const query = {
    reference: {
      type: 'vertex' as const,
      side_faces: ['f1', 'f2', 'f3'],
      topology_fallback: { parent_id: 'body', primitive_index: 2 },
    },
  }
  const result = await getEventForQueryEntityTypeWithPoint(query, deps)
  if (
    result?.type !== 'Set selection' ||
    result.data.selectionType !== 'singleCodeCursor'
  )
    throw new Error('Missing point selection')
  expect(result.data.isShiftDown).toBe(true)
  expect(result.data.selection.vertexPosition).toEqual([25.4, 0, 20])
  expect(result.data.selection.entityRef?.type).toBe('vertex')
  expect(
    getSelectionTypeDisplayText(
      kclManager.ast,
      { graphSelections: [result.data.selection], otherSelections: [] },
      kclManager.artifactGraph
    )
  ).toBe('1 point')
  const pending = getEventForQueryEntityTypeWithPoint(query, deps)
  kclManager.ast = assertParse('changed = 1', world.instance)
  expect(await pending).toBeNull()
})

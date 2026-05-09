import { decode as msgpackDecode } from '@msgpack/msgpack'
import { describe, expect, it } from 'vitest'

import { assertParse } from '@src/lang/wasm'
import { OpenCascadeCommandManager } from '@src/network/openCascadeCommandManager'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

const RANGE = JSON.stringify([0, 0, 0])
const ID_MAP = '{}'

const IDS = {
  plane: '00000000-0000-0000-0000-000000000001',
  path: '00000000-0000-0000-0000-000000000002',
  edge: '00000000-0000-0000-0000-000000000003',
  region: '00000000-0000-0000-0000-000000000004',
  solid: '00000000-0000-0000-0000-000000000005',
  request: '00000000-0000-0000-0000-000000000006',
}

describe('OpenCascadeCommandManager', () => {
  it('builds a closed circular region, extrudes it, and exports BREP bytes', async () => {
    const manager = new OpenCascadeCommandManager()

    await send(manager, IDS.request, {
      type: 'modeling_cmd_batch_req',
      requests: [
        {
          cmd_id: IDS.plane,
          cmd: {
            type: 'make_plane',
            clobber: false,
            origin: { x: 0, y: 0, z: 0 },
            x_axis: { x: 1, y: 0, z: 0 },
            y_axis: { x: 0, y: 1, z: 0 },
            size: 10,
          },
        },
        {
          cmd_id: '00000000-0000-0000-0000-000000000007',
          cmd: { type: 'enable_sketch_mode', entity_id: IDS.plane },
        },
        {
          cmd_id: IDS.path,
          cmd: { type: 'start_path' },
        },
        {
          cmd_id: '00000000-0000-0000-0000-000000000008',
          cmd: {
            type: 'move_path_pen',
            path: IDS.path,
            to: { x: 1, y: 0, z: 0 },
          },
        },
        {
          cmd_id: IDS.edge,
          cmd: {
            type: 'extend_path',
            path: IDS.path,
            segment: {
              type: 'arc',
              center: { x: 0, y: 0 },
              radius: 1,
              start: { unit: 'degrees', value: 0 },
              end: { unit: 'degrees', value: 360 },
              relative: false,
            },
          },
        },
        {
          cmd_id: '00000000-0000-0000-0000-000000000009',
          cmd: { type: 'close_path', path_id: IDS.path },
        },
        {
          cmd_id: '00000000-0000-0000-0000-00000000000a',
          cmd: { type: 'sketch_mode_disable' },
        },
      ],
    })

    const regionResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: IDS.region,
      cmd: {
        type: 'create_region_from_query_point',
        object_id: IDS.path,
        point: { x: 0, y: 0 },
      },
    })
    expect(
      regionResponse.resp.data.modeling_response.data.region_mapping
    ).toEqual({
      [IDS.region]: IDS.edge,
    })

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: IDS.solid,
      cmd: {
        type: 'extrude',
        target: IDS.region,
        distance: 5,
        extrude_method: 'new',
        body_type: 'solid',
      },
    })
    expect(manager.getSolidCount()).toBe(1)
    expect(manager.exportLastBrep()?.length).toBeGreaterThan(0)

    const faceInfoResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-00000000000b',
      cmd: {
        type: 'solid3d_get_extrusion_face_info',
        object_id: IDS.region,
        edge_id: IDS.region,
      },
    })
    expect(
      faceInfoResponse.resp.data.modeling_response.data.faces.map(
        (face: { cap: string }) => face.cap
      )
    ).toEqual(['none', 'bottom', 'top'])

    const exportResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-00000000000c',
      cmd: {
        type: 'export',
        entity_ids: [IDS.solid],
        format: { type: 'brep' },
      },
    })
    expect(exportResponse.resp.type).toBe('export')
    expect(exportResponse.resp.data.files[0].contents.length).toBeGreaterThan(0)
  })

  it('executes the circle-region-extrude KCL proof through WASM', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(
      `sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 0.89mm, var 0.72mm], center = [var 0mm, var 0mm])
  coincident([circle1.center, ORIGIN])
}
hidden001 = hide(sketch001)
region001 = region(point = [-0.8880564mm, -0.7184276mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5)
`,
      instance
    )

    const execState = await rustContext.execute(ast, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(execState.variables.extrude001?.type).toBe('Solid')
    const manager = OpenCascadeCommandManager.latestInstance()
    expect(manager?.getSolidCount()).toBe(1)
    expect(manager?.exportLastBrep()?.length).toBeGreaterThan(0)
  })
})

async function send(
  manager: OpenCascadeCommandManager,
  requestId: string,
  request: unknown
): Promise<any> {
  const encoded = await manager.sendModelingCommandFromWasm(
    requestId,
    RANGE,
    JSON.stringify(request),
    ID_MAP
  )

  return msgpackDecode(encoded)
}

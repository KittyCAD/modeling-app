import { decode as msgpackDecode } from '@msgpack/msgpack'
import { describe, expect, it } from 'vitest'

import { assertParse } from '@src/lang/wasm'
import { OpenCascadeCommandManager } from '@src/network/openCascadeCommandManager'
import {
  OPEN_CASCADE_CIRCLE_EXTRUDE_KCL,
  OPEN_CASCADE_LOFT_KCL,
  OPEN_CASCADE_REVOLVE_KCL,
  OPEN_CASCADE_SWEEP_KCL,
} from '@src/network/openCascadeProofFixture'
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

    await buildCircleRegionInput(manager)

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
    expect(manager.latestProfileVersion.value).toBeGreaterThan(0)
    expect(
      (await manager.exportLatestProfileGlbBytes()).length
    ).toBeGreaterThan(0)

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
    const topologyMeshes = manager.exportLatestTopologyMeshes()
    expect(topologyMeshes.solids).toHaveLength(1)
    expect(
      topologyMeshes.solids[0].groups.map(
        (group: { role: string }) => group.role
      )
    ).toEqual(['startCap', 'endCap', 'wall'])
    const glbBytes = await manager.exportLatestGlbBytes()
    expect(glbBytes.length).toBeGreaterThan(0)

    const faceInfoResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-00000000000b',
      cmd: {
        type: 'solid3d_get_extrusion_face_info',
        object_id: IDS.path,
        edge_id: IDS.edge,
      },
    })
    const faceInfo = faceInfoResponse.resp.data.modeling_response.data.faces
    expect(faceInfo.map((face: { cap: string }) => face.cap)).toEqual([
      'none',
      'bottom',
      'top',
    ])
    expect(faceInfo[0].curve_id).toBe(IDS.edge)
    expect(faceInfo[0].face_id).not.toBe(IDS.edge)

    const adjacencyResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-00000000000d',
      cmd: {
        type: 'solid3d_get_adjacency_info',
        object_id: IDS.path,
        edge_id: IDS.edge,
      },
    })
    expect(
      adjacencyResponse.resp.data.modeling_response.data.edges[0].original_info
        .edge_id
    ).toBe(IDS.edge)
    expect(
      adjacencyResponse.resp.data.modeling_response.data.edges[0].opposite_info
        .edge_id
    ).toBeTruthy()

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

  it('builds a line-based closed region, extrudes it, and exports GLB bytes', async () => {
    const manager = new OpenCascadeCommandManager()
    await buildRectangleRegionInput(manager)

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: IDS.solid,
      cmd: {
        type: 'extrude',
        target: IDS.region,
        distance: 2,
        extrude_method: 'new',
        body_type: 'solid',
      },
    })

    expect(manager.getSolidCount()).toBe(1)
    expect(manager.exportLastBrep()?.length).toBeGreaterThan(0)
    const topologyMeshes = manager.exportLatestTopologyMeshes()
    expect(
      topologyMeshes.solids[0].groups.filter(
        (group: { role: string }) => group.role === 'wall'
      )
    ).toHaveLength(4)
    expect(topologyMeshes.solids[0].edges.length).toBeGreaterThanOrEqual(4)
    expect((await manager.exportLatestGlbBytes()).length).toBeGreaterThan(0)
  })

  it('revolves a circular region and exports BREP bytes', async () => {
    const manager = new OpenCascadeCommandManager()
    await buildCircleRegionInput(manager)
    await createRegion(manager)

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: IDS.solid,
      cmd: {
        type: 'revolve',
        target: IDS.region,
        origin: { x: 3, y: 0, z: 0 },
        axis: { x: 0, y: 1, z: 0 },
        axis_is_2d: true,
        angle: { unit: 'degrees', value: 360 },
        tolerance: 1e-7,
        opposite: 'None',
        body_type: 'solid',
      },
    })

    expect(manager.getSolidCount()).toBe(1)
    expect(manager.exportLastBrep()?.length).toBeGreaterThan(0)
  })

  it('sweeps a circular region along a line trajectory', async () => {
    const manager = new OpenCascadeCommandManager()
    await buildCircleRegionInput(manager)
    await createRegion(manager)
    await buildLineTrajectory(manager, '00000000-0000-0000-0000-000000000020')

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: IDS.solid,
      cmd: {
        type: 'sweep',
        target: IDS.region,
        trajectory: '00000000-0000-0000-0000-000000000020',
        sectional: false,
        tolerance: 1e-7,
        body_type: 'solid',
        relative_to: 'trajectory_curve',
      },
    })

    expect(manager.getSolidCount()).toBe(1)
    expect(manager.exportLastBrep()?.length).toBeGreaterThan(0)
  })

  it('lofts two line-based regions', async () => {
    const manager = new OpenCascadeCommandManager()
    await buildRectangleRegionInput(manager, {
      path: '00000000-0000-0000-0000-000000000030',
      region: '00000000-0000-0000-0000-000000000031',
      z: 0,
    })
    await buildRectangleRegionInput(manager, {
      path: '00000000-0000-0000-0000-000000000032',
      region: '00000000-0000-0000-0000-000000000033',
      z: 3,
      size: 0.5,
    })

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: IDS.solid,
      cmd: {
        type: 'loft',
        section_ids: [
          '00000000-0000-0000-0000-000000000031',
          '00000000-0000-0000-0000-000000000033',
        ],
        v_degree: 2,
        bez_approximate_rational: false,
        base_curve_index: null,
        tolerance: 1e-7,
        body_type: 'solid',
      },
    })

    expect(manager.getSolidCount()).toBe(1)
    expect(manager.exportLastBrep()?.length).toBeGreaterThan(0)
  })

  it.each([
    ['circle-region-extrude', OPEN_CASCADE_CIRCLE_EXTRUDE_KCL, 'extrude001'],
    ['revolve', OPEN_CASCADE_REVOLVE_KCL, 'sketch001'],
    ['sweep', OPEN_CASCADE_SWEEP_KCL, 'profile001'],
    ['loft', OPEN_CASCADE_LOFT_KCL, 'loft001'],
  ])(
    'executes the %s KCL proof through WASM',
    async (_, code, variableName) => {
      const { instance, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const ast = assertParse(code, instance)

      const execState = await rustContext.execute(ast, {
        settings: { modeling: { engine: 'open_cascade' } },
      })

      expect(execState.variables[variableName]?.type).toBe('Solid')
      const manager = OpenCascadeCommandManager.latestInstance()
      expect(manager?.getSolidCount()).toBeGreaterThan(0)
      expect(manager?.exportLastBrep()?.length).toBeGreaterThan(0)
      const glbBytes = await manager?.exportLatestGlbBytes()
      expect(glbBytes?.length).toBeGreaterThan(0)
    }
  )
})

async function buildCircleRegionInput(manager: OpenCascadeCommandManager) {
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
}

async function createRegion(manager: OpenCascadeCommandManager) {
  return send(manager, IDS.request, {
    type: 'modeling_cmd_req',
    cmd_id: IDS.region,
    cmd: {
      type: 'create_region_from_query_point',
      object_id: IDS.path,
      query_point: { x: 0, y: 0 },
    },
  })
}

async function buildRectangleRegionInput(
  manager: OpenCascadeCommandManager,
  options: {
    path?: string
    region?: string
    z?: number
    size?: number
  } = {}
) {
  const path = options.path || IDS.path
  const region = options.region || IDS.region
  const z = options.z || 0
  const size = options.size || 1

  await send(manager, IDS.request, {
    type: 'modeling_cmd_batch_req',
    requests: [
      {
        cmd_id: IDS.plane,
        cmd: {
          type: 'make_plane',
          clobber: false,
          origin: { x: 0, y: 0, z },
          x_axis: { x: 1, y: 0, z: 0 },
          y_axis: { x: 0, y: 1, z: 0 },
          size: 10,
        },
      },
      {
        cmd_id: '00000000-0000-0000-0000-000000000040',
        cmd: { type: 'enable_sketch_mode', entity_id: IDS.plane },
      },
      { cmd_id: path, cmd: { type: 'start_path' } },
      {
        cmd_id: '00000000-0000-0000-0000-000000000041',
        cmd: { type: 'move_path_pen', path, to: { x: -size, y: -size, z: 0 } },
      },
      {
        cmd_id: '00000000-0000-0000-0000-000000000042',
        cmd: {
          type: 'extend_path',
          path,
          segment: {
            type: 'line',
            end: { x: size, y: -size, z: 0 },
            relative: false,
          },
        },
      },
      {
        cmd_id: '00000000-0000-0000-0000-000000000043',
        cmd: {
          type: 'extend_path',
          path,
          segment: {
            type: 'line',
            end: { x: size, y: size, z: 0 },
            relative: false,
          },
        },
      },
      {
        cmd_id: '00000000-0000-0000-0000-000000000044',
        cmd: {
          type: 'extend_path',
          path,
          segment: {
            type: 'line',
            end: { x: -size, y: size, z: 0 },
            relative: false,
          },
        },
      },
      {
        cmd_id: '00000000-0000-0000-0000-000000000045',
        cmd: { type: 'close_path', path_id: path },
      },
    ],
  })

  await send(manager, IDS.request, {
    type: 'modeling_cmd_req',
    cmd_id: region,
    cmd: {
      type: 'create_region_from_query_point',
      object_id: path,
      query_point: { x: 0, y: 0 },
    },
  })
}

async function buildLineTrajectory(
  manager: OpenCascadeCommandManager,
  path: string
) {
  await send(manager, IDS.request, {
    type: 'modeling_cmd_batch_req',
    requests: [
      { cmd_id: path, cmd: { type: 'start_path' } },
      {
        cmd_id: '00000000-0000-0000-0000-000000000050',
        cmd: { type: 'move_path_pen', path, to: { x: 0, y: 0, z: 0 } },
      },
      {
        cmd_id: '00000000-0000-0000-0000-000000000051',
        cmd: {
          type: 'extend_path',
          path,
          segment: { type: 'line', end: { x: 0, y: 0, z: 5 }, relative: false },
        },
      },
    ],
  })
}

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

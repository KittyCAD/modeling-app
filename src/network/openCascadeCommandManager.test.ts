import { decode as msgpackDecode } from '@msgpack/msgpack'
import { describe, expect, it, vi } from 'vitest'

import { assertParse } from '@src/lang/wasm'
import { OpenCascadeCommandManager } from '@src/network/openCascadeCommandManager'
import {
  OPEN_CASCADE_BOOLEAN_INTERSECT_KCL,
  OPEN_CASCADE_BOOLEAN_SUBTRACT_EDGE_FILLET_REPRO_KCL,
  OPEN_CASCADE_BOOLEAN_SPLIT_KCL,
  OPEN_CASCADE_BOOLEAN_SUBTRACT_KCL,
  OPEN_CASCADE_BOOLEAN_UNION_KCL,
  OPEN_CASCADE_BIDIRECTIONAL_EXTRUDE_KCL,
  OPEN_CASCADE_BIDIRECTIONAL_REVOLVE_KCL,
  OPEN_CASCADE_CHAMFER_KCL,
  OPEN_CASCADE_CIRCLE_EXTRUDE_KCL,
  OPEN_CASCADE_FILLET_KCL,
  OPEN_CASCADE_HELIX_KCL,
  OPEN_CASCADE_HELIX_SWEEP_KCL,
  OPEN_CASCADE_INTERSECTING_REGION_EXTRUDE_KCL,
  OPEN_CASCADE_LOFT_KCL,
  OPEN_CASCADE_OFFSET_PLANE_KCL,
  OPEN_CASCADE_PATTERN_KCL,
  OPEN_CASCADE_REVOLVE_KCL,
  OPEN_CASCADE_SHELL_KCL,
  OPEN_CASCADE_SKETCH_V2_CIRCLE_KCL,
  OPEN_CASCADE_SKETCH_V2_RECTANGLE_KCL,
  OPEN_CASCADE_SKETCH_ON_FACE_MERGE_EXTRUDE_KCL,
  OPEN_CASCADE_SKETCH_ON_FACE_NEW_EXTRUDE_KCL,
  OPEN_CASCADE_SWEEP_KCL,
  OPEN_CASCADE_SYMMETRIC_EXTRUDE_KCL,
  OPEN_CASCADE_SYMMETRIC_REVOLVE_KCL,
  OPEN_CASCADE_TRANSFORM_KCL,
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
  it('exports visible make_plane commands as OpenCascade plane meshes', async () => {
    const manager = new OpenCascadeCommandManager()

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: IDS.plane,
      cmd: {
        type: 'make_plane',
        clobber: false,
        origin: { x: 0, y: 0, z: 4 },
        x_axis: { x: 1, y: 0, z: 0 },
        y_axis: { x: 0, y: 0, z: 1 },
        size: 10,
      },
    })

    expect(manager.exportLatestPlaneMeshes()).toEqual({
      version: 1,
      planes: [
        {
          planeId: IDS.plane,
          origin: { x: 0, y: 0, z: 4 },
          xAxis: { x: 1, y: 0, z: 0 },
          yAxis: { x: 0, y: 0, z: 1 },
          normal: { x: 0, y: -1, z: 0 },
        },
      ],
    })

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-00000000000c',
      cmd: {
        type: 'enable_sketch_mode',
        entity_id: IDS.plane,
      },
    })

    expect(manager.exportLatestPlaneMeshes().planes).toHaveLength(0)

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-00000000000b',
      cmd: {
        type: 'object_visible',
        object_id: IDS.plane,
        hidden: true,
      },
    })

    expect(manager.exportLatestPlaneMeshes().planes).toHaveLength(0)
  })

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
    const endCapId = topologyMeshes.solids[0].groups.find(
      (group) => group.role === 'endCap'
    )?.topologyId
    expect(endCapId).toBeTruthy()
    if (!endCapId) {
      throw new Error('No circular extrusion end cap id')
    }
    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e4',
      cmd: {
        type: 'enable_sketch_mode',
        entity_id: endCapId,
        adjust_camera: false,
        animated: false,
        ortho: false,
      },
    })
    const sketchPlaneResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e5',
      cmd: { type: 'get_sketch_mode_plane' },
    })
    const sketchPlane = sketchPlaneResponse.resp.data.modeling_response.data
    expect(sketchPlane.origin.z).toBeCloseTo(5)
    expect(
      Math.hypot(
        sketchPlane.z_axis.x,
        sketchPlane.z_axis.y,
        sketchPlane.z_axis.z
      )
    ).toBeCloseTo(1)
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

  it('exports visible OpenCascade solids as STEP, STL, OBJ, and PLY', async () => {
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

    const stepResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000a1',
      cmd: {
        type: 'export',
        entity_ids: [],
        format: { type: 'step', units: 'mm' },
      },
    })
    const stepFile = stepResponse.resp.data.files[0]
    expect(stepResponse.resp.type).toBe('export')
    expect(stepFile.name).toBe('open-cascade.step')
    expect(
      new TextDecoder().decode(new Uint8Array(stepFile.contents))
    ).toContain('ISO-10303')

    const stlResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000a2',
      cmd: {
        type: 'export',
        entity_ids: [],
        format: { type: 'stl', storage: 'ascii', units: 'mm' },
      },
    })
    const stlFile = stlResponse.resp.data.files[0]
    expect(stlResponse.resp.type).toBe('export')
    expect(stlFile.name).toBe('open-cascade.stl')
    expect(
      new TextDecoder().decode(new Uint8Array(stlFile.contents))
    ).toContain('solid')

    const objResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000a3',
      cmd: {
        type: 'export',
        entity_ids: [],
        format: { type: 'obj', units: 'mm' },
      },
    })
    const objText = new TextDecoder().decode(
      new Uint8Array(objResponse.resp.data.files[0].contents)
    )
    expect(objResponse.resp.data.files[0].name).toBe('open-cascade.obj')
    expect(objText).toContain('\nv ')
    expect(objText).toContain('\nf ')

    const plyResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000a4',
      cmd: {
        type: 'export',
        entity_ids: [],
        format: { type: 'ply', storage: 'ascii', units: 'mm' },
      },
    })
    const plyText = new TextDecoder().decode(
      new Uint8Array(plyResponse.resp.data.files[0].contents)
    )
    expect(plyResponse.resp.data.files[0].name).toBe('open-cascade.ply')
    expect(plyText).toContain('element vertex')
    expect(plyText).toContain('element face')
  })

  it('uses per-command source ranges so imported solids carry render provenance', async () => {
    const manager = new OpenCascadeCommandManager()

    await buildRectangleRegionInput(manager)

    await send(
      manager,
      IDS.request,
      {
        type: 'modeling_cmd_batch_req',
        requests: [
          {
            cmd_id: IDS.solid,
            cmd: {
              type: 'extrude',
              target: IDS.region,
              distance: 5,
              extrude_method: 'new',
              body_type: 'solid',
            },
          },
        ],
      },
      JSON.stringify({ [IDS.solid]: [12, 34, 1] })
    )

    const [visibleSolid] = await manager.exportVisibleGlbBytes()
    expect(visibleSolid.provenance).toEqual({
      imported: true,
      sourceRange: [12, 34, 1],
      moduleId: 1,
    })
    const [topologySolid] = manager.exportLatestTopologyMeshes().solids
    expect(topologySolid.provenance).toEqual(visibleSolid.provenance)
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

  it('builds symmetric and bidirectional OpenCascade extrudes as opposing fused prisms', async () => {
    const extrudeVolume = async (opposite?: unknown) => {
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
          ...(opposite === undefined ? {} : { opposite }),
        },
      })
      expect(manager.getSolidCount()).toBe(1)
      expect((await manager.exportLatestGlbBytes()).length).toBeGreaterThan(0)
      return getVolume(manager, IDS.solid)
    }

    const oneWayVolume = await extrudeVolume()
    const symmetricVolume = await extrudeVolume('Symmetric')
    const bidirectionalVolume = await extrudeVolume({ Other: 1 })

    expect(symmetricVolume).toBeGreaterThan(oneWayVolume * 1.9)
    expect(symmetricVolume).toBeLessThan(oneWayVolume * 2.1)
    expect(bidirectionalVolume).toBeGreaterThan(oneWayVolume * 1.4)
    expect(bidirectionalVolume).toBeLessThan(oneWayVolume * 1.6)
  })

  it('treats symmetric OpenCascade revolve angle as the full included angle', async () => {
    const revolveVolume = async (opposite?: unknown) => {
      const manager = new OpenCascadeCommandManager()
      await buildRectangleRegionInput(manager, {
        min: { x: 2, y: 0 },
        max: { x: 3, y: 1 },
      })
      await send(manager, IDS.request, {
        type: 'modeling_cmd_req',
        cmd_id: IDS.solid,
        cmd: {
          type: 'revolve',
          target: IDS.region,
          origin: { x: 0, y: 0, z: 0 },
          axis: { x: 0, y: 1, z: 0 },
          axis_is_2d: true,
          angle: { unit: 'degrees', value: 90 },
          tolerance: 1e-7,
          opposite: opposite ?? 'None',
          body_type: 'solid',
        },
      })
      expect(manager.getSolidCount()).toBe(1)
      expect((await manager.exportLatestGlbBytes()).length).toBeGreaterThan(0)
      return getVolume(manager, IDS.solid)
    }

    const oneWayVolume = await revolveVolume()
    const symmetricVolume = await revolveVolume('Symmetric')
    const bidirectionalVolume = await revolveVolume({
      Other: { unit: 'degrees', value: 45 },
    })

    expect(symmetricVolume).toBeGreaterThan(oneWayVolume * 0.9)
    expect(symmetricVolume).toBeLessThan(oneWayVolume * 1.1)
    expect(bidirectionalVolume).toBeGreaterThan(oneWayVolume * 1.4)
    expect(bidirectionalVolume).toBeLessThan(oneWayVolume * 1.6)
  })

  it('executes past an OpenCascade rollback marker while exporting pre-marker render state', async () => {
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
    await manager.recordRollbackMarker(JSON.stringify([10, 16, 0]))

    await buildRectangleRegionInput(manager, {
      path: '00000000-0000-0000-0000-000000000101',
      region: '00000000-0000-0000-0000-000000000102',
      commandStart: 300,
      min: { x: 3, y: 3 },
      max: { x: 4, y: 4 },
    })
    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-000000000103',
      cmd: {
        type: 'extrude',
        target: '00000000-0000-0000-0000-000000000102',
        distance: 2,
        extrude_method: 'new',
        body_type: 'solid',
      },
    })

    expect(manager.getSolidCount()).toBe(2)
    expect(
      (await manager.exportVisibleGlbBytes()).map((glb) => glb.solidId)
    ).toEqual([IDS.solid])
    expect(manager.exportLatestTopologyMeshes().solids).toHaveLength(1)
  })

  it('returns operations after an OpenCascade rollback marker', async () => {
    const { instance, rustContext, settingsActor } =
      await buildTheWorldAndNoEngineConnection()
    await vi.waitFor(() =>
      expect(settingsActor.getSnapshot().value).toBe('idle')
    )
    settingsActor.send({
      type: 'set.modeling.engine',
      data: { level: 'user', value: 'open_cascade' },
      doNotPersist: true,
    })
    const code = `@settings(experimentalFeatures = allow)
part001 = startSketchOn(XY)
  |> startProfile(at = [-1, -1])
  |> line(end = [2, 0])
  |> line(end = [0, 2])
  |> line(end = [-2, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 1)

exit()

part002 = startSketchOn(XY)
  |> startProfile(at = [3, 3])
  |> line(end = [1, 0])
  |> line(end = [0, 1])
  |> line(end = [-1, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 1)
`
    const ast = assertParse(code, instance)

    const execState = await rustContext.execute(ast, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(execState.variables.part002?.type).toBe('Solid')
    const exitOffset = code.indexOf('exit()')
    expect(
      execState.operations.some(
        (operation) =>
          'sourceRange' in operation && operation.sourceRange[0] > exitOffset
      )
    ).toBe(true)
    const manager = OpenCascadeCommandManager.latestInstance()
    expect(manager?.getSolidCount()).toBe(2)
    expect(
      (await manager?.exportVisibleGlbBytes())?.map((glb) => glb.solidId)
    ).toEqual([expect.any(String)])
  })

  it('resolves OpenCascade edge IDs by index and closest point aliases', async () => {
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

    const topologyEdge = manager.exportLatestTopologyMeshes().solids[0].edges[0]
    const edgeUuidResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e0',
      cmd: {
        type: 'solid3d_get_edge_uuid',
        object_id: IDS.path,
        edge_index: topologyEdge.edgeIndex,
      },
    })
    expect(edgeUuidResponse.resp.data.modeling_response.data.edge_id).toBe(
      topologyEdge.topologyId
    )

    const topologyFace =
      manager.exportLatestTopologyMeshes().solids[0].groups[1]
    const faceUuidResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e2',
      cmd: {
        type: 'solid3d_get_face_uuid',
        object_id: IDS.path,
        face_index: 1,
      },
    })
    expect(faceUuidResponse.resp.data.modeling_response.data.face_id).toBe(
      topologyFace.topologyId
    )

    const faceIsPlanarResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e4',
      cmd: {
        type: 'face_is_planar',
        object_id: topologyFace.topologyId,
      },
    })
    const facePlane = faceIsPlanarResponse.resp.data.modeling_response.data
    expect(facePlane.origin).toBeTruthy()
    expect(facePlane.x_axis).toBeTruthy()
    expect(facePlane.y_axis).toBeTruthy()
    expect(facePlane.z_axis).toBeTruthy()

    const closestEdgeResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e3',
      cmd: {
        type: 'closest_edge',
        object_id: IDS.path,
        closest_to: { x: -1, y: -1, z: 0 },
      },
    })
    expect(
      closestEdgeResponse.resp.data.modeling_response.data.edge_id
    ).toBeTruthy()
  })

  it('fillets and chamfers selected OpenCascade extrude edges', async () => {
    const filletManager = new OpenCascadeCommandManager()
    await buildRectangleRegionInput(filletManager)
    await send(filletManager, IDS.request, {
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
    const filletEdgeId =
      filletManager.exportLatestTopologyMeshes().solids[0].edges[0].topologyId
    const filletStartVolume = await getVolume(filletManager, IDS.solid)
    await send(filletManager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e2',
      cmd: {
        type: 'solid3d_fillet_edge',
        object_id: IDS.solid,
        edge_id: filletEdgeId,
        edge_ids: [],
        radius: 0.2,
        tolerance: 1e-7,
        cut_type: 'fillet',
        extra_face_ids: [],
      },
    })
    expect(filletManager.getSolidCount()).toBe(1)
    expect(filletManager.exportLastBrep()?.length).toBeGreaterThan(0)
    expect((await filletManager.exportLatestGlbBytes()).length).toBeGreaterThan(
      0
    )
    const filletTopology = filletManager.exportLatestTopologyMeshes().solids[0]
    expect(filletTopology.solidId).toBe(IDS.solid)
    expect(filletTopology.groups.length).toBeGreaterThan(0)
    expect(filletTopology.edges.length).toBeGreaterThan(0)
    expect(
      filletTopology.groups.every((group) => isUuidLike(group.topologyId))
    ).toBe(true)
    expect(
      filletTopology.edges.some((edge) => edge.topologyId === filletEdgeId)
    ).toBe(false)
    expect(await getVolume(filletManager, IDS.solid)).toBeLessThan(
      filletStartVolume
    )

    const chamferManager = new OpenCascadeCommandManager()
    await buildRectangleRegionInput(chamferManager)
    await send(chamferManager, IDS.request, {
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
    const chamferEdgeId =
      chamferManager.exportLatestTopologyMeshes().solids[0].edges[0].topologyId
    const chamferStartVolume = await getVolume(chamferManager, IDS.solid)
    await send(chamferManager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e3',
      cmd: {
        type: 'solid3d_cut_edges',
        object_id: IDS.solid,
        edge_ids: [chamferEdgeId],
        tolerance: 1e-7,
        cut_type: {
          chamfer: {
            distance: 0.2,
            second_distance: null,
            angle: null,
            swap: false,
          },
        },
        extra_face_ids: [],
      },
    })
    expect(chamferManager.getSolidCount()).toBe(1)
    expect(chamferManager.exportLastBrep()?.length).toBeGreaterThan(0)
    expect(
      (await chamferManager.exportLatestGlbBytes()).length
    ).toBeGreaterThan(0)
    const chamferTopology =
      chamferManager.exportLatestTopologyMeshes().solids[0]
    expect(chamferTopology.solidId).toBe(IDS.solid)
    expect(chamferTopology.groups.length).toBeGreaterThan(0)
    expect(chamferTopology.edges.length).toBeGreaterThan(0)
    expect(
      chamferTopology.edges.some((edge) => edge.topologyId === chamferEdgeId)
    ).toBe(false)
    expect(await getVolume(chamferManager, IDS.solid)).toBeLessThan(
      chamferStartVolume
    )
  })

  it('shells a selected OpenCascade extrude face', async () => {
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
    const endCapId = manager
      .exportLatestTopologyMeshes()
      .solids[0].groups.find((group) => group.role === 'endCap')?.topologyId
    expect(endCapId).toBeTruthy()
    if (!endCapId) {
      throw new Error('No end cap face found for shell test')
    }
    const startVolume = await getVolume(manager, IDS.solid)

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e6',
      cmd: {
        type: 'solid3d_shell_face',
        object_id: IDS.solid,
        face_ids: [endCapId],
        shell_thickness: 0.25,
        hollow: false,
      },
    })

    expect(manager.getSolidCount()).toBe(1)
    expect(manager.exportLastBrep()?.length).toBeGreaterThan(0)
    expect((await manager.exportLatestGlbBytes()).length).toBeGreaterThan(0)
    expect(await getVolume(manager, IDS.solid)).toBeLessThan(startVolume)
  })

  it('exports capless surface extrudes and reports their body type', async () => {
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
        body_type: 'surface',
      },
    })

    const bodyTypeResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e7',
      cmd: {
        type: 'solid3d_get_body_type',
        object_id: IDS.solid,
      },
    })
    expect(bodyTypeResponse.resp.data.modeling_response.data.body_type).toBe(
      'surface'
    )
    const topology = manager.exportLatestTopologyMeshes().solids[0]
    expect(topology.groups.length).toBeGreaterThan(0)
    expect(topology.groups.every((group) => group.role === 'wall')).toBe(true)
    expect((await manager.exportVisibleGlbBytes())[0]?.bodyType).toBe('surface')
    expect((await manager.exportLatestGlbBytes()).length).toBeGreaterThan(0)
  })

  it('deletes faces into a surface body and can flip and join it', async () => {
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
    const endCapId = manager
      .exportLatestTopologyMeshes()
      .solids[0].groups.find((group) => group.role === 'endCap')?.topologyId
    expect(endCapId).toBeTruthy()
    if (!endCapId) {
      throw new Error('No end cap face found for deleteFace test')
    }

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e8',
      cmd: {
        type: 'entity_delete_children',
        entity_id: IDS.solid,
        child_entity_ids: [endCapId],
      },
    })
    const surfaceTypeResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e9',
      cmd: { type: 'solid3d_get_body_type', object_id: IDS.solid },
    })
    expect(surfaceTypeResponse.resp.data.modeling_response.data.body_type).toBe(
      'surface'
    )
    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000ea',
      cmd: { type: 'solid3d_flip', object_id: IDS.solid },
    })
    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000eb',
      cmd: { type: 'solid3d_join', object_id: IDS.solid },
    })
    expect(manager.getSolidCount()).toBe(1)
    expect(
      manager.exportLatestTopologyMeshes().solids[0].groups.length
    ).toBeGreaterThan(0)
    expect((await manager.exportLatestGlbBytes()).length).toBeGreaterThan(0)
  })

  it('applies OpenCascade object transforms to solids and pick topology', async () => {
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

    const beforeMesh = manager.exportLatestTopologyMeshes().solids[0]
    const beforeBounds = boundsForFlattenedPoints(beforeMesh.positions)
    const beforeVolume = await getVolume(manager, IDS.solid)

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e4',
      cmd: {
        type: 'set_object_transform',
        object_id: IDS.solid,
        transforms: [
          {
            translate: {
              property: { x: 3, y: -2, z: 1 },
              set: false,
              origin: { type: 'local' },
            },
            rotate_rpy: null,
            rotate_angle_axis: null,
            scale: null,
          },
        ],
      },
    })

    const translatedBounds = boundsForFlattenedPoints(
      manager.exportLatestTopologyMeshes().solids[0].positions
    )
    expect(translatedBounds.min.x).toBeCloseTo(beforeBounds.min.x + 3)
    expect(translatedBounds.min.y).toBeCloseTo(beforeBounds.min.y - 2)
    expect(translatedBounds.min.z).toBeCloseTo(beforeBounds.min.z + 1)
    expect(await getVolume(manager, IDS.solid)).toBeCloseTo(beforeVolume)

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e5',
      cmd: {
        type: 'set_object_transform',
        object_id: IDS.solid,
        transforms: [
          {
            translate: null,
            rotate_rpy: null,
            rotate_angle_axis: null,
            scale: {
              property: { x: 2, y: 2, z: 2 },
              set: false,
              origin: { type: 'local' },
            },
          },
        ],
      },
    })

    expect(await getVolume(manager, IDS.solid)).toBeCloseTo(beforeVolume * 8)
  })

  it('applies OpenCascade object transforms to sketch line geometry', async () => {
    const manager = new OpenCascadeCommandManager()
    await buildRectangleRegionInput(manager)
    const beforeBounds = boundsForFlattenedPoints(
      manager
        .exportLatestSketchLineMeshes()
        .segments.flatMap((segment) => segment.points)
    )

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000e6',
      cmd: {
        type: 'set_object_transform',
        object_id: IDS.path,
        transforms: [
          {
            translate: {
              property: { x: 5, y: 0, z: 0 },
              set: false,
              origin: { type: 'local' },
            },
            rotate_rpy: null,
            rotate_angle_axis: null,
            scale: null,
          },
        ],
      },
    })

    const afterBounds = boundsForFlattenedPoints(
      manager
        .exportLatestSketchLineMeshes()
        .segments.flatMap((segment) => segment.points)
    )
    expect(afterBounds.min.x).toBeCloseTo(beforeBounds.min.x + 5)

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
    expect((await manager.exportLatestGlbBytes()).length).toBeGreaterThan(0)
  })

  it('patterns OpenCascade solids with transformed topology provenance', async () => {
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

    const beforeMesh = manager.exportLatestTopologyMeshes().solids[0]
    const beforeBounds = boundsForFlattenedPoints(beforeMesh.positions)
    const response = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000f1',
      cmd: {
        type: 'entity_linear_pattern_transform',
        entity_id: IDS.solid,
        transform: [],
        transforms: [
          [
            {
              translate: { x: 3, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              rotation: {
                axis: { x: 0, y: 0, z: 1 },
                angle: { unit: 'degrees', value: 0 },
                origin: { type: 'local' },
              },
              replicate: true,
            },
          ],
          [
            {
              translate: { x: 6, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              rotation: {
                axis: { x: 0, y: 0, z: 1 },
                angle: { unit: 'degrees', value: 0 },
                origin: { type: 'local' },
              },
              replicate: true,
            },
          ],
        ],
      },
    })

    const copyIds =
      response.resp.data.modeling_response.data.entity_face_edge_ids.map(
        (info: { object_id: string }) => info.object_id
      )
    expect(copyIds).toHaveLength(2)
    expect(manager.getSolidCount()).toBe(3)
    const topologyMeshes = manager.exportLatestTopologyMeshes().solids
    expect(topologyMeshes.map((mesh) => mesh.solidId)).toEqual([
      IDS.solid,
      ...copyIds,
    ])
    expect(topologyMeshes[1].artifactIds).toContain(IDS.solid)
    expect(topologyMeshes[1].groups[0].topologyId).not.toBe(
      beforeMesh.groups[0].topologyId
    )
    const firstCopyBounds = boundsForFlattenedPoints(
      topologyMeshes[1].positions
    )
    expect(firstCopyBounds.min.x).toBeCloseTo(beforeBounds.min.x + 3)
    expect(await getVolume(manager, copyIds[0])).toBeCloseTo(
      await getVolume(manager, IDS.solid)
    )
    expect(await manager.exportVisibleGlbBytes()).toHaveLength(3)
  })

  it('patterns OpenCascade solids around an axis', async () => {
    const manager = new OpenCascadeCommandManager()
    await buildRectangleRegionInput(manager, {
      min: { x: 2, y: 0 },
      max: { x: 4, y: 2 },
    })
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
    const beforeVolume = await getVolume(manager, IDS.solid)

    const response = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000f2',
      cmd: {
        type: 'entity_circular_pattern',
        entity_id: IDS.solid,
        axis: { x: 0, y: 0, z: 1 },
        center: { x: 0, y: 0, z: 0 },
        num_repetitions: 3,
        arc_degrees: 360,
        rotate_duplicates: true,
      },
    })

    const copyIds =
      response.resp.data.modeling_response.data.entity_face_edge_ids.map(
        (info: { object_id: string }) => info.object_id
      )
    expect(copyIds).toHaveLength(3)
    expect(manager.getSolidCount()).toBe(4)
    expect(await getVolume(manager, copyIds[2])).toBeCloseTo(beforeVolume)
    expect(await manager.exportVisibleGlbBytes()).toHaveLength(4)
  })

  it('patterns OpenCascade sketch paths for later region use', async () => {
    const manager = new OpenCascadeCommandManager()
    await buildRectangleRegionInput(manager)
    const beforeSegments = manager.exportLatestSketchLineMeshes().segments

    const response = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000f3',
      cmd: {
        type: 'entity_linear_pattern_transform',
        entity_id: IDS.path,
        transform: [
          {
            translate: { x: 4, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rotation: {
              axis: { x: 0, y: 0, z: 1 },
              angle: { unit: 'degrees', value: 0 },
              origin: { type: 'local' },
            },
            replicate: true,
          },
        ],
        transforms: [],
      },
    })

    const copyId =
      response.resp.data.modeling_response.data.entity_face_edge_ids[0]
        .object_id
    const afterSegments = manager.exportLatestSketchLineMeshes().segments
    expect(afterSegments).toHaveLength(beforeSegments.length * 2)
    const copiedSegmentIds = afterSegments
      .slice(beforeSegments.length)
      .map((segment) => segment.segmentId)
    expect(copiedSegmentIds).not.toContain(beforeSegments[0].segmentId)

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000f4',
      cmd: {
        type: 'create_region_from_query_point',
        object_id: copyId,
        query_point: { x: 4, y: 0 },
      },
    })
    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000f5',
      cmd: {
        type: 'extrude',
        target: '00000000-0000-0000-0000-0000000000f4',
        distance: 1,
        extrude_method: 'new',
        body_type: 'solid',
      },
    })
    expect(manager.getSolidCount()).toBe(1)
  })

  it('exports multiple visible bodies as separate GLBs', async () => {
    const manager = new OpenCascadeCommandManager()
    await buildRectangleRegionInput(manager, {
      path: '00000000-0000-0000-0000-0000000000b1',
      region: '00000000-0000-0000-0000-0000000000b2',
      commandStart: 180,
      min: { x: -1, y: -1 },
      max: { x: 1, y: 1 },
    })
    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000b3',
      cmd: {
        type: 'extrude',
        target: '00000000-0000-0000-0000-0000000000b2',
        distance: 2,
        extrude_method: 'new',
        body_type: 'solid',
      },
    })
    await buildRectangleRegionInput(manager, {
      path: '00000000-0000-0000-0000-0000000000b4',
      region: '00000000-0000-0000-0000-0000000000b5',
      commandStart: 190,
      min: { x: 0, y: 0 },
      max: { x: 2, y: 2 },
    })
    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000b6',
      cmd: {
        type: 'extrude',
        target: '00000000-0000-0000-0000-0000000000b5',
        distance: 2,
        extrude_method: 'new',
        body_type: 'solid',
      },
    })

    const visibleSolids = await manager.exportVisibleGlbBytes()
    expect(visibleSolids.map((solid) => solid.solidId)).toEqual([
      '00000000-0000-0000-0000-0000000000b3',
      '00000000-0000-0000-0000-0000000000b6',
    ])
    expect(visibleSolids.every((solid) => solid.bytes.length > 0)).toBe(true)
  })

  it('stores OpenCascade selection filters from single commands and batches', async () => {
    const manager = new OpenCascadeCommandManager()
    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000c0',
      cmd: {
        type: 'set_selection_filter',
        filter: ['object'],
      },
    })
    expect(manager.latestSelectionFilter.value).toEqual(['object'])

    await send(manager, IDS.request, {
      type: 'modeling_cmd_batch_req',
      requests: [
        {
          cmd_id: '00000000-0000-0000-0000-0000000000c1',
          cmd: {
            type: 'set_selection_filter',
            filter: ['face', 'edge'],
          },
        },
      ],
    })
    expect(manager.latestSelectionFilter.value).toEqual(['face', 'edge'])
  })

  it('returns structured OpenCascade failures for unsupported commands', async () => {
    const manager = new OpenCascadeCommandManager()
    const batchResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_batch_req',
      requests: [
        {
          cmd_id: '00000000-0000-0000-0000-0000000000c2',
          cmd: {
            type: 'open_cascade_missing_command',
          },
        },
      ],
    })

    const batchFailure =
      batchResponse.resp.data.responses['00000000-0000-0000-0000-0000000000c2']
    expect(batchFailure.errors[0]).toMatchObject({
      error_code: 'internal_api',
      message:
        'OpenCascade engine does not support open_cascade_missing_command',
    })

    const singleResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000c3',
      cmd: {
        type: 'open_cascade_missing_command',
      },
    })
    expect(singleResponse).toMatchObject({
      success: false,
      request_id: IDS.request,
      errors: [
        {
          error_code: 'internal_api',
          message:
            'OpenCascade engine does not support open_cascade_missing_command',
        },
      ],
    })
  })

  it('runs boolean union, subtract, intersect, and split commands', async () => {
    const manager = new OpenCascadeCommandManager()
    await buildTwoOverlappingExtrudes(manager)

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000d0',
      cmd: {
        type: 'boolean_union',
        solid_ids: [
          '00000000-0000-0000-0000-0000000000d3',
          '00000000-0000-0000-0000-0000000000d6',
        ],
        tolerance: 1e-7,
      },
    })
    expect(
      (await manager.exportVisibleGlbBytes()).map((solid) => solid.solidId)
    ).toEqual(['00000000-0000-0000-0000-0000000000d0'])
    const unionTopology = manager.exportLatestTopologyMeshes().solids[0]
    expect(unionTopology.solidId).toBe('00000000-0000-0000-0000-0000000000d0')
    expect(unionTopology.groups.length).toBeGreaterThan(0)
    expect(unionTopology.edges.length).toBeGreaterThan(0)

    const subtractManager = new OpenCascadeCommandManager()
    await buildTwoOverlappingExtrudes(subtractManager)
    const subtractResponse = await send(subtractManager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000d7',
      cmd: {
        type: 'boolean_subtract',
        target_ids: ['00000000-0000-0000-0000-0000000000d3'],
        tool_ids: ['00000000-0000-0000-0000-0000000000d6'],
        tolerance: 1e-7,
      },
    })
    expect(
      subtractResponse.resp.data.modeling_response.data.any_intersections
    ).toBe(true)
    expect(await subtractManager.exportVisibleGlbBytes()).toHaveLength(1)
    const subtractTopology =
      subtractManager.exportLatestTopologyMeshes().solids[0]
    expect(subtractTopology.solidId).toBe(
      '00000000-0000-0000-0000-0000000000d7'
    )
    expect(subtractTopology.groups.length).toBeGreaterThan(0)
    expect(subtractTopology.edges.length).toBeGreaterThan(0)

    const intersectManager = new OpenCascadeCommandManager()
    await buildTwoOverlappingExtrudes(intersectManager)
    await send(intersectManager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000d8',
      cmd: {
        type: 'boolean_intersection',
        solid_ids: [
          '00000000-0000-0000-0000-0000000000d3',
          '00000000-0000-0000-0000-0000000000d6',
        ],
        tolerance: 1e-7,
      },
    })
    expect(await intersectManager.exportVisibleGlbBytes()).toHaveLength(1)
    const intersectTopology =
      intersectManager.exportLatestTopologyMeshes().solids[0]
    expect(intersectTopology.solidId).toBe(
      '00000000-0000-0000-0000-0000000000d8'
    )
    expect(intersectTopology.groups.length).toBeGreaterThan(0)
    expect(intersectTopology.edges.length).toBeGreaterThan(0)

    const splitManager = new OpenCascadeCommandManager()
    await buildTwoOverlappingExtrudes(splitManager)
    await send(splitManager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000d9',
      cmd: {
        type: 'boolean_imprint',
        body_ids: ['00000000-0000-0000-0000-0000000000d3'],
        tool_ids: ['00000000-0000-0000-0000-0000000000d6'],
        separate_bodies: true,
        keep_tools: true,
        tolerance: 1e-7,
      },
    })
    expect(
      (await splitManager.exportVisibleGlbBytes()).map((solid) => solid.solidId)
    ).toEqual([
      '00000000-0000-0000-0000-0000000000d6',
      '00000000-0000-0000-0000-0000000000d9',
    ])
  })

  it('returns sketch mode plane details for default planes and extrude faces', async () => {
    const manager = new OpenCascadeCommandManager()
    await buildRectangleRegionInput(manager)

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-000000000062',
      cmd: {
        type: 'enable_sketch_mode',
        entity_id: IDS.plane,
        adjust_camera: false,
        animated: false,
        ortho: false,
      },
    })
    const defaultPlaneResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-000000000063',
      cmd: { type: 'get_sketch_mode_plane' },
    })
    expect(
      defaultPlaneResponse.resp.data.modeling_response.data.z_axis.z
    ).toBeCloseTo(1)

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
    const wallFaceId = manager
      .exportLatestTopologyMeshes()
      .solids[0].groups.find((group) => group.role === 'wall')?.topologyId
    expect(wallFaceId).toBeTruthy()
    if (!wallFaceId) {
      throw new Error('No wall face id')
    }
    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-000000000064',
      cmd: {
        type: 'enable_sketch_mode',
        entity_id: wallFaceId,
        adjust_camera: false,
        animated: false,
        ortho: false,
      },
    })
    const faceResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-000000000065',
      cmd: { type: 'get_sketch_mode_plane' },
    })
    const normal = faceResponse.resp.data.modeling_response.data.z_axis
    expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1)
  })

  it('merges a default sketch-on-face extrude into its parent solid', async () => {
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
    const endFaceId = manager
      .exportLatestTopologyMeshes()
      .solids[0].groups.find((group) => group.role === 'endCap')?.topologyId
    expect(endFaceId).toBeTruthy()
    if (!endFaceId) {
      throw new Error('No end cap face id')
    }

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-000000000090',
      cmd: {
        type: 'enable_sketch_mode',
        entity_id: endFaceId,
        adjust_camera: false,
        animated: false,
        ortho: false,
      },
    })
    await buildRectangleOnActiveSketchPlane(manager, {
      path: '00000000-0000-0000-0000-000000000091',
      region: '00000000-0000-0000-0000-000000000092',
      commandStart: 93,
      min: { x: -0.5, y: -0.5 },
      max: { x: 0.5, y: 0.5 },
    })

    const mergedExtrudeId = '00000000-0000-0000-0000-000000000099'
    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: mergedExtrudeId,
      cmd: {
        type: 'extrude',
        target: '00000000-0000-0000-0000-000000000092',
        distance: 1,
        body_type: 'solid',
      },
    })

    expect(manager.getSolidCount()).toBe(1)
    expect(manager.exportLastBrep()?.length).toBeGreaterThan(0)
    const topologyMeshes = manager.exportLatestTopologyMeshes()
    expect(topologyMeshes.solids).toHaveLength(1)
    expect(topologyMeshes.solids[0].solidId).toBe(IDS.solid)
    expect(
      topologyMeshes.solids[0].groups.some(
        (group) => group.topologyId === `${mergedExtrudeId.slice(0, 35)}2`
      )
    ).toBe(true)

    const faceInfoResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-00000000009a',
      cmd: {
        type: 'solid3d_get_extrusion_face_info',
        object_id: mergedExtrudeId,
        edge_id: '00000000-0000-0000-0000-000000000095',
      },
    })
    expect(
      faceInfoResponse.resp.data.modeling_response.data.faces.map(
        (face: { cap: string }) => face.cap
      )
    ).toEqual(['none', 'bottom', 'top'])
  })

  it('keeps a method NEW sketch-on-face extrude as a separate solid', async () => {
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
    const endFaceId = manager
      .exportLatestTopologyMeshes()
      .solids[0].groups.find((group) => group.role === 'endCap')?.topologyId
    expect(endFaceId).toBeTruthy()
    if (!endFaceId) {
      throw new Error('No end cap face id')
    }

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-0000000000a0',
      cmd: {
        type: 'enable_sketch_mode',
        entity_id: endFaceId,
        adjust_camera: false,
        animated: false,
        ortho: false,
      },
    })
    await buildRectangleOnActiveSketchPlane(manager, {
      path: '00000000-0000-0000-0000-0000000000a1',
      region: '00000000-0000-0000-0000-0000000000a2',
      commandStart: 163,
      min: { x: -0.5, y: -0.5 },
      max: { x: 0.5, y: 0.5 },
    })

    const newExtrudeId = '00000000-0000-0000-0000-0000000000a9'
    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: newExtrudeId,
      cmd: {
        type: 'extrude',
        target: '00000000-0000-0000-0000-0000000000a2',
        distance: 1,
        extrude_method: 'new',
        body_type: 'solid',
      },
    })

    expect(manager.getSolidCount()).toBe(2)
    const topologyMeshes = manager.exportLatestTopologyMeshes()
    expect(topologyMeshes.solids.map((solid) => solid.solidId)).toEqual([
      IDS.solid,
      newExtrudeId,
    ])
    expect((await manager.exportLatestGlbBytes()).length).toBeGreaterThan(0)
  })

  it('detects a closed rectangle as an automatic pickable region', async () => {
    const manager = new OpenCascadeCommandManager()
    await buildRectangleRegionInput(manager, { createRegion: false })

    const regionMeshes = await manager.exportLatestRegionMeshes()
    expect(regionMeshes.regions).toHaveLength(1)
    const region = regionMeshes.regions[0]
    expect(region.groups[0].parentPathId).toBe(IDS.path)
    expect(region.groups[0].queryPoint.x).toBeCloseTo(0)
    expect(region.groups[0].queryPoint.y).toBeCloseTo(0)

    const queryPointResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-000000000060',
      cmd: {
        type: 'region_get_query_point',
        region_id: region.regionId,
      },
    })
    expect(
      queryPointResponse.resp.data.modeling_response.data.query_point.x
    ).toBeCloseTo(0)

    const parentResponse = await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-000000000061',
      cmd: {
        type: 'entity_get_parent_id',
        entity_id: region.regionId,
      },
    })
    expect(parentResponse.resp.data.modeling_response.data.entity_id).toBe(
      IDS.path
    )
  })

  it('detects multiple bounded regions from overlapping rectangles', async () => {
    const manager = new OpenCascadeCommandManager()
    await buildRectangleRegionInput(manager, {
      createRegion: false,
      path: '00000000-0000-0000-0000-000000000070',
      commandStart: 70,
      min: { x: 0, y: 0 },
      max: { x: 2, y: 2 },
    })
    await buildRectangleRegionInput(manager, {
      createRegion: false,
      path: '00000000-0000-0000-0000-000000000080',
      commandStart: 80,
      min: { x: 1, y: 1 },
      max: { x: 3, y: 3 },
    })

    const regionMeshes = await manager.exportLatestRegionMeshes()
    expect(regionMeshes.regions.length).toBeGreaterThan(1)
    expect(
      regionMeshes.regions.every((region) => region.groups[0].count > 0)
    ).toBe(true)
  })

  it('hides OpenCascade sketch line, region, and profile geometry for hidden sketches', async () => {
    const manager = new OpenCascadeCommandManager()
    await buildRectangleRegionInput(manager)

    expect(
      manager.exportLatestSketchLineMeshes().segments.length
    ).toBeGreaterThan(0)
    expect((await manager.exportLatestRegionMeshes()).regions.length).toBe(1)
    expect(
      (await manager.exportLatestProfileGlbBytes()).length
    ).toBeGreaterThan(0)

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-000000000068',
      cmd: {
        type: 'object_visible',
        object_id: IDS.plane,
        hidden: true,
      },
    })

    expect(
      manager.exportLatestSketchLineMeshes().segments.length
    ).toBeGreaterThan(0)
    expect((await manager.exportLatestRegionMeshes()).regions.length).toBe(1)
    expect(
      (await manager.exportLatestProfileGlbBytes()).length
    ).toBeGreaterThan(0)

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-000000000066',
      cmd: {
        type: 'object_visible',
        object_id: IDS.path,
        hidden: true,
      },
    })

    expect(manager.exportLatestSketchLineMeshes().segments).toHaveLength(0)
    expect((await manager.exportLatestRegionMeshes()).regions).toHaveLength(0)
    expect(await manager.exportLatestProfileGlbBytes()).toHaveLength(0)

    await send(manager, IDS.request, {
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-000000000067',
      cmd: {
        type: 'object_visible',
        object_id: IDS.path,
        hidden: false,
      },
    })

    expect(
      manager.exportLatestSketchLineMeshes().segments.length
    ).toBeGreaterThan(0)
    expect((await manager.exportLatestRegionMeshes()).regions.length).toBe(1)
    expect(
      (await manager.exportLatestProfileGlbBytes()).length
    ).toBeGreaterThan(0)
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

  it('executes a sketch on the END cap of a cylindrical extrusion', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(
      `baseSketch = sketch(on = XY) {
  circle1 = circle(start = [var 1mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([circle1.center, ORIGIN])
}
baseRegion = region(point = [0mm, 0mm], sketch = baseSketch)
cylinder = extrude(baseRegion, length = 5)
topSketch = sketch(on = startSketchOn(cylinder, face = END)) {
  circle2 = circle(start = [var 0.5mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([circle2.center, ORIGIN])
}
`,
      instance
    )

    const execState = await rustContext.execute(ast, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(execState.variables.cylinder?.type).toBe('Solid')
    expect(execState.variables.topSketch).toBeTruthy()
    const manager = OpenCascadeCommandManager.latestInstance()
    expect(
      manager?.exportLatestSketchLineMeshes().segments.length
    ).toBeGreaterThan(0)
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
    [
      'intersecting-region-extrude',
      OPEN_CASCADE_INTERSECTING_REGION_EXTRUDE_KCL,
      'extrude001',
    ],
    ['revolve', OPEN_CASCADE_REVOLVE_KCL, 'sketch001'],
    ['symmetric-revolve', OPEN_CASCADE_SYMMETRIC_REVOLVE_KCL, 'symRevolve'],
    [
      'bidirectional-revolve',
      OPEN_CASCADE_BIDIRECTIONAL_REVOLVE_KCL,
      'bidirectionalRevolve',
    ],
    ['symmetric-extrude', OPEN_CASCADE_SYMMETRIC_EXTRUDE_KCL, 'symExtrude'],
    [
      'bidirectional-extrude',
      OPEN_CASCADE_BIDIRECTIONAL_EXTRUDE_KCL,
      'bidirectionalExtrude',
    ],
    ['sweep', OPEN_CASCADE_SWEEP_KCL, 'profile001'],
    ['helix-sweep', OPEN_CASCADE_HELIX_SWEEP_KCL, 'sweep001'],
    ['loft', OPEN_CASCADE_LOFT_KCL, 'loft001'],
    [
      'sketch-on-face-merge-extrude',
      OPEN_CASCADE_SKETCH_ON_FACE_MERGE_EXTRUDE_KCL,
      'mergedExtrude',
    ],
    [
      'sketch-on-face-new-extrude',
      OPEN_CASCADE_SKETCH_ON_FACE_NEW_EXTRUDE_KCL,
      'newExtrude',
    ],
    ['boolean-union', OPEN_CASCADE_BOOLEAN_UNION_KCL, 'booleanUnion'],
    ['boolean-subtract', OPEN_CASCADE_BOOLEAN_SUBTRACT_KCL, 'booleanSubtract'],
    [
      'boolean-intersect',
      OPEN_CASCADE_BOOLEAN_INTERSECT_KCL,
      'booleanIntersect',
    ],
    ['boolean-split', OPEN_CASCADE_BOOLEAN_SPLIT_KCL, 'booleanSplit'],
    ['fillet', OPEN_CASCADE_FILLET_KCL, 'fillet001'],
    ['chamfer', OPEN_CASCADE_CHAMFER_KCL, 'chamfer001'],
    ['shell', OPEN_CASCADE_SHELL_KCL, 'shell001'],
    ['transform', OPEN_CASCADE_TRANSFORM_KCL, 'transformSolid'],
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

  it('exports selectable topology for the boolean subtract fillet regression', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(
      `${OPEN_CASCADE_BOOLEAN_SUBTRACT_EDGE_FILLET_REPRO_KCL}
edge001 = edgeId(solid001, index = 0)
fillet001 = fillet(solid001, tags = edge001, radius = 0.1)
`,
      instance
    )

    const execState = await rustContext.execute(ast, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(execState.variables.solid001?.type).toBe('Solid')
    expect(execState.variables.edge001?.type).toBe('Uuid')
    expect(execState.variables.fillet001?.type).toBe('Solid')
    const manager = OpenCascadeCommandManager.latestInstance()
    const topology = manager?.exportLatestTopologyMeshes()
    const solidTopology = topology?.solids[0]
    expect(solidTopology?.groups.length).toBeGreaterThan(0)
    expect(solidTopology?.edges.length).toBeGreaterThan(0)
    expect(
      solidTopology?.groups.every((group) => isUuidLike(group.topologyId))
    ).toBe(true)
    expect(
      solidTopology?.edges.every((edge) => isUuidLike(edge.topologyId))
    ).toBe(true)
  })

  it('executes standalone helix KCL and exports a visible path mesh', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(OPEN_CASCADE_HELIX_KCL, instance)

    const execState = await rustContext.execute(ast, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(execState.variables.helixGuide?.type).toBe('Helix')
    if (execState.variables.helixGuide?.type !== 'Helix') {
      throw new Error('Expected helixGuide to be a Helix')
    }
    const manager = OpenCascadeCommandManager.latestInstance()
    const sketchLines = manager?.exportLatestSketchLineMeshes()
    expect(sketchLines?.segments.length).toBeGreaterThan(16)
    expect(sketchLines?.segments[0]).toMatchObject({
      pathId: execState.variables.helixGuide.value.value,
      kind: 'line',
    })
  })

  it('executes the pattern KCL proof through WASM', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(OPEN_CASCADE_PATTERN_KCL, instance)

    const execState = await rustContext.execute(ast, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(execState.variables.linearPattern).toBeTruthy()
    expect(execState.variables.circularPattern).toBeTruthy()
    const manager = OpenCascadeCommandManager.latestInstance()
    expect(manager?.getSolidCount()).toBe(6)
    expect(await manager?.exportVisibleGlbBytes()).toHaveLength(6)
  })

  it('executes offsetPlane from planeOf through WASM and exports the unused plane', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(OPEN_CASCADE_OFFSET_PLANE_KCL, instance)

    const execState = await rustContext.execute(ast, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(execState.variables.extrude001?.type).toBe('Solid')
    expect(execState.variables.plane001?.type).toBe('Plane')
    const manager = OpenCascadeCommandManager.latestInstance()
    expect(manager?.getSolidCount()).toBe(1)
    expect(await manager?.exportVisibleGlbBytes()).toHaveLength(1)
    expect(manager?.exportLatestPlaneMeshes().planes).toHaveLength(1)
  })

  it('executes hidden intersecting region extrude and suppresses passive sketch and region meshes', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(
      OPEN_CASCADE_INTERSECTING_REGION_EXTRUDE_KCL,
      instance
    )

    const execState = await rustContext.execute(ast, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(execState.variables.extrude001?.type).toBe('Solid')
    const manager = OpenCascadeCommandManager.latestInstance()
    expect(manager?.getSolidCount()).toBeGreaterThan(0)
    expect(manager?.exportLatestSketchLineMeshes().segments).toHaveLength(0)
    expect((await manager?.exportLatestRegionMeshes())?.regions).toHaveLength(0)
    expect(await manager?.exportLatestProfileGlbBytes()).toHaveLength(0)
  })

  it.each([
    ['rectangle', OPEN_CASCADE_SKETCH_V2_RECTANGLE_KCL, 4],
    ['circle', OPEN_CASCADE_SKETCH_V2_CIRCLE_KCL, 1],
  ])(
    'executes the V2 sketch %s proof and exports sketch line meshes',
    async (_, code, expectedSegmentCount) => {
      const { instance, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const ast = assertParse(code, instance)

      const execState = await rustContext.execute(ast, {
        settings: { modeling: { engine: 'open_cascade' } },
      })

      expect(execState.variables.sketch001).toBeTruthy()
      const manager = OpenCascadeCommandManager.latestInstance()
      const sketchLines = manager?.exportLatestSketchLineMeshes()
      expect(sketchLines?.segments).toHaveLength(expectedSegmentCount)
      expect(
        sketchLines?.segments.every((segment) => segment.points.length >= 6)
      ).toBe(true)
    }
  )

  it('renders V1 tangentialArc endAbsolute as a curve ending at the absolute point', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(
      `@settings(defaultLengthUnit = mm)

sketch001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> tangentialArc(endAbsolute = [20, 10])
`,
      instance
    )

    await rustContext.execute(ast, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    const manager = OpenCascadeCommandManager.latestInstance()
    const sketchSegments = manager?.exportLatestSketchLineMeshes().segments
    expect(sketchSegments).toHaveLength(2)
    const arcSegment = sketchSegments?.[1]
    expect(arcSegment?.points.length).toBeGreaterThan(6)
    expectPointToBeClose(
      lastPointFromFlattenedPoints(arcSegment?.points || []),
      {
        x: 20,
        y: 10,
        z: 0,
      }
    )
  })

  it('renders V1 three-point arc as a curve', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(
      `@settings(defaultLengthUnit = mm)

sketch001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> arc(interiorAbsolute = [5, 5], endAbsolute = [10, 0])
`,
      instance
    )

    await rustContext.execute(ast, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    const manager = OpenCascadeCommandManager.latestInstance()
    const sketchSegments = manager?.exportLatestSketchLineMeshes().segments
    expect(sketchSegments).toHaveLength(1)
    expect(sketchSegments?.[0].points.length).toBeGreaterThan(6)
    expectPointToBeClose(
      lastPointFromFlattenedPoints(sketchSegments?.[0].points || []),
      {
        x: 10,
        y: 0,
        z: 0,
      }
    )
  })

  it('exports V1 curved profile region meshes from OpenCascade face triangulation', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(
      `@settings(defaultLengthUnit = mm)

profile001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> tangentialArc(endAbsolute = [18, 8])
  |> arc(interiorAbsolute = [9, 14], endAbsolute = [0, 8])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
`,
      instance
    )

    await rustContext.execute(ast, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    const manager = OpenCascadeCommandManager.latestInstance()
    const [region] = (await manager?.exportLatestRegionMeshes())?.regions || []
    expect(region?.groups[0]?.count).toBeGreaterThan(0)
    expect(region?.positions.length).toBe(region?.indices.length * 3)
    expect(region?.indices).toEqual(
      Array.from({ length: region?.indices.length || 0 }, (_, index) => index)
    )
  })

  it('revolves a complex V1 curved profile using the arrangement face fallback', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(
      `@settings(defaultLengthUnit = mm)

boltSize = 4.5

plateRevolve = startSketchOn(YZ)
  |> startProfile(at = [22.9, 0])
  |> arc(angleStart = 180, angleEnd = 176, radius = 120)
  |> arc(angleStart = -60, angleEnd = 54, radius = 5)
  |> arc(angleStart = 180, angleEnd = 176, radius = 120)
  |> arc(angleStart = -60, angleEnd = 54, radius = 5)
  |> arc(angleStart = 180, angleEnd = 176, radius = 120)
  |> arc(angleStart = -60, angleEnd = 54, radius = 5)
  |> arc(angleStart = 180, angleEnd = 174, radius = 170)
  |> tangentialArc(endAbsolute = [41.8, 91.88])
  |> tangentialArc(endAbsolute = [56.92, 117.08], tag = $seg01)
  |> angledLine(angle = tangentToEnd(seg01), length = 23.16)
  |> tangentialArc(endAbsolute = [60.93, 140.44], tag = $seg02)
  |> angledLine(angle = tangentToEnd(seg02), length = 25.65)
  |> tangentialArc(endAbsolute = [48.35, 85.53])
  |> tangentialArc(endAbsolute = [35.2, 67.73], tag = $seg03)
  |> angledLine(angle = tangentToEnd(seg03), length = 49.06)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> revolve(axis = Y, angle = 65, symmetric = true)
`,
      instance
    )

    const execState = await rustContext.execute(ast, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(execState.variables.plateRevolve?.type).toBe('Solid')
    const manager = OpenCascadeCommandManager.latestInstance()
    expect(manager?.getSolidCount()).toBe(1)
    const visibleSolids = await manager?.exportVisibleGlbBytes()
    expect(visibleSolids).toHaveLength(1)
    expect(visibleSolids?.[0].suppressMeshEdges).toBe(true)
    expect(
      manager
        ?.exportLatestTopologyMeshes()
        .solids[0].edges.some((edge) => edge.suppressed)
    ).toBe(false)
  })
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
    min?: { x: number; y: number }
    max?: { x: number; y: number }
    createRegion?: boolean
    commandStart?: number
  } = {}
) {
  const path = options.path || IDS.path
  const region = options.region || IDS.region
  const z = options.z || 0
  const size = options.size || 1
  const min = options.min || { x: -size, y: -size }
  const max = options.max || { x: size, y: size }
  const commandId = (offset: number) =>
    `00000000-0000-0000-0000-${String(
      (options.commandStart || 40) + offset
    ).padStart(12, '0')}`

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
        cmd_id: commandId(0),
        cmd: { type: 'enable_sketch_mode', entity_id: IDS.plane },
      },
      { cmd_id: path, cmd: { type: 'start_path' } },
      {
        cmd_id: commandId(1),
        cmd: { type: 'move_path_pen', path, to: { x: min.x, y: min.y, z: 0 } },
      },
      {
        cmd_id: commandId(2),
        cmd: {
          type: 'extend_path',
          path,
          segment: {
            type: 'line',
            end: { x: max.x, y: min.y, z: 0 },
            relative: false,
          },
        },
      },
      {
        cmd_id: commandId(3),
        cmd: {
          type: 'extend_path',
          path,
          segment: {
            type: 'line',
            end: { x: max.x, y: max.y, z: 0 },
            relative: false,
          },
        },
      },
      {
        cmd_id: commandId(4),
        cmd: {
          type: 'extend_path',
          path,
          segment: {
            type: 'line',
            end: { x: min.x, y: max.y, z: 0 },
            relative: false,
          },
        },
      },
      {
        cmd_id: commandId(5),
        cmd: { type: 'close_path', path_id: path },
      },
    ],
  })

  if (options.createRegion === false) {
    return
  }

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

async function buildRectangleOnActiveSketchPlane(
  manager: OpenCascadeCommandManager,
  options: {
    path: string
    region: string
    commandStart: number
    min: { x: number; y: number }
    max: { x: number; y: number }
  }
) {
  const commandId = (offset: number) =>
    `00000000-0000-0000-0000-${String(options.commandStart + offset).padStart(
      12,
      '0'
    )}`

  await send(manager, IDS.request, {
    type: 'modeling_cmd_batch_req',
    requests: [
      { cmd_id: options.path, cmd: { type: 'start_path' } },
      {
        cmd_id: commandId(0),
        cmd: {
          type: 'move_path_pen',
          path: options.path,
          to: { x: options.min.x, y: options.min.y, z: 0 },
        },
      },
      {
        cmd_id: commandId(1),
        cmd: {
          type: 'extend_path',
          path: options.path,
          segment: {
            type: 'line',
            end: { x: options.max.x, y: options.min.y, z: 0 },
            relative: false,
          },
        },
      },
      {
        cmd_id: commandId(2),
        cmd: {
          type: 'extend_path',
          path: options.path,
          segment: {
            type: 'line',
            end: { x: options.max.x, y: options.max.y, z: 0 },
            relative: false,
          },
        },
      },
      {
        cmd_id: commandId(3),
        cmd: {
          type: 'extend_path',
          path: options.path,
          segment: {
            type: 'line',
            end: { x: options.min.x, y: options.max.y, z: 0 },
            relative: false,
          },
        },
      },
      {
        cmd_id: commandId(4),
        cmd: { type: 'close_path', path_id: options.path },
      },
    ],
  })

  await send(manager, IDS.request, {
    type: 'modeling_cmd_req',
    cmd_id: options.region,
    cmd: {
      type: 'create_region_from_query_point',
      object_id: options.path,
      query_point: {
        x: (options.min.x + options.max.x) / 2,
        y: (options.min.y + options.max.y) / 2,
      },
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

async function buildTwoOverlappingExtrudes(manager: OpenCascadeCommandManager) {
  await buildRectangleRegionInput(manager, {
    path: '00000000-0000-0000-0000-0000000000d1',
    region: '00000000-0000-0000-0000-0000000000d2',
    commandStart: 210,
    min: { x: -1, y: -1 },
    max: { x: 1, y: 1 },
  })
  await send(manager, IDS.request, {
    type: 'modeling_cmd_req',
    cmd_id: '00000000-0000-0000-0000-0000000000d3',
    cmd: {
      type: 'extrude',
      target: '00000000-0000-0000-0000-0000000000d2',
      distance: 2,
      extrude_method: 'new',
      body_type: 'solid',
    },
  })
  await buildRectangleRegionInput(manager, {
    path: '00000000-0000-0000-0000-0000000000d4',
    region: '00000000-0000-0000-0000-0000000000d5',
    commandStart: 220,
    min: { x: 0, y: 0 },
    max: { x: 2, y: 2 },
  })
  await send(manager, IDS.request, {
    type: 'modeling_cmd_req',
    cmd_id: '00000000-0000-0000-0000-0000000000d6',
    cmd: {
      type: 'extrude',
      target: '00000000-0000-0000-0000-0000000000d5',
      distance: 2,
      extrude_method: 'new',
      body_type: 'solid',
    },
  })
}

async function getVolume(
  manager: OpenCascadeCommandManager,
  entityId: string
): Promise<number> {
  const response = await send(manager, IDS.request, {
    type: 'modeling_cmd_req',
    cmd_id: '00000000-0000-0000-0000-0000000000f0',
    cmd: {
      type: 'volume',
      entity_ids: [entityId],
      output_unit: 'cm3',
    },
  })
  return response.resp.data.modeling_response.data.volume
}

function boundsForFlattenedPoints(points: number[]) {
  const bounds = {
    min: {
      x: Number.POSITIVE_INFINITY,
      y: Number.POSITIVE_INFINITY,
      z: Number.POSITIVE_INFINITY,
    },
    max: {
      x: Number.NEGATIVE_INFINITY,
      y: Number.NEGATIVE_INFINITY,
      z: Number.NEGATIVE_INFINITY,
    },
  }
  for (let index = 0; index < points.length; index += 3) {
    bounds.min.x = Math.min(bounds.min.x, points[index])
    bounds.min.y = Math.min(bounds.min.y, points[index + 1])
    bounds.min.z = Math.min(bounds.min.z, points[index + 2])
    bounds.max.x = Math.max(bounds.max.x, points[index])
    bounds.max.y = Math.max(bounds.max.y, points[index + 1])
    bounds.max.z = Math.max(bounds.max.z, points[index + 2])
  }
  return bounds
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  )
}

function lastPointFromFlattenedPoints(points: number[]) {
  const lastIndex = points.length - 3
  return {
    x: points[lastIndex],
    y: points[lastIndex + 1],
    z: points[lastIndex + 2],
  }
}

function expectPointToBeClose(actual: Point3Like, expected: Point3Like) {
  expect(actual.x).toBeCloseTo(expected.x)
  expect(actual.y).toBeCloseTo(expected.y)
  expect(actual.z).toBeCloseTo(expected.z)
}

type Point3Like = { x: number; y: number; z: number }

async function send(
  manager: OpenCascadeCommandManager,
  requestId: string,
  request: unknown,
  idMap = ID_MAP
): Promise<any> {
  const encoded = await manager.sendModelingCommandFromWasm(
    requestId,
    RANGE,
    JSON.stringify(request),
    idMap
  )

  return msgpackDecode(encoded)
}

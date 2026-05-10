import type {
  BatchResponse,
  ModelingCmd,
  OkModelingCmdResponse,
  OkWebSocketResponseData,
  PathSegment,
  SourceRange,
  WebSocketRequest,
  WebSocketResponse,
} from '@kittycad/lib'
import { encode as msgpackEncode } from '@msgpack/msgpack'
import { signal } from '@preact/signals-core'
import OpenCascadeMain from 'opencascade.js/dist/opencascade.full.js'
import openCascadeWasmUrl from 'opencascade.js/dist/opencascade.full.wasm?url'

type Point2 = { x: number; y: number }
type Point3 = { x: number; y: number; z: number }
type OpenCascadeInstance = any

type PathSegmentState =
  | {
      id: string
      type: 'line'
      start: Point3
      end: Point3
    }
  | {
      id: string
      type: 'arc'
      center: Point2
      radius: number
      startAngle: number
      endAngle: number
      fullCircle: boolean
      start: Point3
      end: Point3
    }

type PlaneState = {
  origin: Point3
  xAxis: Point3
  yAxis: Point3
  normal: Point3
}

type CircleState = {
  center: Point2
  radius: number
  edgeId: string
}

type PathState = {
  planeId?: string
  pen?: Point3
  start?: Point3
  segments: PathSegmentState[]
  circle?: CircleState
  closed?: boolean
  closeCommandId?: string
  wire?: any
  face?: any
  edgeEntries?: PathEdgeEntry[]
}

type RegionState = {
  sourcePathId: string
  wire: any
  face: any
  regionEdgeId: string
  queryPoint?: Point2
  edgeIds: string[]
  planeId?: string
  circle?: CircleState
  edgeEntries: PathEdgeEntry[]
}

type ArrangementRegionState = {
  regionId: string
  planeId?: string
  parentPathId?: string
  face?: any
  queryPoint: Point2
  sourceSegmentIds: string[]
  points: Point3[]
}

type SolidState = {
  shape: any
  sourceRegionId?: string
  sourceIds: string[]
  sideFaceId: string
  startCapId: string
  endCapId: string
  brep?: Uint8Array
  cylinder?: {
    center: Point2
    radius: number
    height: number
    planeId?: string
  }
}

type PathEdgeEntry = {
  id: string
  edge: any
  points: Point3[]
}

type OpenCascadeTopologyKind = 'face' | 'edge'
type OpenCascadeFaceRole = 'startCap' | 'endCap' | 'wall'
type OpenCascadeEdgeRole =
  | 'capEdge'
  | 'wallEdge'
  | 'adjacentEdge'
  | 'oppositeEdge'

type OpenCascadeTopologyEntry = {
  topologyId: string
  artifactId: string
  solidId: string
  kind: OpenCascadeTopologyKind
  role: OpenCascadeFaceRole | OpenCascadeEdgeRole
  shape?: any
}

export type OpenCascadeTopologyFaceGroup = {
  start: number
  count: number
  topologyId: string
  artifactId: string
  kind: 'face'
  role: OpenCascadeFaceRole
}

export type OpenCascadeTopologyEdgeLine = {
  topologyId: string
  artifactId: string
  kind: 'edge'
  role: OpenCascadeEdgeRole
  points: number[]
}

export type OpenCascadeTopologySolidMesh = {
  solidId: string
  positions: number[]
  indices: number[]
  groups: OpenCascadeTopologyFaceGroup[]
  edges: OpenCascadeTopologyEdgeLine[]
}

export type OpenCascadeTopologyMeshes = {
  version: number
  solids: OpenCascadeTopologySolidMesh[]
}

export type OpenCascadeSketchLineSegment = {
  pathId: string
  segmentId: string
  artifactId: string
  kind: 'line' | 'arc'
  points: number[]
}

export type OpenCascadeSketchLineMeshes = {
  version: number
  segments: OpenCascadeSketchLineSegment[]
}

export type OpenCascadeRegionFaceGroup = {
  start: number
  count: number
  regionId: string
  artifactId: string
  planeId?: string
  parentPathId?: string
  sourceSegmentIds: string[]
  queryPoint: Point2
}

export type OpenCascadeRegionMesh = {
  regionId: string
  positions: number[]
  indices: number[]
  groups: OpenCascadeRegionFaceGroup[]
}

export type OpenCascadeRegionMeshes = {
  version: number
  regions: OpenCascadeRegionMesh[]
}

type ExtrudeTopology = {
  regionId: string
  pathId: string
  solidId: string
  startCapId: string
  endCapId: string
  wallsBySourceEdgeId: Map<string, string>
  oppositeEdgesBySourceEdgeId: Map<string, string>
  nextAdjacentEdgesBySourceEdgeId: Map<string, string>
  previousAdjacentEdgesBySourceEdgeId: Map<string, string>
  commonEdgesByFacePair: Map<string, string>
}

type BuiltPathShape = {
  wire: any
  face?: any
  edgeEntries: PathEdgeEntry[]
}

type ModelingExecutionResult =
  | { kind: 'modeling'; response: OkModelingCmdResponse }
  | { kind: 'export'; response: OkWebSocketResponseData }

const EMPTY_RESPONSE: OkModelingCmdResponse = { type: 'empty' }

let openCascadePromise: Promise<OpenCascadeInstance> | undefined
let latestOpenCascadeCommandManager: OpenCascadeCommandManager | undefined

async function initOpenCascade(): Promise<OpenCascadeInstance> {
  if (!openCascadePromise) {
    openCascadePromise = (async () => {
      const oc = shouldUseNodeOpenCascade()
        ? await initOpenCascadeForNode()
        : await initOpenCascadeFromFullJs()
      ;(globalThis as any).__zooOpenCascadeInstance = oc
      return oc
    })()
  }
  return openCascadePromise
}

async function initOpenCascadeForNode(): Promise<OpenCascadeInstance> {
  const nodeEntry = 'opencascade.js/dist/node.js'
  const module = await import(/* @vite-ignore */ nodeEntry)
  return module.default()
}

async function initOpenCascadeFromFullJs(): Promise<OpenCascadeInstance> {
  if (typeof window === 'undefined') {
    throw new Error(
      'OpenCascade.js execution is only supported in the browser Vite runtime'
    )
  }

  return withBrowserOpenCascadeEnvironment(() =>
    OpenCascadeMain({
      locateFile: () => openCascadeWasmUrl,
    })
  )
}

function shouldUseNodeOpenCascade(): boolean {
  return (
    typeof process !== 'undefined' &&
    Boolean(process.versions?.node) &&
    (typeof window === 'undefined' || process.env.VITEST === 'true')
  )
}

async function withBrowserOpenCascadeEnvironment<T>(
  initialize: () => Promise<T>
): Promise<T> {
  const globalWithProcess = globalThis as any
  const originalProcess = globalWithProcess.process

  try {
    globalWithProcess.process = undefined
    const initialization = initialize()
    globalWithProcess.process = originalProcess
    return await initialization
  } catch (error) {
    globalWithProcess.process = originalProcess
    throw error
  }
}

export class OpenCascadeCommandManager {
  readonly latestShapeVersion = signal(0)
  readonly latestProfileVersion = signal(0)
  readonly latestTopologyVersion = signal(0)
  readonly latestSketchVersion = signal(0)
  readonly latestRegionVersion = signal(0)
  readonly latestExportError = signal<string | undefined>(undefined)
  private planes = new Map<string, PlaneState>()
  private paths = new Map<string, PathState>()
  private pathAliases = new Map<string, string>()
  private regions = new Map<string, RegionState>()
  private arrangementRegions = new Map<string, ArrangementRegionState>()
  private arrangementDirty = true
  private solids = new Map<string, SolidState>()
  private profileShapes = new Map<string, any>()
  private topologyEntries = new Map<string, OpenCascadeTopologyEntry>()
  private topologyMeshes = new Map<string, OpenCascadeTopologySolidMesh>()
  private extrudeTopologies = new Map<string, ExtrudeTopology>()
  private currentSketchPlaneId: string | undefined

  constructor() {
    latestOpenCascadeCommandManager = this
  }

  static latestInstance(): OpenCascadeCommandManager | undefined {
    return latestOpenCascadeCommandManager
  }

  async startNewSession(): Promise<void> {
    this.clear()
  }

  fireModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): void {
    this.sendModelingCommandFromWasm(
      id,
      rangeStr,
      commandStr,
      idToRangeStr
    ).catch((err) => console.warn(err))
  }

  async sendModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): Promise<Uint8Array> {
    const range: SourceRange = JSON.parse(rangeStr)
    const command: WebSocketRequest = JSON.parse(commandStr)
    JSON.parse(idToRangeStr)

    const response = await this.executeRequest(id, command, range)
    return msgpackEncode(response)
  }

  getSolidCount(): number {
    return this.solids.size
  }

  exportLastBrep(): Uint8Array | undefined {
    return Array.from(this.solids.values()).at(-1)?.brep
  }

  async exportLatestGlbBytes(): Promise<Uint8Array> {
    const latest = Array.from(this.solids.entries()).at(-1)
    if (!latest) {
      return new Uint8Array()
    }

    const [id, solid] = latest
    const oc = await initOpenCascade()
    try {
      const bytes = this.writeGlb(id, solid.shape, oc)
      this.latestExportError.value = undefined
      return bytes
    } catch (error) {
      this.latestExportError.value =
        error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async exportLatestProfileGlbBytes(): Promise<Uint8Array> {
    const latest = Array.from(this.profileShapes.entries()).at(-1)
    if (!latest) {
      return new Uint8Array()
    }

    const [id, shape] = latest
    const oc = await initOpenCascade()
    try {
      const bytes = this.writeGlb(`${id}-profile`, shape, oc)
      this.latestExportError.value = undefined
      return bytes
    } catch (error) {
      this.latestExportError.value =
        error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  exportLatestTopologyMeshes(): OpenCascadeTopologyMeshes {
    return {
      version: this.latestTopologyVersion.value,
      solids: Array.from(this.topologyMeshes.values()).map((solid) => ({
        solidId: solid.solidId,
        positions: [...solid.positions],
        indices: [...solid.indices],
        groups: solid.groups.map((group) => ({ ...group })),
        edges: solid.edges.map((edge) => ({
          ...edge,
          points: [...edge.points],
        })),
      })),
    }
  }

  exportLatestSketchLineMeshes(): OpenCascadeSketchLineMeshes {
    const segments: OpenCascadeSketchLineSegment[] = []
    for (const [pathId, path] of this.paths) {
      for (const segment of this.sketchLineSegmentsForPath(pathId, path)) {
        segments.push(segment)
      }
    }

    return {
      version: this.latestSketchVersion.value,
      segments,
    }
  }

  async exportLatestRegionMeshes(): Promise<OpenCascadeRegionMeshes> {
    await this.rebuildArrangementRegionsIfNeeded()
    return {
      version: this.latestRegionVersion.value,
      regions: Array.from(this.arrangementRegions.values()).map((region) =>
        regionMeshForArrangementRegion(region)
      ),
    }
  }

  private async executeRequest(
    id: string,
    request: WebSocketRequest,
    range: SourceRange
  ): Promise<WebSocketResponse> {
    if (request.type === 'modeling_cmd_batch_req') {
      const responses: Record<string, BatchResponse> = {}
      for (const req of request.requests) {
        const result = await this.executeModelingCommand(
          req.cmd_id,
          req.cmd,
          range
        )
        if (result.kind === 'export') {
          throw new Error(
            'OpenCascade export cannot be returned inside a batch'
          )
        }
        responses[req.cmd_id] = {
          response: result.response,
        }
      }
      return this.success(id, {
        type: 'modeling_batch',
        data: { responses },
      })
    }

    if (request.type === 'modeling_cmd_req') {
      const result = await this.executeModelingCommand(
        request.cmd_id,
        request.cmd,
        range
      )
      if (result.kind === 'export') {
        return this.success(id, result.response)
      }
      return this.success(id, {
        type: 'modeling',
        data: { modeling_response: result.response },
      })
    }

    throw new Error(`OpenCascade engine does not support ${request.type}`)
  }

  private async executeModelingCommand(
    commandId: string,
    cmd: ModelingCmd,
    range: SourceRange
  ): Promise<ModelingExecutionResult> {
    switch (cmd.type) {
      case 'scene_clear_all':
        this.clear()
        return modeling(EMPTY_RESPONSE)
      case 'make_plane':
        this.planes.set(commandId, {
          origin: toPoint3(cmd.origin),
          xAxis: toPoint3(cmd.x_axis),
          yAxis: toPoint3(cmd.y_axis),
          normal: normalize(cross(toPoint3(cmd.x_axis), toPoint3(cmd.y_axis))),
        })
        return modeling(EMPTY_RESPONSE)
      case 'plane_set_color':
      case 'edge_lines_visible':
      case 'object_visible':
      case 'object_set_material_params_pbr':
      case 'object_bring_to_front':
      case 'sketch_mode_disable':
      case 'set_grid_reference_plane':
      case 'set_grid_scale':
      case 'set_grid_auto_scale':
      case 'set_order_independent_transparency':
      case 'zoom_to_fit':
      case 'camera_drag_start':
      case 'camera_drag_move':
      case 'camera_drag_end':
      case 'default_camera_zoom':
      case 'default_camera_look_at':
      case 'default_camera_set_view':
      case 'default_camera_get_settings':
      case 'default_camera_set_orthographic':
      case 'default_camera_set_perspective':
      case 'default_camera_perspective_settings':
        return modeling(EMPTY_RESPONSE)
      case 'enable_sketch_mode':
        this.currentSketchPlaneId = cmd.entity_id
        return modeling(EMPTY_RESPONSE)
      case 'start_path':
        this.paths.set(commandId, {
          planeId: this.currentSketchPlaneId,
          segments: [],
        })
        this.markSketchChanged()
        return modeling({ type: 'start_path', data: {} })
      case 'move_path_pen': {
        const path = this.requirePath(cmd.path, range)
        path.pen = toPoint3(cmd.to)
        this.markSketchChanged()
        return modeling({ type: 'move_path_pen', data: {} })
      }
      case 'extend_path':
        return modeling(
          this.extendPath(commandId, cmd.path, cmd.segment, range)
        )
      case 'close_path':
        return modeling(this.closePath(commandId, cmd.path_id, range))
      case 'create_region':
        return modeling(await this.createRegion(commandId, cmd, range))
      case 'create_region_from_query_point':
        return modeling(
          await this.createRegionFromQueryPoint(commandId, cmd, range)
        )
      case 'extrude':
        return modeling(await this.extrude(commandId, cmd, range))
      case 'revolve':
        return modeling(await this.revolve(commandId, cmd, range))
      case 'sweep':
        return modeling(await this.sweep(commandId, cmd, range))
      case 'loft':
        return modeling(await this.loft(commandId, cmd, range))
      case 'entity_make_helix':
        return modeling(await this.makeHelix(commandId, cmd, range))
      case 'entity_make_helix_from_params':
        return modeling(await this.makeHelixFromParams(commandId, cmd))
      case 'entity_make_helix_from_edge':
        return modeling(await this.makeHelixFromEdge(commandId, cmd))
      case 'solid3d_get_extrusion_face_info':
        return modeling(this.getExtrusionFaceInfo(cmd, range))
      case 'solid3d_get_adjacency_info':
        return modeling(this.getAdjacencyInfo(cmd))
      case 'solid3d_get_opposite_edge':
        return modeling(this.getRelatedEdge(cmd, 'opposite'))
      case 'solid3d_get_next_adjacent_edge':
        return modeling(this.getRelatedEdge(cmd, 'nextAdjacent'))
      case 'solid3d_get_prev_adjacent_edge':
        return modeling(this.getRelatedEdge(cmd, 'previousAdjacent'))
      case 'solid3d_get_common_edge':
        return modeling(this.getCommonEdge(cmd))
      case 'region_get_query_point':
        return modeling(await this.getRegionQueryPoint(cmd.region_id))
      case 'entity_get_parent_id':
        return modeling(await this.getParentEntityId(cmd.entity_id))
      case 'export':
        return { kind: 'export', response: await this.exportBrep() }
      default:
        throw new Error(`OpenCascade engine does not support ${cmd.type}`)
    }
  }

  private extendPath(
    commandId: string,
    pathId: string,
    segment: PathSegment,
    range: SourceRange
  ): OkModelingCmdResponse {
    const path = this.requirePath(pathId, range)
    const start = path.pen || { x: 0, y: 0, z: 0 }
    const segmentType = (segment as any).type
    if (!path.start) {
      path.start = start
    }

    if (segmentType === 'line') {
      const end = endpointFromSegment(start, segment)
      path.segments.push({ id: commandId, type: 'line', start, end })
      path.pen = end
      this.markSketchChanged()
      return { type: 'extend_path', data: {} }
    }

    if (
      segmentType === 'arc_to' ||
      segmentType === 'tangential_arc_to' ||
      segmentType === 'tangential_arc'
    ) {
      const end = endpointFromSegment(start, segment)
      path.segments.push({ id: commandId, type: 'line', start, end })
      path.pen = end
      this.markSketchChanged()
      return { type: 'extend_path', data: {} }
    }

    if (segmentType !== 'arc') {
      throw new Error(
        `OpenCascade proof does not support ${segmentType} sketch segments`
      )
    }

    const arcSegment = segment as Extract<PathSegment, { type: 'arc' }>
    const center = toPoint2(arcSegment.center)
    const radius = lengthValue(arcSegment.radius)
    const startAngle = angleValueRadians(arcSegment.start)
    const endAngle = angleValueRadians(arcSegment.end)
    const fullCircle = Math.abs(endAngle - startAngle) >= Math.PI * 2 - 1e-6
    const arcStart = {
      x: center.x + radius * Math.cos(startAngle),
      y: center.y + radius * Math.sin(startAngle),
      z: start.z,
    }
    const arcEnd = fullCircle
      ? arcStart
      : {
          x: center.x + radius * Math.cos(endAngle),
          y: center.y + radius * Math.sin(endAngle),
          z: start.z,
        }

    path.segments.push({
      id: commandId,
      type: 'arc',
      center,
      radius,
      startAngle,
      endAngle,
      fullCircle,
      start: arcStart,
      end: arcEnd,
    })
    if (fullCircle) {
      path.circle = {
        center,
        radius,
        edgeId: commandId,
      }
    }
    path.pen = arcEnd
    this.markSketchChanged()
    return { type: 'extend_path', data: {} }
  }

  private closePath(
    commandId: string,
    pathId: string,
    range: SourceRange
  ): OkModelingCmdResponse {
    const path = this.requirePath(pathId, range)
    path.closed = true
    path.closeCommandId = commandId
    this.pathAliases.set(commandId, pathId)
    this.markSketchChanged()
    return { type: 'close_path', data: { face_id: commandId } }
  }

  private async createRegion(
    commandId: string,
    cmd: Extract<ModelingCmd, { type: 'create_region' }>,
    range: SourceRange
  ): Promise<OkModelingCmdResponse> {
    const pathId = this.findPathIdForRegionInput(cmd.object_id, cmd.segment)
    await this.storeRegion(commandId, pathId, range)
    return {
      type: 'create_region',
      data: {
        region_mapping: {
          [commandId]: cmd.segment,
        },
      },
    }
  }

  private async createRegionFromQueryPoint(
    commandId: string,
    cmd: Extract<ModelingCmd, { type: 'create_region_from_query_point' }>,
    range: SourceRange
  ): Promise<OkModelingCmdResponse> {
    const pathId = cmd.object_id
    const region = await this.storeRegion(commandId, pathId, range)
    region.queryPoint = toPoint2(cmd.query_point ?? (cmd as any).point)
    const mappedEdgeId = region.circle?.edgeId || region.edgeIds[0] || commandId

    return {
      type: 'create_region_from_query_point',
      data: {
        region_mapping: {
          [commandId]: mappedEdgeId,
        },
      },
    }
  }

  private async extrude(
    commandId: string,
    cmd: Extract<ModelingCmd, { type: 'extrude' }>,
    _range: SourceRange
  ): Promise<OkModelingCmdResponse> {
    const region = await this.regionForTarget(cmd.target, _range)

    const oc = await initOpenCascade()
    const height = lengthValue(cmd.distance)
    const plane = region.planeId ? this.planes.get(region.planeId) : undefined
    const normal = plane?.normal || { x: 0, y: 0, z: 1 }
    const prism = new oc.BRepPrimAPI_MakePrism_1(
      region.face,
      new oc.gp_Vec_4(normal.x * height, normal.y * height, normal.z * height),
      false,
      true
    )
    const shape = prism.Shape()

    const solid: SolidState = {
      shape,
      sourceRegionId: cmd.target,
      sourceIds: [cmd.target],
      sideFaceId: `${commandId.slice(0, 35)}0`,
      startCapId: `${commandId.slice(0, 35)}1`,
      endCapId: `${commandId.slice(0, 35)}2`,
    }
    if (region.circle) {
      solid.cylinder = {
        center: region.circle.center,
        radius: region.circle.radius,
        height,
        planeId: region.planeId,
      }
    }
    this.registerExtrudeTopology(
      commandId,
      solid,
      region,
      prism,
      height,
      normal
    )
    solid.brep = this.writeBrep(commandId, shape, oc)
    this.solids.set(commandId, solid)
    this.latestShapeVersion.value += 1

    return { type: 'extrude', data: {} }
  }

  private async revolve(
    commandId: string,
    cmd: Extract<ModelingCmd, { type: 'revolve' }>,
    _range: SourceRange
  ): Promise<OkModelingCmdResponse> {
    const region = await this.regionForTarget(cmd.target, _range)
    const oc = await initOpenCascade()
    const plane = region.planeId ? this.planes.get(region.planeId) : undefined
    const origin = cmd.axis_is_2d
      ? localToWorld(toPoint3(cmd.origin), plane)
      : toPoint3(cmd.origin)
    const axis = cmd.axis_is_2d
      ? localVectorToWorld(toPoint3(cmd.axis), plane)
      : normalize(toPoint3(cmd.axis))
    const angle = angleValueRadians(cmd.angle)
    const shape = new oc.BRepPrimAPI_MakeRevol_1(
      region.face,
      new oc.gp_Ax1_2(
        new oc.gp_Pnt_3(origin.x, origin.y, origin.z),
        new oc.gp_Dir_4(axis.x, axis.y, axis.z)
      ),
      angle,
      false
    ).Shape()

    this.storeSolid(commandId, shape, [cmd.target], oc)
    return { type: 'revolve', data: {} }
  }

  private async sweep(
    commandId: string,
    cmd: Extract<ModelingCmd, { type: 'sweep' }>,
    range: SourceRange
  ): Promise<OkModelingCmdResponse> {
    const profile =
      cmd.body_type === 'surface'
        ? (await this.wireForTarget(cmd.target, range)).wire
        : (await this.regionForTarget(cmd.target, range)).face
    const trajectory = await this.buildPathShape(cmd.trajectory, range)
    const oc = await initOpenCascade()
    const shape = new oc.BRepOffsetAPI_MakePipe_1(
      trajectory.wire,
      profile
    ).Shape()

    this.storeSolid(commandId, shape, [cmd.target, cmd.trajectory], oc)
    return { type: 'sweep', data: {} }
  }

  private async loft(
    commandId: string,
    cmd: Extract<ModelingCmd, { type: 'loft' }>,
    _range: SourceRange
  ): Promise<OkModelingCmdResponse> {
    const oc = await initOpenCascade()
    const loft = new oc.BRepOffsetAPI_ThruSections(
      cmd.body_type !== 'surface',
      false,
      lengthValue(cmd.tolerance) || 1e-7
    )
    loft.SetMaxDegree(Math.max(1, Math.floor(cmd.v_degree || 1)))
    loft.CheckCompatibility(true)
    for (const sectionId of cmd.section_ids) {
      const section =
        cmd.body_type === 'surface'
          ? await this.wireForTarget(sectionId, _range)
          : await this.regionForTarget(sectionId, _range)
      loft.AddWire(section.wire)
    }
    loft.Build(new oc.Message_ProgressRange_1())
    const shape = loft.Shape()

    this.storeSolid(commandId, shape, cmd.section_ids, oc)
    return { type: 'loft', data: { solid_id: commandId } }
  }

  private async makeHelix(
    commandId: string,
    cmd: Extract<ModelingCmd, { type: 'entity_make_helix' }>,
    _range: SourceRange
  ): Promise<OkModelingCmdResponse> {
    const cylinder = this.solids.get(cmd.cylinder_id)?.cylinder
    const plane = cylinder?.planeId
      ? this.planes.get(cylinder.planeId)
      : undefined
    const center = cylinder?.center
      ? localToWorld({ ...cylinder.center, z: 0 }, plane)
      : { x: 0, y: 0, z: 0 }
    await this.storeHelixPath(commandId, {
      center,
      axis: plane?.normal || { x: 0, y: 0, z: 1 },
      radius: cylinder?.radius || 1,
      length: lengthValue(cmd.length ?? cylinder?.height ?? 1),
      revolutions: cmd.revolutions,
      startAngle: angleValueRadians(cmd.start_angle),
      isClockwise: cmd.is_clockwise,
    })
    return modelingResponseForHelix()
  }

  private async makeHelixFromParams(
    commandId: string,
    cmd: Extract<ModelingCmd, { type: 'entity_make_helix_from_params' }>
  ): Promise<OkModelingCmdResponse> {
    await this.storeHelixPath(commandId, {
      center: toPoint3(cmd.center),
      axis: normalize(toPoint3(cmd.axis)),
      radius: lengthValue(cmd.radius),
      length: lengthValue(cmd.length),
      revolutions: cmd.revolutions,
      startAngle: angleValueRadians(cmd.start_angle),
      isClockwise: cmd.is_clockwise,
    })
    return modelingResponseForHelix()
  }

  private async makeHelixFromEdge(
    commandId: string,
    cmd: Extract<ModelingCmd, { type: 'entity_make_helix_from_edge' }>
  ): Promise<OkModelingCmdResponse> {
    await this.storeHelixPath(commandId, {
      center: { x: 0, y: 0, z: 0 },
      axis: { x: 0, y: 0, z: 1 },
      radius: lengthValue(cmd.radius),
      length: lengthValue(cmd.length ?? 1),
      revolutions: cmd.revolutions,
      startAngle: angleValueRadians(cmd.start_angle),
      isClockwise: cmd.is_clockwise,
    })
    return modelingResponseForHelix()
  }

  private getExtrusionFaceInfo(
    cmd: Extract<ModelingCmd, { type: 'solid3d_get_extrusion_face_info' }>,
    _range: SourceRange
  ): OkModelingCmdResponse {
    const topology = this.findExtrudeTopology(cmd.object_id)
    const solid =
      this.solids.get(cmd.object_id) ||
      (topology ? this.solids.get(topology.solidId) : undefined) ||
      Array.from(this.solids.values()).find(
        (candidate) =>
          candidate.sourceRegionId === cmd.object_id ||
          candidate.sourceIds.includes(cmd.object_id)
      )
    if (!solid) {
      throw new Error(`No OpenCascade solid found for ${cmd.object_id}`)
    }
    const region = solid.sourceRegionId
      ? this.regions.get(solid.sourceRegionId)
      : undefined
    if (topology) {
      const sourceEdgeId =
        cmd.edge_id ||
        region?.edgeIds.find((edgeId) =>
          topology.wallsBySourceEdgeId.has(edgeId)
        )
      const wallFaceId = sourceEdgeId
        ? topology.wallsBySourceEdgeId.get(sourceEdgeId)
        : undefined

      return {
        type: 'solid3d_get_extrusion_face_info',
        data: {
          faces: [
            {
              cap: 'none',
              curve_id:
                sourceEdgeId || region?.regionEdgeId || solid.sideFaceId,
              face_id: wallFaceId || solid.sideFaceId,
            },
            { cap: 'bottom', face_id: topology.startCapId },
            { cap: 'top', face_id: topology.endCapId },
          ],
        },
      }
    }

    return {
      type: 'solid3d_get_extrusion_face_info',
      data: {
        faces: [
          {
            cap: 'none',
            curve_id: cmd.edge_id || region?.regionEdgeId || solid.sideFaceId,
            face_id: solid.sideFaceId,
          },
          { cap: 'bottom', face_id: solid.startCapId },
          { cap: 'top', face_id: solid.endCapId },
        ],
      },
    }
  }

  private getAdjacencyInfo(
    cmd: Extract<ModelingCmd, { type: 'solid3d_get_adjacency_info' }>
  ): OkModelingCmdResponse {
    const topology = this.findExtrudeTopology(cmd.object_id)
    if (!topology) {
      return {
        type: 'solid3d_get_adjacency_info',
        data: { edges: [] },
      } as OkModelingCmdResponse
    }

    const sourceEdgeIds = cmd.edge_id
      ? [cmd.edge_id]
      : Array.from(topology.wallsBySourceEdgeId.keys())
    const edges = sourceEdgeIds
      .map((edgeId) => {
        const wallFaceId = topology.wallsBySourceEdgeId.get(edgeId)
        if (!wallFaceId) {
          return undefined
        }

        return {
          original_info: {
            edge_id: edgeId,
            faces: [wallFaceId],
          },
          opposite_info: {
            edge_id: topology.oppositeEdgesBySourceEdgeId.get(edgeId),
            faces: [wallFaceId, topology.endCapId],
          },
          adjacent_info: {
            edge_id: topology.nextAdjacentEdgesBySourceEdgeId.get(edgeId),
            faces: [wallFaceId, topology.startCapId],
          },
        }
      })
      .filter(Boolean)

    return {
      type: 'solid3d_get_adjacency_info',
      data: { edges },
    } as OkModelingCmdResponse
  }

  private getRelatedEdge(
    cmd: ModelingCmd,
    relation: 'opposite' | 'nextAdjacent' | 'previousAdjacent'
  ): OkModelingCmdResponse {
    const edgeCommand = cmd as {
      type: string
      object_id: string
      edge_id: string
    }
    const topology = this.findExtrudeTopology(edgeCommand.object_id)
    const edge =
      relation === 'opposite'
        ? topology?.oppositeEdgesBySourceEdgeId.get(edgeCommand.edge_id)
        : relation === 'nextAdjacent'
          ? topology?.nextAdjacentEdgesBySourceEdgeId.get(edgeCommand.edge_id)
          : topology?.previousAdjacentEdgesBySourceEdgeId.get(
              edgeCommand.edge_id
            )

    return {
      type: edgeCommand.type,
      data: { edge: edge || null },
    } as OkModelingCmdResponse
  }

  private getCommonEdge(cmd: ModelingCmd): OkModelingCmdResponse {
    const commonEdgeCommand = cmd as {
      type: 'solid3d_get_common_edge'
      object_id: string
      face_ids: string[]
    }
    const topology = this.findExtrudeTopology(commonEdgeCommand.object_id)
    const edge = topology
      ? topology.commonEdgesByFacePair.get(
          facePairKey(
            commonEdgeCommand.face_ids[0],
            commonEdgeCommand.face_ids[1]
          )
        )
      : undefined
    return {
      type: 'solid3d_get_common_edge',
      data: { edge: edge || null },
    } as OkModelingCmdResponse
  }

  private async exportBrep(): Promise<OkWebSocketResponseData> {
    const latest = Array.from(this.solids.entries()).at(-1)
    if (!latest) {
      throw new Error('No OpenCascade solids are available to export')
    }

    const [id, solid] = latest
    const oc = await initOpenCascade()
    const brep = solid.brep || this.writeBrep(id, solid.shape, oc)
    return {
      type: 'export',
      data: {
        files: [
          {
            name: `${id}.brep`,
            contents: Array.from(brep),
          },
        ],
      },
    }
  }

  private writeBrep(
    id: string,
    shape: any,
    oc: OpenCascadeInstance
  ): Uint8Array {
    const fileName = `/${id}.brep`
    oc.BRepTools.Write_3(shape, fileName, new oc.Message_ProgressRange_1())
    return oc.FS.readFile(fileName)
  }

  private writeGlb(
    id: string,
    shape: any,
    oc: OpenCascadeInstance
  ): Uint8Array {
    const fileName = `/${id}.glb`
    try {
      oc.FS.unlink(fileName)
    } catch {
      // Missing files are fine; Emscripten throws for unlink on absent paths.
    }

    const docHandle = new oc.Handle_TDocStd_Document_2(
      new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1())
    )
    const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(
      docHandle.get().Main()
    ).get()
    shapeTool.SetShape(shapeTool.NewShape(), shape)
    new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.1, false)
    const writer = new oc.RWGltf_CafWriter(
      new oc.TCollection_AsciiString_2(fileName),
      true
    )
    const didWrite = writer.Perform_2(
      docHandle,
      new oc.TColStd_IndexedDataMapOfStringString_1(),
      new oc.Message_ProgressRange_1()
    )
    if (!didWrite) {
      throw new Error('OpenCascade GLB writer failed')
    }

    return oc.FS.readFile(fileName)
  }

  private requirePath(pathId: string, _range: SourceRange): PathState {
    const path = this.paths.get(this.pathAliases.get(pathId) || pathId)
    if (!path) {
      throw new Error(`No OpenCascade path found for ${pathId}`)
    }
    return path
  }

  private requireRegion(regionId: string): RegionState {
    const region = this.regions.get(regionId)
    if (!region) {
      throw new Error(`No OpenCascade region found for ${regionId}`)
    }
    return region
  }

  private async regionForTarget(
    targetId: string,
    range: SourceRange
  ): Promise<RegionState> {
    const region = this.regions.get(targetId)
    if (region) {
      return region
    }
    await this.rebuildArrangementRegionsIfNeeded()
    const arrangementRegion = this.arrangementRegions.get(targetId)
    if (arrangementRegion?.face && arrangementRegion.parentPathId) {
      return {
        sourcePathId: arrangementRegion.parentPathId,
        wire: undefined,
        face: arrangementRegion.face,
        regionEdgeId: arrangementRegion.regionId,
        queryPoint: arrangementRegion.queryPoint,
        edgeIds: arrangementRegion.sourceSegmentIds,
        planeId: arrangementRegion.planeId,
        edgeEntries: arrangementRegion.sourceSegmentIds.flatMap((segmentId) =>
          this.pathEdgeEntryForSegment(segmentId)
        ),
      }
    }
    const pathId = this.pathAliases.get(targetId) || targetId
    if (this.paths.has(pathId)) {
      return this.storeRegion(targetId, pathId, range)
    }
    throw new Error(`No OpenCascade region found for ${targetId}`)
  }

  private async wireForTarget(
    targetId: string,
    range: SourceRange
  ): Promise<{ wire: any; face?: any }> {
    const region = this.regions.get(targetId)
    if (region) {
      return { wire: region.wire, face: region.face }
    }

    const pathId =
      this.pathAliases.get(targetId) ||
      (this.paths.has(targetId)
        ? targetId
        : this.findPathIdForSegment(targetId))
    if (pathId) {
      return this.buildPathShape(pathId, range)
    }

    throw new Error(`No OpenCascade wire found for ${targetId}`)
  }

  private async storeRegion(
    commandId: string,
    pathId: string,
    range: SourceRange
  ): Promise<RegionState> {
    const path = this.requirePath(pathId, range)
    const shape = await this.buildPathShape(pathId, range)
    if (!shape.face) {
      throw new Error(`OpenCascade path ${pathId} is not a closed region`)
    }
    const edgeEntries = shape.edgeEntries
    const region: RegionState = {
      sourcePathId: pathId,
      wire: shape.wire,
      face: shape.face,
      regionEdgeId: commandId,
      edgeIds: edgeEntries.map((edge) => edge.id),
      planeId: path.planeId,
      circle: path.circle,
      edgeEntries,
    }
    this.regions.set(commandId, region)
    this.profileShapes.set(commandId, region.face)
    this.latestProfileVersion.value += 1
    this.arrangementDirty = true
    this.latestRegionVersion.value += 1
    return region
  }

  private findPathIdForRegionInput(
    objectId: string,
    segmentId: string
  ): string {
    if (this.paths.has(objectId)) {
      return objectId
    }
    const segmentPathId = this.findPathIdForSegment(segmentId)
    if (segmentPathId) {
      return segmentPathId
    }
    throw new Error(`No OpenCascade path found for region ${objectId}`)
  }

  private findPathIdForSegment(segmentId: string): string | undefined {
    for (const [pathId, path] of this.paths) {
      if (path.segments.some((segment) => segment.id === segmentId)) {
        return pathId
      }
    }
    return undefined
  }

  private pathEdgeEntryForSegment(segmentId: string): PathEdgeEntry[] {
    const pathId = this.findPathIdForSegment(segmentId)
    if (!pathId) {
      return []
    }
    const path = this.paths.get(pathId)
    return path?.edgeEntries?.filter((entry) => entry.id === segmentId) || []
  }

  private async buildPathShape(
    pathId: string,
    range: SourceRange
  ): Promise<BuiltPathShape> {
    const path = this.requirePath(pathId, range)
    if (path.wire) {
      return {
        wire: path.wire,
        face: path.face,
        edgeEntries: path.edgeEntries || [],
      }
    }

    const oc = await initOpenCascade()

    const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1()
    const edgeEntries = this.buildEdgeEntries(path, oc)
    for (const entry of edgeEntries) {
      wireBuilder.Add_1(entry.edge)
    }
    if (!wireBuilder.IsDone()) {
      throw new Error('OpenCascade failed to build sketch wire')
    }
    const wire = wireBuilder.Wire()
    path.wire = wire
    path.edgeEntries = edgeEntries
    if (path.closed || path.circle || isClosedPath(path)) {
      const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true)
      if (!faceBuilder.IsDone()) {
        throw new Error('OpenCascade failed to build sketch face')
      }
      path.face = faceBuilder.Face()
    }
    return { wire: path.wire, face: path.face, edgeEntries }
  }

  private buildEdgeEntries(
    path: PathState,
    oc: OpenCascadeInstance
  ): PathEdgeEntry[] {
    const entries = path.segments.map((segment) =>
      segment.type === 'line'
        ? {
            id: segment.id,
            edge: this.makeLineEdge(segment.start, segment.end, path, oc),
            points: [
              localToWorld(segment.start, this.planeForPath(path)),
              localToWorld(segment.end, this.planeForPath(path)),
            ],
          }
        : {
            id: segment.id,
            edge: this.makeArcEdge(segment, path, oc),
            points: sampleArcPoints(segment, this.planeForPath(path)),
          }
    )

    if (
      path.closed &&
      path.start &&
      path.pen &&
      !pointsClose(path.start, path.pen) &&
      !path.circle
    ) {
      const closingEdgeId =
        path.closeCommandId ||
        deriveTopologyId(
          entries.at(-1)?.id || path.segments.at(-1)?.id || '',
          15
        )
      entries.push({
        id: closingEdgeId,
        edge: this.makeLineEdge(path.pen, path.start, path, oc),
        points: [
          localToWorld(path.pen, this.planeForPath(path)),
          localToWorld(path.start, this.planeForPath(path)),
        ],
      })
    }
    return entries
  }

  private sketchLineSegmentsForPath(
    pathId: string,
    path: PathState
  ): OpenCascadeSketchLineSegment[] {
    const segments = path.segments.map((segment) => ({
      pathId,
      segmentId: segment.id,
      artifactId: segment.id,
      kind: segment.type,
      points: flattenPoints(
        pointsForPathSegment(segment, this.planeForPath(path))
      ),
    }))

    if (
      path.closed &&
      path.start &&
      path.pen &&
      !pointsClose(path.start, path.pen) &&
      !path.circle
    ) {
      const closingEdgeId =
        path.closeCommandId ||
        deriveTopologyId(
          segments.at(-1)?.segmentId || path.segments.at(-1)?.id || '',
          15
        )
      segments.push({
        pathId,
        segmentId: closingEdgeId,
        artifactId: closingEdgeId,
        kind: 'line',
        points: flattenPoints([
          localToWorld(path.pen, this.planeForPath(path)),
          localToWorld(path.start, this.planeForPath(path)),
        ]),
      })
    }

    return segments
  }

  private makeLineEdge(
    start: Point3,
    end: Point3,
    path: PathState,
    oc: OpenCascadeInstance
  ): any {
    const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_3(
      toGpPnt(localToWorld(start, this.planeForPath(path)), oc),
      toGpPnt(localToWorld(end, this.planeForPath(path)), oc)
    )
    if (!edgeBuilder.IsDone()) {
      throw new Error('OpenCascade failed to build line edge')
    }
    return edgeBuilder.Edge()
  }

  private makeArcEdge(
    segment: Extract<PathSegmentState, { type: 'arc' }>,
    path: PathState,
    oc: OpenCascadeInstance
  ): any {
    const plane = this.planeForPath(path)
    const center = localToWorld(
      { ...segment.center, z: segment.start.z },
      plane
    )
    const normal = plane?.normal || { x: 0, y: 0, z: 1 }
    const circle = new oc.gp_Circ_2(
      new oc.gp_Ax2_3(
        toGpPnt(center, oc),
        new oc.gp_Dir_4(normal.x, normal.y, normal.z)
      ),
      segment.radius
    )
    const edgeBuilder = segment.fullCircle
      ? new oc.BRepBuilderAPI_MakeEdge_8(circle)
      : new oc.BRepBuilderAPI_MakeEdge_9(
          circle,
          segment.startAngle,
          segment.endAngle
        )
    if (!edgeBuilder.IsDone()) {
      throw new Error('OpenCascade failed to build arc edge')
    }
    return edgeBuilder.Edge()
  }

  private planeForPath(path: PathState): PlaneState | undefined {
    return path.planeId ? this.planes.get(path.planeId) : undefined
  }

  private storeSolid(
    commandId: string,
    shape: any,
    sourceIds: string[],
    oc: OpenCascadeInstance
  ): SolidState {
    const solid: SolidState = {
      shape,
      sourceRegionId: sourceIds.find((sourceId) => this.regions.has(sourceId)),
      sourceIds,
      sideFaceId: `${commandId.slice(0, 35)}0`,
      startCapId: `${commandId.slice(0, 35)}1`,
      endCapId: `${commandId.slice(0, 35)}2`,
    }
    solid.brep = this.writeBrep(commandId, shape, oc)
    this.solids.set(commandId, solid)
    this.latestShapeVersion.value += 1
    return solid
  }

  private registerExtrudeTopology(
    commandId: string,
    solid: SolidState,
    region: RegionState,
    prism: any,
    height: number,
    normal: Point3
  ) {
    const startCapId = solid.startCapId
    const endCapId = solid.endCapId
    const topology: ExtrudeTopology = {
      regionId: region.regionEdgeId,
      pathId: region.sourcePathId,
      solidId: commandId,
      startCapId,
      endCapId,
      wallsBySourceEdgeId: new Map(),
      oppositeEdgesBySourceEdgeId: new Map(),
      nextAdjacentEdgesBySourceEdgeId: new Map(),
      previousAdjacentEdgesBySourceEdgeId: new Map(),
      commonEdgesByFacePair: new Map(),
    }

    this.topologyEntries.set(startCapId, {
      topologyId: startCapId,
      artifactId: startCapId,
      solidId: commandId,
      kind: 'face',
      role: 'startCap',
      shape: callIfFunction(prism, 'FirstShape_1'),
    })
    this.topologyEntries.set(endCapId, {
      topologyId: endCapId,
      artifactId: endCapId,
      solidId: commandId,
      kind: 'face',
      role: 'endCap',
      shape: callIfFunction(prism, 'LastShape_1'),
    })

    for (const [index, entry] of region.edgeEntries.entries()) {
      const wallFaceId = deriveTopologyId(entry.id, 8 + (index % 4))
      const oppositeEdgeId = deriveTopologyId(entry.id, 12)
      const nextAdjacentEdgeId = deriveTopologyId(entry.id, 13)
      const previousAdjacentEdgeId = deriveTopologyId(entry.id, 14)

      topology.wallsBySourceEdgeId.set(entry.id, wallFaceId)
      topology.oppositeEdgesBySourceEdgeId.set(entry.id, oppositeEdgeId)
      topology.nextAdjacentEdgesBySourceEdgeId.set(entry.id, nextAdjacentEdgeId)
      topology.previousAdjacentEdgesBySourceEdgeId.set(
        entry.id,
        previousAdjacentEdgeId
      )
      topology.commonEdgesByFacePair.set(
        facePairKey(wallFaceId, startCapId),
        nextAdjacentEdgeId
      )
      topology.commonEdgesByFacePair.set(
        facePairKey(wallFaceId, endCapId),
        oppositeEdgeId
      )

      const generated = prism.Generated(entry.edge)
      this.topologyEntries.set(wallFaceId, {
        topologyId: wallFaceId,
        artifactId: wallFaceId,
        solidId: commandId,
        kind: 'face',
        role: 'wall',
        shape: firstShapeFromList(generated),
      })
      for (const [topologyId, role] of [
        [oppositeEdgeId, 'oppositeEdge'],
        [nextAdjacentEdgeId, 'adjacentEdge'],
        [previousAdjacentEdgeId, 'adjacentEdge'],
      ] as const) {
        this.topologyEntries.set(topologyId, {
          topologyId,
          artifactId: topologyId,
          solidId: commandId,
          kind: 'edge',
          role,
        })
      }
    }

    this.extrudeTopologies.set(region.regionEdgeId, topology)
    this.extrudeTopologies.set(commandId, topology)
    this.topologyMeshes.set(
      commandId,
      buildExtrudeTopologyMesh(commandId, region, height, normal, topology)
    )
    this.latestTopologyVersion.value += 1
  }

  private async storeHelixPath(
    commandId: string,
    input: {
      center: Point3
      axis: Point3
      radius: number
      length: number
      revolutions: number
      startAngle: number
      isClockwise: boolean
    }
  ): Promise<void> {
    const oc = await initOpenCascade()
    const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1()
    const axis = normalize(input.axis)
    const basis = orthonormalBasis(axis)
    const turns = Math.max(0.001, Math.abs(input.revolutions))
    const steps = Math.max(16, Math.ceil(turns * 32))
    let previous: Point3 | undefined

    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps
      const signedAngle =
        input.startAngle +
        (input.isClockwise ? -1 : 1) * Math.PI * 2 * input.revolutions * t
      const radial = add(
        scale(basis.x, Math.cos(signedAngle) * input.radius),
        scale(basis.y, Math.sin(signedAngle) * input.radius)
      )
      const point = add(
        add(input.center, radial),
        scale(axis, input.length * t)
      )
      if (previous) {
        const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_3(
          toGpPnt(previous, oc),
          toGpPnt(point, oc)
        )
        if (!edgeBuilder.IsDone()) {
          throw new Error('OpenCascade failed to build helix edge')
        }
        wireBuilder.Add_1(edgeBuilder.Edge())
      }
      previous = point
    }
    if (!wireBuilder.IsDone()) {
      throw new Error('OpenCascade failed to build helix wire')
    }
    this.paths.set(commandId, {
      segments: [],
      wire: wireBuilder.Wire(),
    })
  }

  private async getRegionQueryPoint(
    regionId: string
  ): Promise<OkModelingCmdResponse> {
    const explicitRegion = this.regions.get(regionId)
    if (explicitRegion) {
      const points = orderedBoundaryPoints(explicitRegion.edgeEntries)
      return {
        type: 'region_get_query_point',
        data: {
          query_point:
            explicitRegion.queryPoint || queryPointForWorldPoints(points),
        },
      } as OkModelingCmdResponse
    }

    await this.rebuildArrangementRegionsIfNeeded()
    const arrangementRegion = this.arrangementRegions.get(regionId)
    if (!arrangementRegion) {
      throw new Error(`No OpenCascade region found for ${regionId}`)
    }
    return {
      type: 'region_get_query_point',
      data: { query_point: arrangementRegion.queryPoint },
    } as OkModelingCmdResponse
  }

  private async getParentEntityId(
    entityId: string
  ): Promise<OkModelingCmdResponse> {
    const explicitRegion = this.regions.get(entityId)
    if (explicitRegion) {
      return {
        type: 'entity_get_parent_id',
        data: { entity_id: explicitRegion.sourcePathId },
      } as OkModelingCmdResponse
    }

    await this.rebuildArrangementRegionsIfNeeded()
    const arrangementRegion = this.arrangementRegions.get(entityId)
    if (arrangementRegion?.parentPathId) {
      return {
        type: 'entity_get_parent_id',
        data: { entity_id: arrangementRegion.parentPathId },
      } as OkModelingCmdResponse
    }

    const pathId = this.findPathIdForSegment(entityId)
    if (pathId) {
      return {
        type: 'entity_get_parent_id',
        data: { entity_id: pathId },
      } as OkModelingCmdResponse
    }

    throw new Error(`No OpenCascade parent entity found for ${entityId}`)
  }

  private async rebuildArrangementRegionsIfNeeded() {
    if (!this.arrangementDirty) {
      return
    }

    const nextRegions = new Map<string, ArrangementRegionState>()
    const oc = await initOpenCascade()

    for (const [regionId, region] of this.regions) {
      const points = orderedBoundaryPoints(region.edgeEntries)
      if (points.length < 3) {
        continue
      }
      nextRegions.set(regionId, {
        regionId,
        planeId: region.planeId,
        parentPathId: region.sourcePathId,
        face: region.face,
        queryPoint: region.queryPoint || queryPointForWorldPoints(points),
        sourceSegmentIds: region.edgeIds,
        points,
      })
    }

    const explicitSignatures = new Set(
      Array.from(nextRegions.values()).map((region) =>
        arrangementRegionSignature(region.sourceSegmentIds)
      )
    )
    for (const detectedRegion of detectPlanarArrangementRegions(
      this.paths,
      this.planes
    )) {
      const signature = arrangementRegionSignature(
        detectedRegion.sourceSegmentIds
      )
      if (explicitSignatures.has(signature)) {
        continue
      }
      nextRegions.set(detectedRegion.regionId, {
        ...detectedRegion,
        face: this.buildFaceForArrangementRegion(detectedRegion.points, oc),
      })
    }

    this.arrangementRegions = nextRegions
    this.arrangementDirty = false
  }

  private buildFaceForArrangementRegion(
    points: Point3[],
    oc: OpenCascadeInstance
  ): any | undefined {
    const uniquePoints = withoutClosingPoint(points)
    if (uniquePoints.length < 3) {
      return undefined
    }

    const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1()
    for (let index = 0; index < uniquePoints.length; index += 1) {
      const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_3(
        toGpPnt(uniquePoints[index], oc),
        toGpPnt(uniquePoints[(index + 1) % uniquePoints.length], oc)
      )
      if (!edgeBuilder.IsDone()) {
        return undefined
      }
      wireBuilder.Add_1(edgeBuilder.Edge())
    }
    if (!wireBuilder.IsDone()) {
      return undefined
    }

    const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(
      wireBuilder.Wire(),
      true
    )
    return faceBuilder.IsDone() ? faceBuilder.Face() : undefined
  }

  private success(
    requestId: string,
    resp: OkWebSocketResponseData
  ): WebSocketResponse {
    return {
      success: true,
      request_id: requestId,
      resp,
    }
  }

  private clear() {
    this.planes.clear()
    this.paths.clear()
    this.pathAliases.clear()
    this.regions.clear()
    this.arrangementRegions.clear()
    this.arrangementDirty = true
    this.solids.clear()
    this.profileShapes.clear()
    this.topologyEntries.clear()
    this.topologyMeshes.clear()
    this.extrudeTopologies.clear()
    this.currentSketchPlaneId = undefined
    this.latestExportError.value = undefined
    this.latestShapeVersion.value += 1
    this.latestProfileVersion.value += 1
    this.latestTopologyVersion.value += 1
    this.markSketchChanged()
  }

  private markSketchChanged() {
    this.arrangementDirty = true
    this.latestSketchVersion.value += 1
    this.latestRegionVersion.value += 1
  }

  private findExtrudeTopology(objectId: string): ExtrudeTopology | undefined {
    return (
      this.extrudeTopologies.get(objectId) ||
      Array.from(this.extrudeTopologies.values()).find(
        (topology) =>
          topology.regionId === objectId ||
          topology.pathId === objectId ||
          topology.solidId === objectId
      )
    )
  }
}

function toPoint2(point: unknown): Point2 {
  const p = point as { x?: unknown; y?: unknown }
  return { x: lengthValue(p.x), y: lengthValue(p.y) }
}

function toPoint3(point: unknown): Point3 {
  const p = point as { x?: unknown; y?: unknown; z?: unknown }
  return {
    x: lengthValue(p.x),
    y: lengthValue(p.y),
    z: lengthValue(p.z),
  }
}

function endpointFromSegment(start: Point3, segment: any): Point3 {
  if (segment.type === 'tangential_arc') {
    const radius = lengthValue(segment.radius)
    const angle = angleValueRadians(segment.offset)
    return {
      x: start.x + radius * Math.cos(angle),
      y: start.y + radius * Math.sin(angle),
      z: start.z,
    }
  }

  const rawEnd = segment.end ?? segment.to
  const end = toPoint3(rawEnd)
  return segment.relative ? add(start, end) : end
}

function toGpPnt(point: Point3, oc: OpenCascadeInstance): any {
  return new oc.gp_Pnt_3(point.x, point.y, point.z)
}

function lengthValue(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  if (value && typeof value === 'object' && 'value' in value) {
    const v = (value as { value: unknown }).value
    if (typeof v === 'number') {
      return v
    }
  }
  return 0
}

function angleValueRadians(value: unknown): number {
  if (typeof value === 'number') {
    return (value * Math.PI) / 180
  }
  const angle = value as { unit?: unknown; value?: unknown }
  const raw = lengthValue(angle?.value)
  return angle?.unit === 'radians' ? raw : (raw * Math.PI) / 180
}

function localToWorld(point: Point3, plane?: PlaneState): Point3 {
  if (!plane) {
    return point
  }
  return add(
    add(plane.origin, scale(plane.xAxis, point.x)),
    add(scale(plane.yAxis, point.y), scale(plane.normal, point.z))
  )
}

function localVectorToWorld(vector: Point3, plane?: PlaneState): Point3 {
  if (!plane) {
    return normalize(vector)
  }
  return normalize(
    add(
      scale(plane.xAxis, vector.x),
      add(scale(plane.yAxis, vector.y), scale(plane.normal, vector.z))
    )
  )
}

function add(a: Point3, b: Point3): Point3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function scale(v: Point3, scalar: number): Point3 {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar }
}

function cross(a: Point3, b: Point3): Point3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function normalize(v: Point3): Point3 {
  const length = Math.hypot(v.x, v.y, v.z)
  if (length === 0) {
    return { x: 0, y: 0, z: 1 }
  }
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}

function pointsClose(a: Point3, b: Point3): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6
}

function pointsForPathSegment(
  segment: PathSegmentState,
  plane?: PlaneState
): Point3[] {
  if (segment.type === 'line') {
    return [
      localToWorld(segment.start, plane),
      localToWorld(segment.end, plane),
    ]
  }

  return sampleArcPoints(segment, plane)
}

function sampleArcPoints(
  segment: Extract<PathSegmentState, { type: 'arc' }>,
  plane?: PlaneState
): Point3[] {
  const angleSpan = segment.fullCircle
    ? Math.PI * 2
    : segment.endAngle - segment.startAngle
  const steps = Math.max(8, Math.ceil(Math.abs(angleSpan) / (Math.PI / 16)))
  const points: Point3[] = []
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    const angle = segment.startAngle + angleSpan * t
    points.push(
      localToWorld(
        {
          x: segment.center.x + segment.radius * Math.cos(angle),
          y: segment.center.y + segment.radius * Math.sin(angle),
          z: segment.start.z,
        },
        plane
      )
    )
  }
  return points
}

function buildExtrudeTopologyMesh(
  solidId: string,
  region: RegionState,
  height: number,
  normal: Point3,
  topology: ExtrudeTopology
): OpenCascadeTopologySolidMesh {
  const positions: number[] = []
  const indices: number[] = []
  const groups: OpenCascadeTopologyFaceGroup[] = []
  const edges: OpenCascadeTopologyEdgeLine[] = []
  const boundary = orderedBoundaryPoints(region.edgeEntries)
  const topBoundary = boundary.map((point) => add(point, scale(normal, height)))

  addCapGroup({
    positions,
    indices,
    groups,
    points: boundary,
    topologyId: topology.startCapId,
    role: 'startCap',
    reverse: true,
  })
  addCapGroup({
    positions,
    indices,
    groups,
    points: topBoundary,
    topologyId: topology.endCapId,
    role: 'endCap',
    reverse: false,
  })

  for (const entry of region.edgeEntries) {
    const wallFaceId = topology.wallsBySourceEdgeId.get(entry.id)
    if (!wallFaceId) {
      continue
    }

    const groupStart = indices.length
    for (let index = 0; index < entry.points.length - 1; index += 1) {
      const bottomA = entry.points[index]
      const bottomB = entry.points[index + 1]
      const topA = add(bottomA, scale(normal, height))
      const topB = add(bottomB, scale(normal, height))
      addQuad(positions, indices, bottomA, bottomB, topB, topA)
    }
    groups.push({
      start: groupStart,
      count: indices.length - groupStart,
      topologyId: wallFaceId,
      artifactId: wallFaceId,
      kind: 'face',
      role: 'wall',
    })

    const oppositeEdgeId = topology.oppositeEdgesBySourceEdgeId.get(entry.id)
    const nextAdjacentEdgeId = topology.nextAdjacentEdgesBySourceEdgeId.get(
      entry.id
    )
    const previousAdjacentEdgeId =
      topology.previousAdjacentEdgesBySourceEdgeId.get(entry.id)
    if (nextAdjacentEdgeId) {
      edges.push({
        topologyId: nextAdjacentEdgeId,
        artifactId: nextAdjacentEdgeId,
        kind: 'edge',
        role: 'adjacentEdge',
        points: flattenPoints(entry.points),
      })
    }
    if (oppositeEdgeId) {
      edges.push({
        topologyId: oppositeEdgeId,
        artifactId: oppositeEdgeId,
        kind: 'edge',
        role: 'oppositeEdge',
        points: flattenPoints(
          entry.points.map((point) => add(point, scale(normal, height)))
        ),
      })
    }
    if (previousAdjacentEdgeId) {
      const start = entry.points[0]
      edges.push({
        topologyId: previousAdjacentEdgeId,
        artifactId: previousAdjacentEdgeId,
        kind: 'edge',
        role: 'adjacentEdge',
        points: flattenPoints([start, add(start, scale(normal, height))]),
      })
    }
  }

  return { solidId, positions, indices, groups, edges }
}

function regionMeshForArrangementRegion(
  region: ArrangementRegionState
): OpenCascadeRegionMesh {
  const points = withoutClosingPoint(region.points)
  const positions = flattenPoints(points)
  const indices: number[] = []
  if (points.length >= 3) {
    for (let index = 1; index < points.length - 1; index += 1) {
      indices.push(0, index, index + 1)
    }
  }
  return {
    regionId: region.regionId,
    positions,
    indices,
    groups:
      indices.length > 0
        ? [
            {
              start: 0,
              count: indices.length,
              regionId: region.regionId,
              artifactId: region.regionId,
              planeId: region.planeId,
              parentPathId: region.parentPathId,
              sourceSegmentIds: [...region.sourceSegmentIds],
              queryPoint: { ...region.queryPoint },
            },
          ]
        : [],
  }
}

type ArrangementRawSegment = {
  start: Point2
  end: Point2
  sourceSegmentId: string
  pathId: string
  planeId?: string
}

type ArrangementDetectedRegion = Omit<ArrangementRegionState, 'face'>

function detectPlanarArrangementRegions(
  paths: Map<string, PathState>,
  planes: Map<string, PlaneState>
): ArrangementDetectedRegion[] {
  const rawSegmentsByPlane = new Map<string, ArrangementRawSegment[]>()
  for (const [pathId, path] of paths) {
    const planeKey = path.planeId || ''
    const segments = rawArrangementSegmentsForPath(pathId, path)
    if (segments.length === 0) {
      continue
    }
    rawSegmentsByPlane.set(planeKey, [
      ...(rawSegmentsByPlane.get(planeKey) || []),
      ...segments,
    ])
  }

  const regions: ArrangementDetectedRegion[] = []
  for (const [planeKey, rawSegments] of rawSegmentsByPlane) {
    const planeId = planeKey || undefined
    const planeRegions = detectPlanarArrangementRegionsForPlane(
      planeId,
      rawSegments,
      planeId ? planes.get(planeId) : undefined
    )
    regions.push(...planeRegions)
  }
  return regions
}

function rawArrangementSegmentsForPath(
  pathId: string,
  path: PathState
): ArrangementRawSegment[] {
  const planeId = path.planeId
  const segments = path.segments.flatMap((segment) => {
    const points =
      segment.type === 'line'
        ? [point3ToPoint2(segment.start), point3ToPoint2(segment.end)]
        : sampleArcLocalPoints(segment)
    const rawSegments: ArrangementRawSegment[] = []
    for (let index = 0; index < points.length - 1; index += 1) {
      if (!points2Close(points[index], points[index + 1])) {
        rawSegments.push({
          start: points[index],
          end: points[index + 1],
          sourceSegmentId: segment.id,
          pathId,
          planeId,
        })
      }
    }
    return rawSegments
  })

  if (
    path.closed &&
    path.start &&
    path.pen &&
    !pointsClose(path.start, path.pen) &&
    !path.circle
  ) {
    segments.push({
      start: point3ToPoint2(path.pen),
      end: point3ToPoint2(path.start),
      sourceSegmentId:
        path.closeCommandId ||
        deriveTopologyId(path.segments.at(-1)?.id || pathId, 15),
      pathId,
      planeId,
    })
  }

  return segments
}

function detectPlanarArrangementRegionsForPlane(
  planeId: string | undefined,
  rawSegments: ArrangementRawSegment[],
  plane: PlaneState | undefined
): ArrangementDetectedRegion[] {
  const vertices = new Map<string, Point2>()
  const vertexIdsByKey = new Map<string, string>()
  const edgeByKey = new Map<
    string,
    {
      from: string
      to: string
      sourceSegmentIds: Set<string>
      pathIds: Set<string>
    }
  >()

  const vertexIdForPoint = (point: Point2) => {
    const key = quantizedPoint2Key(point)
    const existing = vertexIdsByKey.get(key)
    if (existing) {
      return existing
    }
    const id = `v${vertexIdsByKey.size}`
    vertexIdsByKey.set(key, id)
    vertices.set(id, point)
    return id
  }

  for (let index = 0; index < rawSegments.length; index += 1) {
    const segment = rawSegments[index]
    const splitParameters = new Set<number>([0, 1])
    for (let otherIndex = 0; otherIndex < rawSegments.length; otherIndex += 1) {
      if (index === otherIndex) {
        continue
      }
      const intersection = segmentIntersectionParameters(
        segment,
        rawSegments[otherIndex]
      )
      if (intersection) {
        splitParameters.add(intersection.t)
      }
    }
    const sortedParameters = Array.from(splitParameters).sort((a, b) => a - b)
    for (let tIndex = 0; tIndex < sortedParameters.length - 1; tIndex += 1) {
      const t0 = sortedParameters[tIndex]
      const t1 = sortedParameters[tIndex + 1]
      if (Math.abs(t1 - t0) < 1e-7) {
        continue
      }
      const start = interpolatePoint2(segment.start, segment.end, t0)
      const end = interpolatePoint2(segment.start, segment.end, t1)
      if (points2Close(start, end)) {
        continue
      }
      const from = vertexIdForPoint(start)
      const to = vertexIdForPoint(end)
      const edgeKey = [from, to].sort().join(':')
      const edge = edgeByKey.get(edgeKey) || {
        from,
        to,
        sourceSegmentIds: new Set<string>(),
        pathIds: new Set<string>(),
      }
      edge.sourceSegmentIds.add(segment.sourceSegmentId)
      edge.pathIds.add(segment.pathId)
      edgeByKey.set(edgeKey, edge)
    }
  }

  const adjacency = new Map<
    string,
    { to: string; angle: number; edgeKey: string }[]
  >()
  for (const [edgeKey, edge] of edgeByKey) {
    const from = vertices.get(edge.from)
    const to = vertices.get(edge.to)
    if (!from || !to) {
      continue
    }
    const forward = {
      to: edge.to,
      angle: Math.atan2(to.y - from.y, to.x - from.x),
      edgeKey,
    }
    const backward = {
      to: edge.from,
      angle: Math.atan2(from.y - to.y, from.x - to.x),
      edgeKey,
    }
    adjacency.set(edge.from, [...(adjacency.get(edge.from) || []), forward])
    adjacency.set(edge.to, [...(adjacency.get(edge.to) || []), backward])
  }
  for (const edges of adjacency.values()) {
    edges.sort((a, b) => a.angle - b.angle)
  }

  const visited = new Set<string>()
  const regions: ArrangementDetectedRegion[] = []
  const seenCycles = new Set<string>()
  for (const from of adjacency.keys()) {
    for (const edge of adjacency.get(from) || []) {
      const halfEdgeKey = `${from}->${edge.to}`
      if (visited.has(halfEdgeKey)) {
        continue
      }
      const cycle = walkArrangementFace(from, edge.to, adjacency, visited)
      if (cycle.length < 3) {
        continue
      }
      const cyclePoints = cycle
        .map((vertexId) => vertices.get(vertexId))
        .filter((point): point is Point2 => Boolean(point))
      const area = signedArea2(cyclePoints)
      if (area <= 1e-7) {
        continue
      }
      const cycleKey = cycle.slice().sort().join(':')
      if (seenCycles.has(cycleKey)) {
        continue
      }
      seenCycles.add(cycleKey)

      const sourceSegmentIds = new Set<string>()
      const pathIds = new Set<string>()
      for (let index = 0; index < cycle.length; index += 1) {
        const edgeKey = [cycle[index], cycle[(index + 1) % cycle.length]]
          .sort()
          .join(':')
        const sourceEdge = edgeByKey.get(edgeKey)
        if (!sourceEdge) {
          continue
        }
        for (const sourceSegmentId of sourceEdge.sourceSegmentIds) {
          sourceSegmentIds.add(sourceSegmentId)
        }
        for (const pathId of sourceEdge.pathIds) {
          pathIds.add(pathId)
        }
      }
      if (sourceSegmentIds.size === 0) {
        continue
      }

      const queryPoint = polygonCentroid2(cyclePoints)
      const sourceIds = Array.from(sourceSegmentIds).sort()
      const parentPathId =
        pathIds.size === 1 ? Array.from(pathIds)[0] : undefined
      const regionId = deriveTopologyId(
        `arrangement:${planeId || ''}:${sourceIds.join(':')}:${quantizedPoint2Key(
          queryPoint
        )}`,
        40
      )
      regions.push({
        regionId,
        planeId,
        parentPathId,
        queryPoint,
        sourceSegmentIds: sourceIds,
        points: cyclePoints.map((point) =>
          localToWorld({ x: point.x, y: point.y, z: 0 }, plane)
        ),
      })
    }
  }
  return regions
}

function walkArrangementFace(
  startFrom: string,
  startTo: string,
  adjacency: Map<string, { to: string; angle: number; edgeKey: string }[]>,
  visited: Set<string>
) {
  const cycle: string[] = []
  let from = startFrom
  let to = startTo

  for (let guard = 0; guard < 10000; guard += 1) {
    const halfEdgeKey = `${from}->${to}`
    if (visited.has(halfEdgeKey)) {
      break
    }
    visited.add(halfEdgeKey)
    cycle.push(from)

    const outgoing = adjacency.get(to) || []
    const reverseIndex = outgoing.findIndex((edge) => edge.to === from)
    if (reverseIndex === -1 || outgoing.length === 0) {
      break
    }
    const next =
      outgoing[(reverseIndex - 1 + outgoing.length) % outgoing.length]
    from = to
    to = next.to

    if (from === startFrom && to === startTo) {
      break
    }
  }

  return cycle
}

function addCapGroup(input: {
  positions: number[]
  indices: number[]
  groups: OpenCascadeTopologyFaceGroup[]
  points: Point3[]
  topologyId: string
  role: OpenCascadeFaceRole
  reverse: boolean
}) {
  const uniquePoints = input.points.filter(
    (point, index, points) =>
      index === 0 || !pointsClose(point, points[index - 1])
  )
  if (
    uniquePoints.length > 1 &&
    pointsClose(uniquePoints[0], uniquePoints[uniquePoints.length - 1])
  ) {
    uniquePoints.pop()
  }
  if (uniquePoints.length < 3) {
    return
  }

  const center = centroid(uniquePoints)
  const centerIndex = pushPoint(input.positions, center)
  const pointIndices = uniquePoints.map((point) =>
    pushPoint(input.positions, point)
  )
  const groupStart = input.indices.length
  for (let index = 0; index < pointIndices.length; index += 1) {
    const current = pointIndices[index]
    const next = pointIndices[(index + 1) % pointIndices.length]
    if (input.reverse) {
      input.indices.push(centerIndex, next, current)
    } else {
      input.indices.push(centerIndex, current, next)
    }
  }
  input.groups.push({
    start: groupStart,
    count: input.indices.length - groupStart,
    topologyId: input.topologyId,
    artifactId: input.topologyId,
    kind: 'face',
    role: input.role,
  })
}

function addQuad(
  positions: number[],
  indices: number[],
  a: Point3,
  b: Point3,
  c: Point3,
  d: Point3
) {
  const ai = pushPoint(positions, a)
  const bi = pushPoint(positions, b)
  const ci = pushPoint(positions, c)
  const di = pushPoint(positions, d)
  indices.push(ai, bi, ci, ai, ci, di)
}

function pushPoint(positions: number[], point: Point3): number {
  const index = positions.length / 3
  positions.push(point.x, point.y, point.z)
  return index
}

function orderedBoundaryPoints(edgeEntries: PathEdgeEntry[]): Point3[] {
  const points: Point3[] = []
  for (const entry of edgeEntries) {
    const segmentPoints = points.length
      ? entry.points.filter((point, index) => {
          if (index !== 0) {
            return true
          }
          return !pointsClose(points[points.length - 1], point)
        })
      : entry.points
    points.push(...segmentPoints)
  }
  return points
}

function centroid(points: Point3[]): Point3 {
  const sum = points.reduce((acc, point) => add(acc, point), {
    x: 0,
    y: 0,
    z: 0,
  })
  return scale(sum, 1 / points.length)
}

function queryPointForWorldPoints(points: Point3[]): Point2 {
  const uniquePoints = withoutClosingPoint(points)
  if (uniquePoints.length < 3) {
    return { x: 0, y: 0 }
  }
  return polygonCentroid2(uniquePoints.map(point3ToPoint2))
}

function point3ToPoint2(point: Point3): Point2 {
  return { x: point.x, y: point.y }
}

function sampleArcLocalPoints(
  segment: Extract<PathSegmentState, { type: 'arc' }>
): Point2[] {
  const angleSpan = segment.fullCircle
    ? Math.PI * 2
    : segment.endAngle - segment.startAngle
  const steps = Math.max(16, Math.ceil(Math.abs(angleSpan) / (Math.PI / 16)))
  const points: Point2[] = []
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    const angle = segment.startAngle + angleSpan * t
    points.push({
      x: segment.center.x + segment.radius * Math.cos(angle),
      y: segment.center.y + segment.radius * Math.sin(angle),
    })
  }
  return points
}

function withoutClosingPoint(points: Point3[]): Point3[] {
  const uniquePoints = points.filter(
    (point, index) => index === 0 || !pointsClose(point, points[index - 1])
  )
  if (
    uniquePoints.length > 1 &&
    pointsClose(uniquePoints[0], uniquePoints[uniquePoints.length - 1])
  ) {
    uniquePoints.pop()
  }
  return uniquePoints
}

function points2Close(a: Point2, b: Point2): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-6
}

function interpolatePoint2(start: Point2, end: Point2, t: number): Point2 {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }
}

function segmentIntersectionParameters(
  first: ArrangementRawSegment,
  second: ArrangementRawSegment
): { t: number; u: number } | undefined {
  const p = first.start
  const r = { x: first.end.x - first.start.x, y: first.end.y - first.start.y }
  const q = second.start
  const s = {
    x: second.end.x - second.start.x,
    y: second.end.y - second.start.y,
  }
  const denominator = cross2(r, s)
  if (Math.abs(denominator) < 1e-9) {
    return undefined
  }
  const qp = { x: q.x - p.x, y: q.y - p.y }
  const t = cross2(qp, s) / denominator
  const u = cross2(qp, r) / denominator
  if (t <= 1e-7 || t >= 1 - 1e-7 || u <= 1e-7 || u >= 1 - 1e-7) {
    return undefined
  }
  return { t, u }
}

function cross2(a: Point2, b: Point2) {
  return a.x * b.y - a.y * b.x
}

function signedArea2(points: Point2[]) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return area / 2
}

function polygonCentroid2(points: Point2[]): Point2 {
  const area = signedArea2(points)
  if (Math.abs(area) < 1e-9) {
    const sum = points.reduce(
      (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
      { x: 0, y: 0 }
    )
    return { x: sum.x / points.length, y: sum.y / points.length }
  }

  let x = 0
  let y = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const factor = current.x * next.y - next.x * current.y
    x += (current.x + next.x) * factor
    y += (current.y + next.y) * factor
  }
  const divisor = 6 * area
  return { x: x / divisor, y: y / divisor }
}

function quantizedPoint2Key(point: Point2) {
  return `${Math.round(point.x * 1e6)}:${Math.round(point.y * 1e6)}`
}

function arrangementRegionSignature(sourceSegmentIds: string[]) {
  return sourceSegmentIds.slice().sort().join(':')
}

function flattenPoints(points: Point3[]): number[] {
  return points.flatMap((point) => [point.x, point.y, point.z])
}

function deriveTopologyId(sourceId: string, salt: number): string {
  const hex = hashToHex(`${sourceId}:${salt}`)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

function hashToHex(input: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  return seeds
    .map((seed) => {
      let hash = seed
      for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
      }
      return (hash >>> 0).toString(16).padStart(8, '0')
    })
    .join('')
}

function facePairKey(first: string | undefined, second: string | undefined) {
  return [first || '', second || ''].sort().join(':')
}

function callIfFunction(object: unknown, method: string): any | undefined {
  if (!object || typeof object !== 'object') {
    return undefined
  }
  const candidate = (object as Record<string, unknown>)[method]
  return typeof candidate === 'function' ? candidate.call(object) : undefined
}

function firstShapeFromList(list: any): any | undefined {
  if (!list || typeof list !== 'object') {
    return undefined
  }
  if (typeof list.Size === 'function' && list.Size() === 0) {
    return undefined
  }
  if (typeof list.First_1 === 'function') {
    return list.First_1()
  }
  if (typeof list.First === 'function') {
    return list.First()
  }
  return undefined
}

function isClosedPath(path: PathState): boolean {
  return Boolean(path.start && path.pen && pointsClose(path.start, path.pen))
}

function orthonormalBasis(axis: Point3): { x: Point3; y: Point3 } {
  const helper =
    Math.abs(axis.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }
  const x = normalize(cross(helper, axis))
  const y = normalize(cross(axis, x))
  return { x, y }
}

function modeling(response: OkModelingCmdResponse): ModelingExecutionResult {
  return { kind: 'modeling', response }
}

function modelingResponseForHelix(): OkModelingCmdResponse {
  return { type: 'empty' }
}

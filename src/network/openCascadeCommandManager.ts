import { encode as msgpackEncode } from '@msgpack/msgpack'
import { signal } from '@preact/signals-core'
import OpenCascadeMain from 'opencascade.js/dist/opencascade.full.js'
import openCascadeWasmUrl from 'opencascade.js/dist/opencascade.full.wasm?url'
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
}

type RegionState = {
  sourcePathId: string
  wire: any
  face: any
  regionEdgeId: string
  edgeIds: string[]
  planeId?: string
  circle?: CircleState
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
  readonly latestExportError = signal<string | undefined>(undefined)
  private planes = new Map<string, PlaneState>()
  private paths = new Map<string, PathState>()
  private pathAliases = new Map<string, string>()
  private regions = new Map<string, RegionState>()
  private solids = new Map<string, SolidState>()
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
        return modeling(EMPTY_RESPONSE)
      case 'enable_sketch_mode':
        this.currentSketchPlaneId = cmd.entity_id
        return modeling(EMPTY_RESPONSE)
      case 'start_path':
        this.paths.set(commandId, {
          planeId: this.currentSketchPlaneId,
          segments: [],
        })
        return modeling({ type: 'start_path', data: {} })
      case 'move_path_pen': {
        const path = this.requirePath(cmd.path, range)
        path.pen = toPoint3(cmd.to)
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
          await this.createRegionFromQueryPoint(commandId, cmd.object_id, range)
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
        return modeling({
          type: 'solid3d_get_adjacency_info',
          data: { edges: [] },
        })
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
    pathId: string,
    range: SourceRange
  ): Promise<OkModelingCmdResponse> {
    const region = await this.storeRegion(commandId, pathId, range)
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
    const solid =
      this.solids.get(cmd.object_id) ||
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
    const region: RegionState = {
      sourcePathId: pathId,
      wire: shape.wire,
      face: shape.face,
      regionEdgeId: commandId,
      edgeIds: path.segments.map((segment) => segment.id),
      planeId: path.planeId,
      circle: path.circle,
    }
    this.regions.set(commandId, region)
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

  private async buildPathShape(
    pathId: string,
    range: SourceRange
  ): Promise<{ wire: any; face?: any }> {
    const path = this.requirePath(pathId, range)
    if (path.wire) {
      return { wire: path.wire, face: path.face }
    }

    const oc = await initOpenCascade()

    const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1()
    for (const edge of this.buildEdges(path, oc)) {
      wireBuilder.Add_1(edge)
    }
    if (!wireBuilder.IsDone()) {
      throw new Error('OpenCascade failed to build sketch wire')
    }
    const wire = wireBuilder.Wire()
    path.wire = wire
    if (path.closed || path.circle || isClosedPath(path)) {
      const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true)
      if (!faceBuilder.IsDone()) {
        throw new Error('OpenCascade failed to build sketch face')
      }
      path.face = faceBuilder.Face()
    }
    return { wire: path.wire, face: path.face }
  }

  private buildEdges(path: PathState, oc: OpenCascadeInstance): any[] {
    const edges = path.segments.map((segment) =>
      segment.type === 'line'
        ? this.makeLineEdge(segment.start, segment.end, path, oc)
        : this.makeArcEdge(segment, path, oc)
    )

    if (
      path.closed &&
      path.start &&
      path.pen &&
      !pointsClose(path.start, path.pen) &&
      !path.circle
    ) {
      edges.push(this.makeLineEdge(path.pen, path.start, path, oc))
    }
    return edges
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
    this.solids.clear()
    this.currentSketchPlaneId = undefined
    this.latestExportError.value = undefined
    this.latestShapeVersion.value += 1
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
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && 'value' in value) {
    const v = (value as { value: unknown }).value
    if (typeof v === 'number') return v
  }
  return 0
}

function angleValueRadians(value: unknown): number {
  if (typeof value === 'number') return (value * Math.PI) / 180
  const angle = value as { unit?: unknown; value?: unknown }
  const raw = lengthValue(angle?.value)
  return angle?.unit === 'radians' ? raw : (raw * Math.PI) / 180
}

function localToWorld(point: Point3, plane?: PlaneState): Point3 {
  if (!plane) return point
  return add(
    add(plane.origin, scale(plane.xAxis, point.x)),
    add(scale(plane.yAxis, point.y), scale(plane.normal, point.z))
  )
}

function localVectorToWorld(vector: Point3, plane?: PlaneState): Point3 {
  if (!plane) return normalize(vector)
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
  if (length === 0) return { x: 0, y: 0, z: 1 }
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}

function pointsClose(a: Point3, b: Point3): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6
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

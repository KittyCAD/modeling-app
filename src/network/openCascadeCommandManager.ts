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
  circle?: CircleState
}

type RegionState = {
  sourcePathId: string
  circle: CircleState
  regionEdgeId: string
}

type SolidState = {
  shape: any
  sourceRegionId: string
  sideFaceId: string
  startCapId: string
  endCapId: string
  brep?: Uint8Array
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
        this.paths.set(commandId, { planeId: this.currentSketchPlaneId })
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
        return modeling({ type: 'close_path', data: { face_id: commandId } })
      case 'create_region_from_query_point':
        return modeling(
          this.createRegionFromQueryPoint(commandId, cmd.object_id, range)
        )
      case 'extrude':
        return modeling(await this.extrude(commandId, cmd, range))
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
    if (segment.type !== 'arc') {
      throw new Error('OpenCascade proof only supports arc sketch segments')
    }

    path.circle = {
      center: toPoint2(segment.center),
      radius: lengthValue(segment.radius),
      edgeId: commandId,
    }
    return { type: 'extend_path', data: {} }
  }

  private createRegionFromQueryPoint(
    commandId: string,
    pathId: string,
    range: SourceRange
  ): OkModelingCmdResponse {
    const path = this.requirePath(pathId, range)
    if (!path.circle) {
      throw new Error('OpenCascade proof only supports circular regions')
    }

    this.regions.set(commandId, {
      sourcePathId: pathId,
      circle: path.circle,
      regionEdgeId: commandId,
    })

    return {
      type: 'create_region_from_query_point',
      data: {
        region_mapping: {
          [commandId]: path.circle.edgeId,
        },
      },
    }
  }

  private async extrude(
    commandId: string,
    cmd: Extract<ModelingCmd, { type: 'extrude' }>,
    _range: SourceRange
  ): Promise<OkModelingCmdResponse> {
    const region = this.regions.get(cmd.target)
    if (!region) {
      throw new Error(`No OpenCascade region found for ${cmd.target}`)
    }

    const oc = await initOpenCascade()
    const height = lengthValue(cmd.distance)
    const planeId = this.paths.get(region.sourcePathId)?.planeId
    const plane = planeId ? this.planes.get(planeId) : undefined
    const normal = plane?.normal || { x: 0, y: 0, z: 1 }
    const center = region.circle.center
    const axis = new oc.gp_Ax2_3(
      new oc.gp_Pnt_3(center.x, center.y, 0),
      new oc.gp_Dir_4(normal.x, normal.y, normal.z)
    )
    const cylinder = new oc.BRepPrimAPI_MakeCylinder_3(
      axis,
      region.circle.radius,
      height
    )
    const shape = cylinder.Shape()

    const solid: SolidState = {
      shape,
      sourceRegionId: cmd.target,
      sideFaceId: `${commandId.slice(0, 35)}0`,
      startCapId: `${commandId.slice(0, 35)}1`,
      endCapId: `${commandId.slice(0, 35)}2`,
    }
    solid.brep = this.writeBrep(commandId, shape, oc)
    this.solids.set(commandId, solid)
    this.latestShapeVersion.value += 1

    return { type: 'extrude', data: {} }
  }

  private getExtrusionFaceInfo(
    cmd: Extract<ModelingCmd, { type: 'solid3d_get_extrusion_face_info' }>,
    _range: SourceRange
  ): OkModelingCmdResponse {
    const solid =
      this.solids.get(cmd.object_id) ||
      Array.from(this.solids.values()).find(
        (candidate) => candidate.sourceRegionId === cmd.object_id
      )
    if (!solid) {
      throw new Error(`No OpenCascade solid found for ${cmd.object_id}`)
    }
    const region = this.regions.get(solid.sourceRegionId)
    if (!region) {
      throw new Error(`No OpenCascade region found for ${solid.sourceRegionId}`)
    }

    return {
      type: 'solid3d_get_extrusion_face_info',
      data: {
        faces: [
          {
            cap: 'none',
            curve_id: cmd.edge_id || region.regionEdgeId,
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
    const path = this.paths.get(pathId)
    if (!path) {
      throw new Error(`No OpenCascade path found for ${pathId}`)
    }
    return path
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

function lengthValue(value: unknown): number {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && 'value' in value) {
    const v = (value as { value: unknown }).value
    if (typeof v === 'number') return v
  }
  return 0
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

function modeling(response: OkModelingCmdResponse): ModelingExecutionResult {
  return { kind: 'modeling', response }
}

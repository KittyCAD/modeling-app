import { encode as msgpackEncode } from '@msgpack/msgpack'
import { signal, type Signal } from '@preact/signals-core'
import type { ModelingCommandResponses } from '@src/network/connectionManager'
import type {
  OpenCascadePlaneMesh,
  OpenCascadePlaneMeshes,
  OpenCascadeGdtAnnotationMeshes,
  OpenCascadeRegionMeshes,
  OpenCascadeRenderSnapshot,
  OpenCascadeSketchLineMeshes,
  OpenCascadeTopologyMeshes,
  OpenCascadeVisibleSolidGlb,
} from '@src/network/openCascadeCommandManager'

type OpenCascadeWorkerResponse =
  | {
      type: 'response'
      id: number
      ok: true
      result: unknown
    }
  | {
      type: 'response'
      id: number
      ok: false
      error: string
    }
  | {
      type: 'stream'
      snapshot: OpenCascadeRenderSnapshotPatch
    }

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

const activeOpenCascadeWorkerClients = new Set<OpenCascadeWorkerClient>()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const client of activeOpenCascadeWorkerClients) {
      client.dispose()
    }
    activeOpenCascadeWorkerClients.clear()
  })
}

const EMPTY_SNAPSHOT: OpenCascadeRenderSnapshot = {
  versions: {
    shape: 0,
    profile: 0,
    topology: 0,
    sketch: 0,
    region: 0,
    plane: 0,
    visibility: 0,
  },
  selectionFilter: ['face', 'edge', 'solid2d', 'curve', 'object', 'path'],
  solidCount: 0,
  hiddenObjectIds: [],
  topologyMeshes: { version: 0, solids: [] },
  sketchLineMeshes: { version: 0, segments: [] },
  planeMeshes: { version: 0, planes: [] },
  gdtAnnotationMeshes: { version: 0, annotations: [] },
  regionMeshes: { version: 0, regions: [] },
  pathPlanes: {},
  pathVisibility: {},
}

type OpenCascadeRenderSnapshotPatch = Partial<
  Omit<OpenCascadeRenderSnapshot, 'versions'>
> &
  Pick<OpenCascadeRenderSnapshot, 'versions'>

export type OpenCascadeManagerLike = {
  latestShapeVersion: Signal<number>
  latestProfileVersion: Signal<number>
  latestTopologyVersion: Signal<number>
  latestSketchVersion: Signal<number>
  latestRegionVersion: Signal<number>
  latestPlaneVersion: Signal<number>
  latestVisibilityVersion: Signal<number>
  latestSelectionFilter: Signal<string[]>
  latestExportError: Signal<string | undefined>
  startNewSession(): Promise<void>
  recordRollbackMarker(rangeStr: string): Promise<boolean>
  fireModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): void
  sendModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): Promise<Uint8Array>
  waitForAllModelingCommands?(): Promise<ModelingCommandResponses>
  getSolidCount(): number
  exportLastBrep?(): Uint8Array | undefined
  exportLastBrepBytes?(): Promise<Uint8Array>
  exportLatestGlbBytes(): Promise<Uint8Array>
  exportVisibleGlbBytes(): Promise<OpenCascadeVisibleSolidGlb[]>
  exportLatestProfileGlbBytes(): Promise<Uint8Array>
  exportLatestTopologyMeshes(): OpenCascadeTopologyMeshes
  exportLatestSketchLineMeshes(): OpenCascadeSketchLineMeshes
  exportOpenCascadePathPlane(pathId: string): OpenCascadePlaneMesh | undefined
  isPathVisible(pathId: string): boolean
  exportLatestPlaneMeshes(): OpenCascadePlaneMeshes
  exportLatestGdtAnnotationMeshes(): OpenCascadeGdtAnnotationMeshes
  isObjectHidden(id: string): boolean
  exportLatestRegionMeshes(): Promise<OpenCascadeRegionMeshes>
  exportRenderSnapshot?(): Promise<OpenCascadeRenderSnapshot>
  dispose?(): void
}

export function shouldUseOpenCascadeWorker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    !(
      typeof process !== 'undefined' &&
      (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true')
    )
  )
}

export class OpenCascadeWorkerClient implements OpenCascadeManagerLike {
  readonly latestShapeVersion = signal(0)
  readonly latestProfileVersion = signal(0)
  readonly latestTopologyVersion = signal(0)
  readonly latestSketchVersion = signal(0)
  readonly latestRegionVersion = signal(0)
  readonly latestPlaneVersion = signal(0)
  readonly latestVisibilityVersion = signal(0)
  readonly latestSelectionFilter = signal<string[]>([
    ...EMPTY_SNAPSHOT.selectionFilter,
  ])
  readonly latestExportError = signal<string | undefined>(undefined)

  private readonly worker: Worker
  private nextRequestId = 1
  private pendingRequests = new Map<number, PendingRequest>()
  private snapshot = EMPTY_SNAPSHOT
  private hiddenObjectIds = new Set<string>()
  private disposed = false

  constructor() {
    this.worker = new Worker(
      new URL('./openCascadeCommandManager.worker.ts', import.meta.url),
      { type: 'module' }
    )
    this.worker.addEventListener('message', this.handleWorkerMessage)
    this.worker.addEventListener('error', this.handleWorkerError)
    activeOpenCascadeWorkerClients.add(this)
  }

  dispose() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    activeOpenCascadeWorkerClients.delete(this)
    this.worker.removeEventListener('message', this.handleWorkerMessage)
    this.worker.removeEventListener('error', this.handleWorkerError)
    for (const request of this.pendingRequests.values()) {
      request.reject(new Error('OpenCascade worker was disposed'))
    }
    this.pendingRequests.clear()
    this.worker.terminate()
  }

  async startNewSession(): Promise<void> {
    await this.request('startNewSession')
  }

  async recordRollbackMarker(rangeStr: string): Promise<boolean> {
    return this.request<boolean>('recordRollbackMarker', [rangeStr])
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
    ).catch((error) => console.warn(error))
  }

  async sendModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): Promise<Uint8Array> {
    try {
      return await this.request<Uint8Array>('sendModelingCommandFromWasm', [
        id,
        rangeStr,
        commandStr,
        idToRangeStr,
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.latestExportError.value = message
      return msgpackEncode({
        success: false,
        request_id: id,
        errors: [
          {
            error_code: 'internal_api',
            message,
          },
        ],
      })
    }
  }

  getSolidCount(): number {
    return this.snapshot.solidCount
  }

  exportLastBrep(): Uint8Array | undefined {
    return undefined
  }

  async exportLastBrepBytes(): Promise<Uint8Array> {
    return (
      (await this.request<Uint8Array | undefined>('exportLastBrep')) ??
      new Uint8Array()
    )
  }

  async exportLatestGlbBytes(): Promise<Uint8Array> {
    return this.request<Uint8Array>('exportLatestGlbBytes')
  }

  async exportVisibleGlbBytes(): Promise<OpenCascadeVisibleSolidGlb[]> {
    return this.request<OpenCascadeVisibleSolidGlb[]>('exportVisibleGlbBytes')
  }

  async exportLatestProfileGlbBytes(): Promise<Uint8Array> {
    return this.request<Uint8Array>('exportLatestProfileGlbBytes')
  }

  exportLatestTopologyMeshes(): OpenCascadeTopologyMeshes {
    return this.snapshot.topologyMeshes
  }

  exportLatestSketchLineMeshes(): OpenCascadeSketchLineMeshes {
    return this.snapshot.sketchLineMeshes
  }

  exportOpenCascadePathPlane(pathId: string): OpenCascadePlaneMesh | undefined {
    return this.snapshot.pathPlanes[pathId]
  }

  isPathVisible(pathId: string): boolean {
    return this.snapshot.pathVisibility[pathId] ?? true
  }

  exportLatestPlaneMeshes(): OpenCascadePlaneMeshes {
    return this.snapshot.planeMeshes
  }

  exportLatestGdtAnnotationMeshes(): OpenCascadeGdtAnnotationMeshes {
    return this.snapshot.gdtAnnotationMeshes
  }

  isObjectHidden(id: string): boolean {
    return this.hiddenObjectIds.has(id)
  }

  async exportLatestRegionMeshes(): Promise<OpenCascadeRegionMeshes> {
    return this.snapshot.regionMeshes
  }

  async exportRenderSnapshot(): Promise<OpenCascadeRenderSnapshot> {
    return this.request<OpenCascadeRenderSnapshot>('exportRenderSnapshot')
  }

  private request<T>(method: string, args: unknown[] = []): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error('OpenCascade worker was disposed'))
    }
    const id = this.nextRequestId++
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      this.worker.postMessage({
        type: 'request',
        id,
        method,
        args,
      })
    })
  }

  private readonly handleWorkerMessage = (
    event: MessageEvent<OpenCascadeWorkerResponse>
  ) => {
    const message = event.data
    if (message.type === 'stream') {
      this.applySnapshot(message.snapshot)
      return
    }

    const pending = this.pendingRequests.get(message.id)
    if (!pending) {
      return
    }
    this.pendingRequests.delete(message.id)
    if (message.ok) {
      pending.resolve(message.result)
    } else {
      pending.reject(new Error(message.error))
    }
  }

  private readonly handleWorkerError = (event: ErrorEvent) => {
    const error = new Error(event.message || 'OpenCascade worker failed')
    for (const request of this.pendingRequests.values()) {
      request.reject(error)
    }
    this.pendingRequests.clear()
  }

  private applySnapshot(snapshot: OpenCascadeRenderSnapshotPatch) {
    this.snapshot = {
      ...this.snapshot,
      ...snapshot,
      versions: snapshot.versions,
      selectionFilter:
        snapshot.selectionFilter ?? this.snapshot.selectionFilter,
      hiddenObjectIds:
        snapshot.hiddenObjectIds ?? this.snapshot.hiddenObjectIds,
      topologyMeshes: snapshot.topologyMeshes ?? this.snapshot.topologyMeshes,
      sketchLineMeshes:
        snapshot.sketchLineMeshes ?? this.snapshot.sketchLineMeshes,
      planeMeshes: snapshot.planeMeshes ?? this.snapshot.planeMeshes,
      gdtAnnotationMeshes:
        snapshot.gdtAnnotationMeshes ?? this.snapshot.gdtAnnotationMeshes,
      regionMeshes: snapshot.regionMeshes ?? this.snapshot.regionMeshes,
      pathPlanes: snapshot.pathPlanes ?? this.snapshot.pathPlanes,
      pathVisibility: snapshot.pathVisibility ?? this.snapshot.pathVisibility,
    }
    this.hiddenObjectIds = new Set(this.snapshot.hiddenObjectIds)
    this.latestShapeVersion.value = this.snapshot.versions.shape
    this.latestProfileVersion.value = this.snapshot.versions.profile
    this.latestTopologyVersion.value = this.snapshot.versions.topology
    this.latestSketchVersion.value = this.snapshot.versions.sketch
    this.latestRegionVersion.value = this.snapshot.versions.region
    this.latestPlaneVersion.value = this.snapshot.versions.plane
    this.latestVisibilityVersion.value = this.snapshot.versions.visibility
    this.latestSelectionFilter.value = [...this.snapshot.selectionFilter]
    this.latestExportError.value = this.snapshot.exportError
  }
}

export class OpenCascadeMainThreadClient implements OpenCascadeManagerLike {
  readonly latestShapeVersion = signal(0)
  readonly latestProfileVersion = signal(0)
  readonly latestTopologyVersion = signal(0)
  readonly latestSketchVersion = signal(0)
  readonly latestRegionVersion = signal(0)
  readonly latestPlaneVersion = signal(0)
  readonly latestVisibilityVersion = signal(0)
  readonly latestSelectionFilter = signal<string[]>([
    ...EMPTY_SNAPSHOT.selectionFilter,
  ])
  readonly latestExportError = signal<string | undefined>(undefined)

  private manager: OpenCascadeManagerLike | undefined
  private managerPromise: Promise<OpenCascadeManagerLike> | undefined
  private readonly options?: { registerLatest?: boolean }

  constructor(options?: { registerLatest?: boolean }) {
    this.options = options
  }

  async startNewSession(): Promise<void> {
    const manager = await this.loadManager()
    await manager.startNewSession()
    this.syncFromManager(manager)
  }

  async recordRollbackMarker(rangeStr: string): Promise<boolean> {
    const manager = await this.loadManager()
    const result = await manager.recordRollbackMarker(rangeStr)
    this.syncFromManager(manager)
    return result
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
    ).catch((error) => console.warn(error))
  }

  async sendModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): Promise<Uint8Array> {
    const manager = await this.loadManager()
    const result = await manager.sendModelingCommandFromWasm(
      id,
      rangeStr,
      commandStr,
      idToRangeStr
    )
    this.syncFromManager(manager)
    return result
  }

  getSolidCount(): number {
    return this.manager?.getSolidCount() ?? 0
  }

  exportLastBrep(): Uint8Array | undefined {
    return this.manager?.exportLastBrep?.()
  }

  async exportLastBrepBytes(): Promise<Uint8Array> {
    return this.exportLastBrep() ?? new Uint8Array()
  }

  async exportLatestGlbBytes(): Promise<Uint8Array> {
    const manager = await this.loadManager()
    return manager.exportLatestGlbBytes()
  }

  async exportVisibleGlbBytes(): Promise<OpenCascadeVisibleSolidGlb[]> {
    const manager = await this.loadManager()
    return manager.exportVisibleGlbBytes()
  }

  async exportLatestProfileGlbBytes(): Promise<Uint8Array> {
    const manager = await this.loadManager()
    return manager.exportLatestProfileGlbBytes()
  }

  exportLatestTopologyMeshes(): OpenCascadeTopologyMeshes {
    return (
      this.manager?.exportLatestTopologyMeshes() ??
      EMPTY_SNAPSHOT.topologyMeshes
    )
  }

  exportLatestSketchLineMeshes(): OpenCascadeSketchLineMeshes {
    return (
      this.manager?.exportLatestSketchLineMeshes() ??
      EMPTY_SNAPSHOT.sketchLineMeshes
    )
  }

  exportOpenCascadePathPlane(pathId: string): OpenCascadePlaneMesh | undefined {
    return this.manager?.exportOpenCascadePathPlane(pathId)
  }

  isPathVisible(pathId: string): boolean {
    return this.manager?.isPathVisible(pathId) ?? true
  }

  exportLatestPlaneMeshes(): OpenCascadePlaneMeshes {
    return this.manager?.exportLatestPlaneMeshes() ?? EMPTY_SNAPSHOT.planeMeshes
  }

  exportLatestGdtAnnotationMeshes(): OpenCascadeGdtAnnotationMeshes {
    return (
      this.manager?.exportLatestGdtAnnotationMeshes() ??
      EMPTY_SNAPSHOT.gdtAnnotationMeshes
    )
  }

  isObjectHidden(id: string): boolean {
    return this.manager?.isObjectHidden(id) ?? false
  }

  async exportLatestRegionMeshes(): Promise<OpenCascadeRegionMeshes> {
    return (
      (await this.manager?.exportLatestRegionMeshes()) ??
      EMPTY_SNAPSHOT.regionMeshes
    )
  }

  async exportRenderSnapshot(): Promise<OpenCascadeRenderSnapshot> {
    const manager = await this.loadManager()
    if (manager.exportRenderSnapshot) {
      return manager.exportRenderSnapshot()
    }
    return EMPTY_SNAPSHOT
  }

  private async loadManager(): Promise<OpenCascadeManagerLike> {
    if (!this.managerPromise) {
      this.managerPromise = import(
        '@src/network/openCascadeCommandManager'
      ).then(({ OpenCascadeCommandManager }) => {
        this.manager = new OpenCascadeCommandManager(this.options)
        this.syncFromManager(this.manager)
        return this.manager
      })
    }
    return this.managerPromise
  }

  private syncFromManager(manager: OpenCascadeManagerLike) {
    this.latestShapeVersion.value = manager.latestShapeVersion.value
    this.latestProfileVersion.value = manager.latestProfileVersion.value
    this.latestTopologyVersion.value = manager.latestTopologyVersion.value
    this.latestSketchVersion.value = manager.latestSketchVersion.value
    this.latestRegionVersion.value = manager.latestRegionVersion.value
    this.latestPlaneVersion.value = manager.latestPlaneVersion.value
    this.latestVisibilityVersion.value = manager.latestVisibilityVersion.value
    this.latestSelectionFilter.value = [...manager.latestSelectionFilter.value]
    this.latestExportError.value = manager.latestExportError.value
  }
}

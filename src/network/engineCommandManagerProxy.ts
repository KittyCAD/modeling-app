import type { WebSocketResponse } from '@kittycad/lib'
import { signal } from '@preact/signals-core'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import type { OpenCascadePreviewHandleState } from '@src/lib/commandTypes'
import { EXECUTE_AST_INTERRUPT_ERROR_MESSAGE } from '@src/lib/constants'
import type RustContext from '@src/lib/rustContext'
import { reportRejection } from '@src/lib/trap'
import type { DeepPartial } from '@src/lib/types'
import { uuidv4 } from '@src/lib/utils'
import { ConnectionManager } from '@src/network/connectionManager'
import {
  OcctWasmTransport,
  createDefaultOcctWasmCommandCore,
} from '@src/network/occtWasmTransport'
import type {
  OpenCascadeGdtAnnotationMeshes,
  OpenCascadePlaneMeshes,
  OpenCascadeSketchLineMeshes,
  OpenCascadeVisibleSolidGlb,
} from '@src/network/openCascadeCommandManager'
import type { OpenCascadeManagerLike } from '@src/network/openCascadeWorkerClient'
import type { ManagerTearDown } from '@src/network/utils'
import {
  EngineCommandManagerEvents,
  EngineConnectionEvents,
  EngineConnectionStateType,
} from '@src/network/utils'

type StartArgs = Parameters<ConnectionManager['start']>[0]

export type EngineCommandManagerProxyDeps = {
  createOpenCascadeTransport?: typeof createOpenCascadeTransport
}

export class EngineCommandManagerProxy extends ConnectionManager {
  readonly openCascadeTransport: OcctWasmTransport
  readonly openCascadeCommandManager: OpenCascadeManagerLike
  readonly latestOpenCascadePreviewVersion = signal(0)
  readonly latestOpenCascadePreviewStatus = signal<
    'idle' | 'running' | 'ready' | 'error'
  >('idle')
  private openCascadePreviewTransport: OcctWasmTransport
  private openCascadePreviewCommandManager: OpenCascadeManagerLike
  private openCascadePreviewRoutingManager: OpenCascadeManagerLike | undefined
  private openCascadePreviewRequestId = 0
  private openCascadePreviewRunQueue: Promise<void> = Promise.resolve()
  private openCascadePreviewGlbs: OpenCascadeVisibleSolidGlb[] = []
  private openCascadePreviewSketchLines: OpenCascadeSketchLineMeshes = {
    version: 0,
    segments: [],
  }
  private openCascadePreviewPlanes: OpenCascadePlaneMeshes = {
    version: 0,
    planes: [],
  }
  private openCascadePreviewHandleState:
    | OpenCascadePreviewHandleState
    | undefined

  constructor(
    systemDeps: ConstructorParameters<typeof ConnectionManager>[0],
    deps: EngineCommandManagerProxyDeps = {}
  ) {
    super(systemDeps)
    const createTransport =
      deps.createOpenCascadeTransport ?? createOpenCascadeTransport
    this.openCascadeTransport = createTransport()
    this.openCascadeCommandManager = this.openCascadeTransport.commandCore
    this.openCascadePreviewTransport = createTransport({
      registerLatest: false,
    })
    this.openCascadePreviewCommandManager =
      this.openCascadePreviewTransport.commandCore
  }

  get currentEngine() {
    return this.settings.engine
  }

  get isOpenCascade() {
    return this.currentEngine === 'open_cascade'
  }

  async start(args: StartArgs) {
    if (!this.isOpenCascade) {
      return super.start(args)
    }

    if (this.started) {
      return Promise.reject(
        new Error(
          'You tried to start the engine again, why are you starting it? call tearDown first.'
        )
      )
    }

    this.started = true
    this.rejectAllPendingCommands()
    this.streamDimensions = {
      width: args.width,
      height: args.height,
    }
    this.dispatchEvent(
      new CustomEvent(EngineCommandManagerEvents.EngineAvailable, {
        detail: null,
      })
    )
    this.dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
        detail: {
          type: EngineConnectionStateType.ConnectionEstablished,
          value: undefined,
        },
      })
    )
    await this.openCascadeTransport.start(args)
  }

  tearDown(options?: ManagerTearDown) {
    if (!this.isOpenCascade || this.connection) {
      return super.tearDown(options)
    }

    this.rejectAllPendingCommands()
    this.removeAllEventListeners()
    this.openCascadeTransport.tearDown(options)
    this.started = false
    this.dispatchEvent(new CustomEvent(EngineCommandManagerEvents.Offline, {}))
  }

  async startNewSession() {
    if (!this.isOpenCascade) {
      return super.startNewSession()
    }

    this.responseMap = {}
    await this.openCascadeTransport.startNewSession()
    this.clearOpenCascadePreview()
  }

  async recordRollbackMarker(sourceRange: string) {
    if (!this.isOpenCascade) {
      return false
    }

    return this.openCascadeTransport.recordRollbackMarker(sourceRange)
  }

  async setTheme(...args: Parameters<ConnectionManager['setTheme']>) {
    if (this.isOpenCascade) {
      return
    }

    return super.setTheme(...args)
  }

  async setDefaultSystemProperties(
    ...args: Parameters<ConnectionManager['setDefaultSystemProperties']>
  ) {
    if (this.isOpenCascade) {
      return
    }

    return super.setDefaultSystemProperties(...args)
  }

  async setHighlightEdges(
    ...args: Parameters<ConnectionManager['setHighlightEdges']>
  ) {
    if (this.isOpenCascade) {
      return
    }

    return super.setHighlightEdges(...args)
  }

  async setShowScaleGrid(
    ...args: Parameters<ConnectionManager['setShowScaleGrid']>
  ) {
    if (this.isOpenCascade) {
      return
    }

    return super.setShowScaleGrid(...args)
  }

  async handleResize(args: Parameters<ConnectionManager['handleResize']>[0]) {
    if (this.isOpenCascade) {
      this.streamDimensions = args
      return
    }

    return super.handleResize(args)
  }

  async sendSceneCommand(
    command: EngineCommand,
    forceWebsocket = false
  ): Promise<WebSocketResponse | [WebSocketResponse] | null> {
    if (!this.isOpenCascade) {
      return super.sendSceneCommand(command, forceWebsocket)
    }

    if (
      command.type !== 'modeling_cmd_req' &&
      command.type !== 'modeling_cmd_batch_req'
    ) {
      return null
    }

    try {
      const transport = this.activeOpenCascadeTransport()
      return await transport.sendSceneCommand(command)
    } catch (error) {
      console.warn(error)
      return null
    }
  }

  fireModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): undefined | Error {
    if (!this.isOpenCascade) {
      return super.fireModelingCommandFromWasm(
        id,
        rangeStr,
        commandStr,
        idToRangeStr
      )
    }

    if (this.executionIsStale) {
      return new Error(EXECUTE_AST_INTERRUPT_ERROR_MESSAGE)
    }

    this.activeOpenCascadeTransport()
      .sendModelingCommandFromWasm(id, rangeStr, commandStr, idToRangeStr)
      .catch(reportRejection)
  }

  async sendModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): Promise<Uint8Array | undefined> {
    if (!this.isOpenCascade) {
      return super.sendModelingCommandFromWasm(
        id,
        rangeStr,
        commandStr,
        idToRangeStr
      )
    }

    if (this.executionIsStale) {
      return Promise.reject(EXECUTE_AST_INTERRUPT_ERROR_MESSAGE)
    }

    return this.activeOpenCascadeTransport().sendModelingCommandFromWasm(
      id,
      rangeStr,
      commandStr,
      idToRangeStr
    )
  }

  waitForAllModelingCommands(): Promise<[WebSocketResponse][]> {
    if (this.isOpenCascade) {
      return this.openCascadeTransport.waitForAllModelingCommands()
    }

    return super.waitForAllModelingCommands()
  }

  rejectAllModelingCommands(rejectionMessage: string) {
    if (this.isOpenCascade) {
      this.executionIsStale = true
      return
    }

    return super.rejectAllModelingCommands(rejectionMessage)
  }

  async setPlaneHidden(id: string, hidden: boolean) {
    if (this.isOpenCascade) {
      return this.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'object_visible',
          object_id: id,
          hidden,
        },
      })
    }

    return super.setPlaneHidden(id, hidden)
  }

  async exportLatestOpenCascadeGlbBytes() {
    return this.openCascadeCommandManager.exportLatestGlbBytes()
  }

  async exportVisibleOpenCascadeGlbBytes() {
    return this.openCascadeCommandManager.exportVisibleGlbBytes()
  }

  async runOpenCascadePreviewAst(
    ast: Node<Program>,
    rustContext: RustContext,
    settings: DeepPartial<Configuration>,
    path?: string,
    handleState?: OpenCascadePreviewHandleState
  ) {
    if (!this.isOpenCascade) {
      return
    }

    const requestId = ++this.openCascadePreviewRequestId
    this.latestOpenCascadePreviewStatus.value = 'running'
    this.openCascadePreviewRunQueue = this.openCascadePreviewRunQueue
      .catch(() => undefined)
      .then(() =>
        this.runQueuedOpenCascadePreviewAst(
          requestId,
          ast,
          rustContext,
          settings,
          path,
          handleState
        )
      )
    return this.openCascadePreviewRunQueue
  }

  private async runQueuedOpenCascadePreviewAst(
    requestId: number,
    ast: Node<Program>,
    rustContext: RustContext,
    settings: DeepPartial<Configuration>,
    path?: string,
    handleState?: OpenCascadePreviewHandleState
  ) {
    if (requestId !== this.openCascadePreviewRequestId) {
      return
    }
    const previewManager = this.openCascadePreviewCommandManager
    const previewEngineManager =
      this.createOpenCascadePreviewEngineManager(previewManager)
    this.openCascadePreviewRoutingManager = previewManager
    try {
      await previewManager.startNewSession()
      if (requestId !== this.openCascadePreviewRequestId) {
        return
      }
      await rustContext.executePreviewWithEngineManager(
        ast,
        settings,
        previewEngineManager,
        path
      )
      if (requestId !== this.openCascadePreviewRequestId) {
        return
      }
      const visiblePreviewGlbs = await previewManager.exportVisibleGlbBytes()
      const visiblePreviewSketchLines =
        previewManager.exportLatestSketchLineMeshes()
      const visiblePreviewPlanes = previewManager.exportLatestPlaneMeshes()
      if (requestId !== this.openCascadePreviewRequestId) {
        previewManager.dispose?.()
        return
      }
      if (
        visiblePreviewGlbs.length === 0 &&
        visiblePreviewSketchLines.segments.length === 0 &&
        visiblePreviewPlanes.planes.length === 0
      ) {
        this.latestOpenCascadePreviewStatus.value = 'ready'
        return
      }
      this.openCascadePreviewGlbs = visiblePreviewGlbs
      this.openCascadePreviewSketchLines = visiblePreviewSketchLines
      this.openCascadePreviewPlanes = visiblePreviewPlanes
      this.openCascadePreviewHandleState = handleState
      this.latestOpenCascadePreviewStatus.value = 'ready'
      this.latestOpenCascadePreviewVersion.value += 1
    } catch (error) {
      if (requestId === this.openCascadePreviewRequestId) {
        this.latestOpenCascadePreviewStatus.value = 'error'
      }
      return Promise.reject(error)
    } finally {
      if (this.openCascadePreviewRoutingManager === previewManager) {
        this.openCascadePreviewRoutingManager = undefined
      }
    }
  }

  clearOpenCascadePreview() {
    this.openCascadePreviewRequestId += 1
    this.openCascadePreviewRoutingManager = undefined
    this.openCascadePreviewGlbs = []
    this.openCascadePreviewSketchLines = {
      version: this.openCascadePreviewSketchLines.version + 1,
      segments: [],
    }
    this.openCascadePreviewPlanes = {
      version: this.openCascadePreviewPlanes.version + 1,
      planes: [],
    }
    this.openCascadePreviewHandleState = undefined
    this.latestOpenCascadePreviewStatus.value = 'idle'
    this.latestOpenCascadePreviewVersion.value += 1
  }

  async exportVisibleOpenCascadePreviewGlbBytes() {
    return this.openCascadePreviewGlbs
  }

  exportLatestOpenCascadePreviewSketchLineMeshes() {
    return this.openCascadePreviewSketchLines
  }

  exportLatestOpenCascadePreviewPlaneMeshes() {
    return this.openCascadePreviewPlanes
  }

  exportLatestOpenCascadePreviewHandleState() {
    return this.openCascadePreviewHandleState
  }

  private createOpenCascadePreviewEngineManager(
    manager: OpenCascadeManagerLike
  ) {
    const transport =
      manager === this.openCascadePreviewTransport.commandCore
        ? this.openCascadePreviewTransport
        : new OcctWasmTransport(manager)

    return {
      currentEngine: 'open_cascade',
      isOpenCascade: true,
      openCascadeCommandManager: manager,
      started: true,
      fireModelingCommandFromWasm: (
        id: string,
        rangeStr: string,
        commandStr: string,
        idToRangeStr: string
      ) =>
        transport.fireModelingCommandFromWasm(
          id,
          rangeStr,
          commandStr,
          idToRangeStr
        ),
      sendModelingCommandFromWasm: (
        id: string,
        rangeStr: string,
        commandStr: string,
        idToRangeStr: string
      ) =>
        transport.sendModelingCommandFromWasm(
          id,
          rangeStr,
          commandStr,
          idToRangeStr
        ),
      sendSceneCommand: async (command: EngineCommand) => {
        if (
          command.type !== 'modeling_cmd_req' &&
          command.type !== 'modeling_cmd_batch_req'
        ) {
          return null
        }

        return transport.sendSceneCommand(command)
      },
      waitForAllModelingCommands: () => transport.waitForAllModelingCommands(),
    }
  }

  private activeOpenCascadeTransport() {
    return this.openCascadePreviewRoutingManager
      ? this.openCascadePreviewTransport
      : this.openCascadeTransport
  }

  async exportLatestOpenCascadeProfileGlbBytes() {
    return this.openCascadeCommandManager.exportLatestProfileGlbBytes()
  }

  exportLatestOpenCascadeTopologyMeshes() {
    return this.openCascadeCommandManager.exportLatestTopologyMeshes()
  }

  exportLatestOpenCascadeSketchLineMeshes() {
    return this.openCascadeCommandManager.exportLatestSketchLineMeshes()
  }

  exportOpenCascadePathPlane(pathId: string) {
    return this.openCascadeCommandManager.exportOpenCascadePathPlane(pathId)
  }

  isOpenCascadePathVisible(pathId: string) {
    return this.openCascadeCommandManager.isPathVisible(pathId)
  }

  exportLatestOpenCascadePlaneMeshes() {
    return this.openCascadeCommandManager.exportLatestPlaneMeshes()
  }

  exportLatestOpenCascadeGdtAnnotationMeshes(): OpenCascadeGdtAnnotationMeshes {
    return this.openCascadeCommandManager.exportLatestGdtAnnotationMeshes()
  }

  async exportLatestOpenCascadeRegionMeshes() {
    return this.openCascadeCommandManager.exportLatestRegionMeshes()
  }

  async exportLatestOpenCascadeGlbUrl() {
    const bytes = await this.exportLatestOpenCascadeGlbBytes()
    const blob = new Blob([bytes as BlobPart], {
      type: 'model/gltf-binary',
    })
    return URL.createObjectURL(blob)
  }

  async exportLatestOpenCascadeBrepBytes() {
    if (this.openCascadeCommandManager.exportLastBrepBytes) {
      return this.openCascadeCommandManager.exportLastBrepBytes()
    }
    const bytes = this.openCascadeCommandManager.exportLastBrep?.()
    return bytes ?? new Uint8Array()
  }
}

function createOpenCascadeTransport(options?: {
  registerLatest?: boolean
}): OcctWasmTransport {
  return new OcctWasmTransport(createDefaultOcctWasmCommandCore(options))
}

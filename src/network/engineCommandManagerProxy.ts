import type { WebSocketResponse } from '@kittycad/lib'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import { decode as msgpackDecode } from '@msgpack/msgpack'
import { signal } from '@preact/signals-core'
import { defaultSourceRange } from '@src/lang/sourceRange'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import type RustContext from '@src/lib/rustContext'
import { EXECUTE_AST_INTERRUPT_ERROR_MESSAGE } from '@src/lib/constants'
import type { DeepPartial } from '@src/lib/types'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import { ConnectionManager } from '@src/network/connectionManager'
import {
  OpenCascadeMainThreadClient,
  OpenCascadeWorkerClient,
  type OpenCascadeManagerLike,
  shouldUseOpenCascadeWorker,
} from '@src/network/openCascadeWorkerClient'
import type { ManagerTearDown } from '@src/network/utils'
import {
  EngineCommandManagerEvents,
  EngineConnectionEvents,
  EngineConnectionStateType,
} from '@src/network/utils'

type StartArgs = Parameters<ConnectionManager['start']>[0]

export class EngineCommandManagerProxy extends ConnectionManager {
  readonly openCascadeCommandManager = createOpenCascadeManager()
  readonly latestOpenCascadePreviewVersion = signal(0)
  readonly latestOpenCascadePreviewStatus = signal<
    'idle' | 'running' | 'ready' | 'error'
  >('idle')
  private openCascadePreviewCommandManager = createOpenCascadeManager({
    registerLatest: false,
  })
  private openCascadePreviewRoutingManager: OpenCascadeManagerLike | undefined
  private openCascadePreviewRequestId = 0

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
    args.setStreamIsReady(true)
    args.callbackOnUnitTestingConnection?.('auth success')
  }

  tearDown(options?: ManagerTearDown) {
    if (!this.isOpenCascade || this.connection) {
      return super.tearDown(options)
    }

    this.rejectAllPendingCommands()
    this.removeAllEventListeners()
    this.started = false
    this.dispatchEvent(new CustomEvent(EngineCommandManagerEvents.Offline, {}))
  }

  async startNewSession() {
    if (!this.isOpenCascade) {
      return super.startNewSession()
    }

    this.responseMap = {}
    await this.openCascadeCommandManager.startNewSession()
    this.clearOpenCascadePreview()
  }

  async recordRollbackMarker(sourceRange: string) {
    if (!this.isOpenCascade) {
      return false
    }

    return this.openCascadeCommandManager.recordRollbackMarker(sourceRange)
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
      const manager =
        this.openCascadePreviewRoutingManager || this.openCascadeCommandManager
      const encoded = await manager.sendModelingCommandFromWasm(
        (command as { cmd_id?: string; batch_id?: string }).cmd_id ||
          (command as { batch_id?: string }).batch_id ||
          uuidv4(),
        JSON.stringify(defaultSourceRange()),
        JSON.stringify(command),
        '{}'
      )
      return msgpackDecode(encoded) as WebSocketResponse
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

    const manager =
      this.openCascadePreviewRoutingManager || this.openCascadeCommandManager
    manager
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

    const manager =
      this.openCascadePreviewRoutingManager || this.openCascadeCommandManager
    return manager.sendModelingCommandFromWasm(
      id,
      rangeStr,
      commandStr,
      idToRangeStr
    )
  }

  waitForAllModelingCommands() {
    if (this.isOpenCascade) {
      return Promise.resolve([])
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
    path?: string
  ) {
    if (!this.isOpenCascade) {
      return
    }

    const requestId = ++this.openCascadePreviewRequestId
    const previewManager = createOpenCascadeManager({
      registerLatest: false,
    })
    const previewEngineManager =
      this.createOpenCascadePreviewEngineManager(previewManager)
    this.openCascadePreviewRoutingManager = previewManager
    this.latestOpenCascadePreviewStatus.value = 'running'
    try {
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
      this.openCascadePreviewCommandManager.dispose?.()
      this.openCascadePreviewCommandManager = previewManager
      this.latestOpenCascadePreviewStatus.value = 'ready'
      this.latestOpenCascadePreviewVersion.value += 1
    } catch (error) {
      if (requestId === this.openCascadePreviewRequestId) {
        this.latestOpenCascadePreviewStatus.value = 'error'
      }
      throw error
    } finally {
      if (this.openCascadePreviewRoutingManager === previewManager) {
        this.openCascadePreviewRoutingManager = undefined
      }
      if (this.openCascadePreviewCommandManager !== previewManager) {
        previewManager.dispose?.()
      }
    }
  }

  clearOpenCascadePreview() {
    this.openCascadePreviewRequestId += 1
    this.openCascadePreviewRoutingManager?.dispose?.()
    this.openCascadePreviewRoutingManager = undefined
    this.openCascadePreviewCommandManager.dispose?.()
    this.openCascadePreviewCommandManager = createOpenCascadeManager({
      registerLatest: false,
    })
    this.latestOpenCascadePreviewStatus.value = 'idle'
    this.latestOpenCascadePreviewVersion.value += 1
  }

  async exportVisibleOpenCascadePreviewGlbBytes() {
    return this.openCascadePreviewCommandManager.exportVisibleGlbBytes()
  }

  exportLatestOpenCascadePreviewSketchLineMeshes() {
    return this.openCascadePreviewCommandManager.exportLatestSketchLineMeshes()
  }

  exportLatestOpenCascadePreviewPlaneMeshes() {
    return this.openCascadePreviewCommandManager.exportLatestPlaneMeshes()
  }

  private createOpenCascadePreviewEngineManager(
    manager: OpenCascadeManagerLike
  ) {
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
        manager.fireModelingCommandFromWasm(
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
        manager.sendModelingCommandFromWasm(
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

        const encoded = await manager.sendModelingCommandFromWasm(
          (command as { cmd_id?: string; batch_id?: string }).cmd_id ||
            (command as { batch_id?: string }).batch_id ||
            uuidv4(),
          JSON.stringify(defaultSourceRange()),
          JSON.stringify(command),
          '{}'
        )
        return msgpackDecode(encoded) as WebSocketResponse
      },
      waitForAllModelingCommands: () => Promise.resolve([]),
    }
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

function createOpenCascadeManager(options?: {
  registerLatest?: boolean
}): OpenCascadeManagerLike {
  return shouldUseOpenCascadeWorker()
    ? new OpenCascadeWorkerClient()
    : new OpenCascadeMainThreadClient(options)
}

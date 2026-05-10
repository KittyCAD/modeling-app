import { decode as msgpackDecode } from '@msgpack/msgpack'
import type { WebSocketResponse } from '@kittycad/lib'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import { defaultSourceRange } from '@src/lang/sourceRange'
import { EXECUTE_AST_INTERRUPT_ERROR_MESSAGE } from '@src/lib/constants'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import {
  ConnectionManager,
  type ConnectionSystemDeps,
} from '@src/network/connectionManager'
import type { ManagerTearDown } from '@src/network/utils'
import {
  EngineCommandManagerEvents,
  EngineConnectionEvents,
  EngineConnectionStateType,
} from '@src/network/utils'
import { OpenCascadeCommandManager } from '@src/network/openCascadeCommandManager'

type StartArgs = Parameters<ConnectionManager['start']>[0]

export class EngineCommandManagerProxy extends ConnectionManager {
  readonly openCascadeCommandManager = new OpenCascadeCommandManager()

  constructor(systemDeps: ConnectionSystemDeps) {
    super(systemDeps)
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

    if (command.type !== 'modeling_cmd_req') {
      return null
    }

    try {
      const encoded =
        await this.openCascadeCommandManager.sendModelingCommandFromWasm(
          command.cmd_id || uuidv4(),
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

    this.openCascadeCommandManager
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

    return this.openCascadeCommandManager.sendModelingCommandFromWasm(
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

  async exportLatestOpenCascadeProfileGlbBytes() {
    return this.openCascadeCommandManager.exportLatestProfileGlbBytes()
  }

  async exportLatestOpenCascadeGlbUrl() {
    const bytes = await this.exportLatestOpenCascadeGlbBytes()
    const blob = new Blob([bytes as BlobPart], {
      type: 'model/gltf-binary',
    })
    return URL.createObjectURL(blob)
  }

  async exportLatestOpenCascadeBrepBytes() {
    const bytes = this.openCascadeCommandManager.exportLastBrep()
    return bytes ?? new Uint8Array()
  }
}

import type { WebSocketResponse } from '@kittycad/lib'
import { decode as msgpackDecode } from '@msgpack/msgpack'
import { defaultSourceRange } from '@src/lang/sourceRange'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import { uuidv4 } from '@src/lib/utils'
import {
  OpenCascadeMainThreadClient,
  OpenCascadeWorkerClient,
  type OpenCascadeManagerLike,
  shouldUseOpenCascadeWorker,
} from '@src/network/openCascadeWorkerClient'
import type { EngineTransport } from '@src/network/engineTransport'
import type { ManagerTearDown } from '@src/network/utils'

export type OcctWasmCommandCore = OpenCascadeManagerLike

export type OcctWasmTransportStartArgs = {
  width: number
  height: number
  setStreamIsReady: (setStreamIsReady: boolean) => void
  callbackOnUnitTestingConnection?: (message: string) => void
}

export class OcctWasmTransport implements EngineTransport {
  readonly kind = 'occt_wasm'
  private isConnected = false

  constructor(readonly commandCore: OcctWasmCommandCore) {}

  get connected() {
    return this.isConnected
  }

  async connect() {
    this.isConnected = true
  }

  async start(args: OcctWasmTransportStartArgs) {
    await this.connect()
    args.setStreamIsReady(true)
    args.callbackOnUnitTestingConnection?.('auth success')
  }

  tearDown(_options?: ManagerTearDown) {
    this.isConnected = false
  }

  send() {
    // Reliable command dispatch uses sendModelingCommandFromWasm because the
    // OCCT backend follows the KCL executor command path, not WebSocket I/O.
  }

  async startNewSession() {
    await this.commandCore.startNewSession()
  }

  async recordRollbackMarker(rangeStr: string) {
    return this.commandCore.recordRollbackMarker(rangeStr)
  }

  fireModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ) {
    this.commandCore.fireModelingCommandFromWasm(
      id,
      rangeStr,
      commandStr,
      idToRangeStr
    )
  }

  sendModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ) {
    return this.commandCore.sendModelingCommandFromWasm(
      id,
      rangeStr,
      commandStr,
      idToRangeStr
    )
  }

  async sendSceneCommand(
    command: EngineCommand
  ): Promise<WebSocketResponse | null> {
    if (
      command.type !== 'modeling_cmd_req' &&
      command.type !== 'modeling_cmd_batch_req'
    ) {
      return null
    }

    const encoded = await this.commandCore.sendModelingCommandFromWasm(
      (command as { cmd_id?: string; batch_id?: string }).cmd_id ||
        (command as { batch_id?: string }).batch_id ||
        uuidv4(),
      JSON.stringify(defaultSourceRange()),
      JSON.stringify(command),
      '{}'
    )
    return msgpackDecode(encoded) as WebSocketResponse
  }

  waitForAllModelingCommands() {
    return Promise.resolve([])
  }
}

export function createDefaultOcctWasmCommandCore(options?: {
  registerLatest?: boolean
}): OcctWasmCommandCore {
  return shouldUseOpenCascadeWorker()
    ? new OpenCascadeWorkerClient()
    : new OpenCascadeMainThreadClient(options)
}

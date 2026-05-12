import type { WebSocketRequest, WebSocketResponse } from '@kittycad/lib'
import {
  decode as msgpackDecode,
  encode as msgpackEncode,
} from '@msgpack/msgpack'
import { signal } from '@preact/signals-core'
import { isArray } from '@src/lib/utils'
import type { ModelingCommandResponses } from '@src/network/connectionManager'
import type {
  OpenCascadeGdtAnnotationMeshes,
  OpenCascadePlaneMesh,
  OpenCascadePlaneMeshes,
  OpenCascadeRegionMeshes,
  OpenCascadeSketchLineMeshes,
  OpenCascadeTopologyMeshes,
  OpenCascadeVisibleSolidGlb,
} from '@src/network/openCascadeCommandManager'
import type { OpenCascadeManagerLike } from '@src/network/openCascadeWorkerClient'

export type OcctWasmCoreModule = {
  startNewSession(): void | Promise<void>
  recordRollbackMarker(rangeStr: string): boolean | Promise<boolean>
  handleModelingCommand(args: {
    requestId: string
    rangeJson: string
    requestJson: string
    idToRangeJson: string
  }): WebSocketResponse | Promise<WebSocketResponse>
  exportLatestGlbBytes?(): Uint8Array | Promise<Uint8Array>
  exportVisibleGlbBytes?():
    | OpenCascadeVisibleSolidGlb[]
    | Promise<OpenCascadeVisibleSolidGlb[]>
  exportLatestProfileGlbBytes?(): Uint8Array | Promise<Uint8Array>
}

export type OcctWasmCoreModuleFactory =
  | OcctWasmCoreModule
  | (() => OcctWasmCoreModule | Promise<OcctWasmCoreModule>)

export class OcctWasmCommandCoreAdapter implements OpenCascadeManagerLike {
  readonly latestShapeVersion = signal(0)
  readonly latestProfileVersion = signal(0)
  readonly latestTopologyVersion = signal(0)
  readonly latestSketchVersion = signal(0)
  readonly latestRegionVersion = signal(0)
  readonly latestPlaneVersion = signal(0)
  readonly latestVisibilityVersion = signal(0)
  readonly latestSelectionFilter = signal<string[]>([
    'face',
    'edge',
    'solid2d',
    'curve',
    'object',
    'path',
  ])
  readonly latestExportError = signal<string | undefined>(undefined)

  private modulePromise: Promise<OcctWasmCoreModule> | undefined
  private readonly pendingCommands = new Set<Promise<Uint8Array>>()

  constructor(private readonly moduleFactory: OcctWasmCoreModuleFactory) {}

  async startNewSession(): Promise<void> {
    this.latestExportError.value = undefined
    this.bumpShapeVersion()
    await (await this.module()).startNewSession()
  }

  async recordRollbackMarker(rangeStr: string): Promise<boolean> {
    return (await this.module()).recordRollbackMarker(rangeStr)
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
    ).catch((error) => {
      this.latestExportError.value =
        error instanceof Error ? error.message : String(error)
    })
  }

  sendModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): Promise<Uint8Array> {
    const pending = this.sendModelingCommand(
      id,
      rangeStr,
      commandStr,
      idToRangeStr
    )
    this.pendingCommands.add(pending)
    pending.finally(() => this.pendingCommands.delete(pending)).catch(() => {})
    return pending
  }

  async waitForAllModelingCommands(): Promise<ModelingCommandResponses> {
    const encodedResponses = await Promise.all([...this.pendingCommands])
    return encodedResponses.map((encodedResponse) => [
      msgpackDecode(encodedResponse) as WebSocketResponse,
    ])
  }

  getSolidCount(): number {
    return 0
  }

  async exportLatestGlbBytes(): Promise<Uint8Array> {
    return (await this.module()).exportLatestGlbBytes?.() ?? new Uint8Array()
  }

  async exportVisibleGlbBytes(): Promise<OpenCascadeVisibleSolidGlb[]> {
    return (await this.module()).exportVisibleGlbBytes?.() ?? []
  }

  async exportLatestProfileGlbBytes(): Promise<Uint8Array> {
    return (
      (await this.module()).exportLatestProfileGlbBytes?.() ?? new Uint8Array()
    )
  }

  exportLatestTopologyMeshes(): OpenCascadeTopologyMeshes {
    return { version: this.latestTopologyVersion.value, solids: [] }
  }

  exportLatestSketchLineMeshes(): OpenCascadeSketchLineMeshes {
    return { version: this.latestSketchVersion.value, segments: [] }
  }

  exportOpenCascadePathPlane(
    _pathId: string
  ): OpenCascadePlaneMesh | undefined {
    return undefined
  }

  isPathVisible(_pathId: string): boolean {
    return false
  }

  exportLatestPlaneMeshes(): OpenCascadePlaneMeshes {
    return { version: this.latestPlaneVersion.value, planes: [] }
  }

  exportLatestGdtAnnotationMeshes(): OpenCascadeGdtAnnotationMeshes {
    return { version: 0, annotations: [] }
  }

  isObjectHidden(_id: string): boolean {
    return false
  }

  async exportLatestRegionMeshes(): Promise<OpenCascadeRegionMeshes> {
    return { version: this.latestRegionVersion.value, regions: [] }
  }

  private async sendModelingCommand(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): Promise<Uint8Array> {
    try {
      const response = await (await this.module()).handleModelingCommand({
        requestId: id,
        rangeJson: rangeStr,
        requestJson: commandStr,
        idToRangeJson: idToRangeStr,
      })
      this.applyRequestSideEffects(commandStr)
      this.latestExportError.value = undefined
      this.bumpShapeVersion()
      return msgpackEncode(response)
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

  private module(): Promise<OcctWasmCoreModule> {
    this.modulePromise ??= Promise.resolve(
      typeof this.moduleFactory === 'function'
        ? this.moduleFactory()
        : this.moduleFactory
    )
    return this.modulePromise
  }

  private applyRequestSideEffects(commandStr: string) {
    const request = JSON.parse(commandStr) as WebSocketRequest
    if (request.type === 'modeling_cmd_req') {
      this.applyCommandSideEffects(request.cmd)
      return
    }

    if (request.type === 'modeling_cmd_batch_req') {
      for (const item of request.requests) {
        this.applyCommandSideEffects(item.cmd)
      }
    }
  }

  private applyCommandSideEffects(command: {
    type: string
    filter?: string[]
  }) {
    if (command.type === 'set_selection_filter' && isArray(command.filter)) {
      this.latestSelectionFilter.value = [...command.filter]
    }
  }

  private bumpShapeVersion() {
    this.latestShapeVersion.value += 1
    this.latestTopologyVersion.value += 1
  }
}

export function createProtocolOnlyOcctWasmModule(): OcctWasmCoreModule {
  return new ProtocolOnlyOcctWasmModule()
}

class ProtocolOnlyOcctWasmModule implements OcctWasmCoreModule {
  async startNewSession() {}

  recordRollbackMarker(_rangeStr: string) {
    return true
  }

  handleModelingCommand({
    requestId,
    requestJson,
  }: {
    requestId: string
    requestJson: string
  }): WebSocketResponse {
    const request = JSON.parse(requestJson) as WebSocketRequest
    if (
      request.type !== 'modeling_cmd_req' &&
      request.type !== 'modeling_cmd_batch_req'
    ) {
      return unsupportedResponse(requestId, request.type)
    }

    const unsupportedCommandType = firstUnsupportedCommandType(request)
    if (unsupportedCommandType) {
      return unsupportedResponse(requestId, unsupportedCommandType)
    }

    return {
      success: true,
      request_id: requestId,
      resp: {
        type: 'modeling',
        data: {
          modeling_response: { type: 'empty' },
        },
      },
    }
  }
}

function firstUnsupportedCommandType(
  request: WebSocketRequest
): string | undefined {
  if (request.type === 'modeling_cmd_req') {
    return supportedProtocolSmokeCommand(request.cmd)
      ? undefined
      : request.cmd.type
  }

  if (request.type === 'modeling_cmd_batch_req') {
    for (const item of request.requests) {
      if (!supportedProtocolSmokeCommand(item.cmd)) {
        return item.cmd.type
      }
    }
  }
}

function supportedProtocolSmokeCommand(command: { type: string }) {
  return (
    command.type === 'scene_clear_all' ||
    command.type === 'set_selection_filter' ||
    command.type === 'object_visible'
  )
}

function unsupportedResponse(
  requestId: string,
  commandType: string
): WebSocketResponse {
  return {
    success: false,
    request_id: requestId,
    errors: [
      {
        error_code: 'internal_api',
        message: `OCCT WASM command core does not support ${commandType}`,
      },
    ],
  }
}

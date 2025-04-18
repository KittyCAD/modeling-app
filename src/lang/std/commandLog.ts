import type { Models } from '@kittycad/lib'
import type { EngineCommand } from '@src/lang/std/artifactGraph'

export enum CommandLogType {
  SendModeling = 'send-modeling',
  SendScene = 'send-scene',
  ReceiveReliable = 'receive-reliable',
  ExecutionDone = 'execution-done',
  ExportDone = 'export-done',
  SetDefaultSystemProperties = 'set_default_system_properties',
}

export type CommandLog =
  | {
      type: CommandLogType.SendModeling
      data: EngineCommand
    }
  | {
      type: CommandLogType.SendScene
      data: EngineCommand
    }
  | {
      type: CommandLogType.ReceiveReliable
      data: Models['OkWebSocketResponseData_type']
      id: string
      cmd_type?: string
    }
  | {
      type: CommandLogType.ExecutionDone
      data: null
    }

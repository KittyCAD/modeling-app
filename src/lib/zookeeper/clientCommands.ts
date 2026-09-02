import type { Feature } from '@kittycad/lib'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { KclManager } from '@src/lang/KclManager'
import type { Command } from '@src/lib/commandTypes'
import { EXPORT_TOAST_MESSAGES } from '@src/lib/constants'
import { exportSave } from '@src/lib/exportSave'
import { isRecord } from '@src/lib/utils'
import {
  type CommandScope,
  commandKey,
  getEffectiveCommandScopeSet,
  isCommandAvailable,
} from '@src/registry/contracts/commands'
import toast from 'react-hot-toast'

export const ZOOKEEPER_CLIENT_COMMANDS_FEATURE =
  'zookeeper_client_commands' as Feature
export const CLIENT_COMMAND_PROTOCOL_VERSION = 1
export const CLIENT_COMMAND_SCHEMA_REVISION = 1

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

/** A transient command request received from Zookeeper for this connection. */
export interface ClientCommandRequest {
  request_id: string
  catalog_revision: number
  command_id: string
  arguments: { [key: string]: JsonValue }
}

export type ClientCommandResponseStatus =
  | 'accepted'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'cancelled'

export interface ClientCommandResponse {
  type: 'client_command_response'
  request_id: string
  catalog_revision: number
  status: ClientCommandResponseStatus
  result?: JsonValue
  error?: string
}

interface ClientCommandDefinition {
  id: string
  commandKey: string
  fallbackDescription: string
  inputSchema: {
    type: 'object'
    properties: Record<string, JsonValue>
    required: string[]
    additionalProperties: false
  }
}

/**
 * Explicit protocol adapters for registered commands that are safe to invoke
 * without entering the command bar's interactive review state.
 */
const CLIENT_COMMAND_DEFINITIONS: readonly ClientCommandDefinition[] = [
  {
    id: 'modeling.export',
    commandKey: 'modeling:Export',
    fallbackDescription:
      'Export the active Zoo Design Studio Engine scene as a STEP file and save it locally.',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['step'],
          description:
            'File format to export. The experimental command supports STEP.',
        },
      },
      required: ['format'],
      additionalProperties: false,
    },
  },
]

export interface ClientCommandSchemaUpdate {
  type: 'update_client_command_schema'
  protocol_version: number
  revision: number
  commands: Array<{
    id: string
    title: string
    description: string
    input_schema: ClientCommandDefinition['inputSchema']
  }>
}

function findClientCommandDefinition(commandId: string) {
  return CLIENT_COMMAND_DEFINITIONS.find(
    (definition) => definition.id === commandId
  )
}

function findRegisteredClientCommand(
  commandId: string,
  commands: readonly Command[]
) {
  const definition = findClientCommandDefinition(commandId)
  if (!definition) return

  const command = commands.find(
    (candidate) => commandKey(candidate) === definition.commandKey
  )
  if (!command) return

  return { command, definition }
}

/** Build the connection-local capability catalog from registered commands. */
export function createClientCommandSchemaUpdate(
  commands: readonly Command[],
  revision = CLIENT_COMMAND_SCHEMA_REVISION
): ClientCommandSchemaUpdate {
  return {
    type: 'update_client_command_schema',
    protocol_version: CLIENT_COMMAND_PROTOCOL_VERSION,
    revision,
    commands: CLIENT_COMMAND_DEFINITIONS.flatMap((definition) => {
      const command = commands.find(
        (candidate) => commandKey(candidate) === definition.commandKey
      )
      if (!command || command.disabled) return []

      return [
        {
          id: definition.id,
          title: command.displayName ?? String(command.name),
          description: command.description ?? definition.fallbackDescription,
          input_schema: definition.inputSchema,
        },
      ]
    }),
  }
}

export function isClientCommandAvailable(
  request: ClientCommandRequest,
  commands: readonly Command[],
  activeScopes: readonly string[],
  commandScopes: readonly CommandScope[]
) {
  const registered = findRegisteredClientCommand(request.command_id, commands)
  if (!registered || registered.command.disabled) return false

  return isCommandAvailable(
    registered.command,
    getEffectiveCommandScopeSet(activeScopes, commandScopes)
  )
}

export function getClientCommandTitle(
  commandId: string,
  commands: readonly Command[]
) {
  const registered = findRegisteredClientCommand(commandId, commands)
  return registered
    ? (registered.command.displayName ?? String(registered.command.name))
    : commandId
}

export function parseClientCommandRequest(
  message: unknown
): ClientCommandRequest | undefined {
  if (!isRecord(message) || !isRecord(message.client_command_request)) {
    return undefined
  }

  const request = message.client_command_request
  if (
    typeof request.request_id !== 'string' ||
    typeof request.catalog_revision !== 'number' ||
    typeof request.command_id !== 'string' ||
    !isRecord(request.arguments)
  ) {
    return undefined
  }

  return {
    request_id: request.request_id,
    catalog_revision: request.catalog_revision,
    command_id: request.command_id,
    arguments: request.arguments as ClientCommandRequest['arguments'],
  }
}

function response(
  request: ClientCommandRequest,
  status: ClientCommandResponseStatus,
  details?: Pick<ClientCommandResponse, 'result' | 'error'>
): ClientCommandResponse {
  return {
    type: 'client_command_response',
    request_id: request.request_id,
    catalog_revision: request.catalog_revision,
    status,
    ...details,
  }
}

export interface ExecuteClientCommandDependencies {
  kclManager: KclManager
  defaultUnit?: UnitLength
  waitForProjectIdle: () => Promise<void>
}

/** Execute one allowlisted command and resolve only after its user-facing flow settles. */
export async function executeClientCommand(
  request: ClientCommandRequest,
  dependencies: ExecuteClientCommandDependencies
): Promise<ClientCommandResponse> {
  if (request.command_id !== 'modeling.export') {
    return response(request, 'rejected', {
      error: `Client command ${request.command_id} is not available.`,
    })
  }
  if (request.arguments.format !== 'step') {
    return response(request, 'rejected', {
      error: 'modeling.export currently requires {"format":"step"}.',
    })
  }

  await dependencies.waitForProjectIdle()
  const { kclManager } = dependencies
  if (kclManager.hasErrors() || kclManager.ast.body.length === 0) {
    return response(request, 'failed', {
      error: kclManager.hasErrors()
        ? 'The active model has KCL errors and cannot be exported.'
        : 'The active model is empty and cannot be exported.',
    })
  }

  const units = dependencies.defaultUnit ?? 'mm'
  let fileName = (kclManager.currentFileName ?? 'output.kcl').replace(
    /\.kcl$/i,
    '.step'
  )
  if (!fileName.includes('.')) {
    fileName += '.step'
  }

  const toastId = toast.loading(EXPORT_TOAST_MESSAGES.START)
  try {
    const files = await kclManager.rustContext.export(
      {
        type: 'step',
        units,
        coords: {
          forward: { axis: 'y', direction: 'negative' },
          up: { axis: 'z', direction: 'positive' },
        },
      },
      { settings: { modeling: { base_unit: units } } },
      toastId
    )
    if (files === undefined) {
      return response(request, 'failed', {
        error: 'The client Engine did not produce an export file.',
      })
    }

    const saveResult = await exportSave({ files, toastId, fileName })
    if (saveResult.status === 'cancelled') {
      return response(request, 'cancelled')
    }
    if (saveResult.status === 'failed') {
      return response(request, 'failed', {
        error: saveResult.error.message,
      })
    }

    return response(request, 'succeeded', {
      result: {
        format: 'step',
        file_names: files.map((file) => file.name),
      },
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    toast.error(EXPORT_TOAST_MESSAGES.FAILED, { id: toastId })
    return response(request, 'failed', { error: detail })
  }
}

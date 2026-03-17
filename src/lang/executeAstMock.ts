/**
 * Mock AST execution without sending commands to the engine.
 * Extracted from langHelpers to avoid circular dependency: kclHelpers -> langHelpers -> edges -> faces -> kclHelpers.
 */

import type { Node } from '@rust/kcl-lib/bindings/Node'

import { KCLError } from '@src/lang/errors'
import type { ExecState, Program } from '@src/lang/wasm'
import { emptyExecState } from '@src/lang/wasm'
import { EXECUTE_AST_INTERRUPT_ERROR_STRING } from '@src/lib/constants'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { REJECTED_TOO_EARLY_WEBSOCKET_MESSAGE } from '@src/network/utils'

export interface ExecutionResultMock {
  logs: string[]
  errors: KCLError[]
  execState: ExecState
  isInterrupted: boolean
}

function isObjectWithErrors(obj: unknown): obj is { errors: unknown } {
  return typeof obj === 'object' && obj !== null && 'errors' in obj
}

function isObjectWithMessage(obj: unknown): obj is { message: unknown } {
  return typeof obj === 'object' && obj !== null && 'message' in obj
}

/** Extract first error message from array-shaped error payloads using type guards only. */
function getFirstErrorMessage(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  if (!Array.isArray(value) || value.length === 0) return undefined
  const first = value[0]
  if (!isObjectWithErrors(first)) return undefined
  const errors = first.errors
  if (!Array.isArray(errors) || errors.length === 0) return undefined
  const err0 = errors[0]
  if (!isObjectWithMessage(err0)) return undefined
  const message = err0.message
  return typeof message === 'string' ? message : undefined
}

function handleExecuteError(e: unknown): ExecutionResultMock {
  let isInterrupted = false

  if (e instanceof KCLError) {
    if (
      e.msg.includes(EXECUTE_AST_INTERRUPT_ERROR_STRING) ||
      e.msg.includes('Failed to wait for promise from send modeling command') ||
      e.msg.includes(
        'no connection to send on, connection manager called tearDown()'
      ) ||
      e.msg.includes(REJECTED_TOO_EARLY_WEBSOCKET_MESSAGE)
    ) {
      isInterrupted = true
    }
    const execState = emptyExecState()
    execState.variables = e.variables
    execState.operations = e.operations
    execState.artifactGraph = e.artifactGraph
    return {
      errors: [e],
      logs: [],
      execState,
      isInterrupted,
    }
  }

  const msg = getFirstErrorMessage(e)
  if (
    msg !== undefined &&
    (msg.includes(
      'no connection to send on, connection manager called tearDown()'
    ) ||
      msg.includes('Failed to wait for promise from send modeling command') ||
      msg.includes(REJECTED_TOO_EARLY_WEBSOCKET_MESSAGE))
  ) {
    isInterrupted = true
  }

  console.log(e)
  return {
    logs: [e instanceof Error ? e.message : String(e)],
    errors: [],
    execState: emptyExecState(),
    isInterrupted,
  }
}

export async function executeAstMock({
  ast,
  rustContext,
  path,
  usePrevMemory,
}: {
  ast: Node<Program>
  rustContext: RustContext
  path?: string
  usePrevMemory?: boolean
}): Promise<ExecutionResultMock> {
  try {
    const settings = jsAppSettings(rustContext.settingsActor)
    const execState = await rustContext.executeMock(
      ast,
      settings,
      path,
      usePrevMemory
    )

    await rustContext.waitForAllEngineCommands()
    return {
      logs: [],
      errors: [],
      execState,
      isInterrupted: false,
    }
  } catch (e: unknown) {
    return handleExecuteError(e)
  }
}

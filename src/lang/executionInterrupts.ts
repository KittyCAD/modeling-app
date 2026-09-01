import { EXECUTE_AST_INTERRUPT_ERROR_STRING } from '@src/lib/constants'
import { REJECTED_TOO_EARLY_WEBSOCKET_MESSAGE } from '@src/lib/engineConnection/utils'

const INTERRUPTED_EXECUTION_MESSAGES = [
  EXECUTE_AST_INTERRUPT_ERROR_STRING,
  'Failed to wait for promise from send modeling command',
  'no connection to send on, connection manager called tearDown()',
  REJECTED_TOO_EARLY_WEBSOCKET_MESSAGE,
]

export function isInterruptedExecutionErrorMessage(message: string): boolean {
  return INTERRUPTED_EXECUTION_MESSAGES.some((candidate) =>
    message.includes(candidate)
  )
}

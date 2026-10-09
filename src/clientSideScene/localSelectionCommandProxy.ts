import type { WebSocketRequest, WebSocketResponse } from '@kittycad/lib'

type StreamDimensions = {
  width: number
  height: number
}

export type LocalModelingResponse = {
  type: string
  data: Record<string, unknown>
}

export type LocalSelectionCommandResult = {
  modelingResponse?: LocalModelingResponse
  unreliableModelingResponse?: LocalModelingResponse
  websocketResponse?: WebSocketResponse | null
}

/**
 * Lets the local renderer answer a scene command in place of the engine.
 * Returns null straight away, without a promise, when the command is not its
 * to answer, so the caller can still send it in the same step.
 */
export type LocalSelectionCommandHandler = (
  command: WebSocketRequest,
  context: { streamDimensions: StreamDimensions }
) => Promise<LocalSelectionCommandResult | null> | null

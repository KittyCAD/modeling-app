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

export interface LocalSelectionCommandProvider {
  isActive(): boolean
  handleCommand(
    command: WebSocketRequest,
    context: { streamDimensions: StreamDimensions }
  ): Promise<LocalSelectionCommandResult | null>
}

let registeredProvider: LocalSelectionCommandProvider | null = null

export function registerLocalSelectionCommandProvider(
  provider: LocalSelectionCommandProvider
) {
  registeredProvider = provider
  return () => {
    if (registeredProvider === provider) {
      registeredProvider = null
    }
  }
}

export async function maybeHandleLocalSelectionCommand(
  command: WebSocketRequest,
  context: { streamDimensions: StreamDimensions }
): Promise<LocalSelectionCommandResult | null> {
  if (!registeredProvider?.isActive()) {
    return null
  }

  return registeredProvider.handleCommand(command, context)
}

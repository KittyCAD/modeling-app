import type { MlCopilotServerMessage } from '@kittycad/lib'
import { decode } from '@msgpack/msgpack'

/** Fixed server input for the UI benchmark, not an AI-service measurement. */
export function zookeeperFixtureReply(
  message: string | Uint8Array,
  infoText: string
): MlCopilotServerMessage | undefined {
  const request: unknown =
    typeof message === 'string' ? JSON.parse(message) : decode(message)
  if (typeof request !== 'object' || request === null || !('type' in request)) {
    return undefined
  }
  if (request.type === 'headers') {
    return {
      conversation_id: {
        conversation_id: '00000000-0000-4000-8000-000000000001',
      },
    }
  }
  if (request.type === 'user') {
    return { info: { text: infoText } }
  }
  return undefined
}

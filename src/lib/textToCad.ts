import type { TextToCad } from '@kittycad/lib'
import { ml } from '@kittycad/lib'
import { createKCClient, kcCall } from '@src/lib/kcClient'
// migrated to SDK; keep file minimal
import type {
  IResponseMlConversation,
  IResponseMlConversations,
  PromptsPaged,
} from '@src/lib/textToCadTypes'

// Re-export types that are used by components
export type { IResponseMlConversation, IResponseMlConversations, PromptsPaged }

export async function textToCadPromptFeedback(
  token: string,
  args: {
    id: TextToCad['id']
    feedback: TextToCad['feedback']
  }
): Promise<void | Error> {
  if (!args.feedback) return
  const client = createKCClient(token)
  const fb = args.feedback
  const data = await kcCall(() =>
    ml.create_text_to_cad_model_feedback({
      client,
      id: args.id,
      feedback: fb,
    })
  )

  return data
}

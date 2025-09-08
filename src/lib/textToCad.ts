import type { TextToCad } from '@kittycad/lib'
import crossPlatformFetch from '@src/lib/crossPlatformFetch'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
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
  const url = withAPIBaseURL(
    `/user/text-to-cad/${args.id}?feedback=${args.feedback}`
  )
  const data: void | Error = await crossPlatformFetch(
    url,
    {
      method: 'POST',
    },
    token
  )

  return data
}

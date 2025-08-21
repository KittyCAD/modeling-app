import type { Models } from '@kittycad/lib'
import crossPlatformFetch from '@src/lib/crossPlatformFetch'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import type {
  IResponseMlConversations,
  PromptsPaged,
} from '@src/lib/textToCadTypes'

export async function submitTextToCadCreateRequest(
  prompt: string,
  projectName: string,
  token?: string,
  kclVersion?: string
): Promise<Models['TextToCad_type'] | Error> {
  const body: Models['TextToCadCreateBody_type'] = {
    prompt,
    project_name:
      projectName !== '' && projectName !== 'browser' ? projectName : undefined,
    kcl_version: kclVersion,
  }
  // Glb has a smaller footprint than gltf, should we want to render it.
  const url = withAPIBaseURL('/ai/text-to-cad/glb?kcl=true')
  const data: Models['TextToCad_type'] | Error = await crossPlatformFetch(
    url,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    token
  )

  // Make sure we have an id.
  if (data instanceof Error) {
    return data
  }

  if (!data.id) {
    return new Error('No id returned from Text-to-CAD API')
  }

  return data
}

export async function getTextToCadCreateResult(
  id: string,
  token?: string
): Promise<Models['TextToCad_type'] | Error> {
  const url = withAPIBaseURL(`/ai/text-to-cad/${id}`)
  const data: Models['TextToCad_type'] | Error = await crossPlatformFetch(
    url,
    {
      method: 'GET',
    },
    token
  )

  return data
}

export async function textToCadMlConversations(
  token: string,
  args: {
    pageToken?: string
    limit?: number
    sortBy: 'created_at_descending'
  }
): Promise<IResponseMlConversations | Error> {
  const url = withAPIBaseURL('/ml/conversations')
  const data: IResponseMlConversations | Error = await crossPlatformFetch(
    url,
    {
      method: 'GET',
    },
    token
  )

  return data
}

export async function textToCadMlPromptsBelongingToConversation(
  token: string,
  args: {
    conversationId: string
    pageToken?: string
    limit?: number
    sortBy: 'created_at_ascending' | 'created_at_descending'
  }
): Promise<PromptsPaged | Error> {
  const url = withAPIBaseURL(`/ml/conversations/${args.conversationId}/prompts`)
  const data: PromptsPaged | Error = await crossPlatformFetch(
    url,
    {
      method: 'GET',
    },
    token
  )

  return data
}

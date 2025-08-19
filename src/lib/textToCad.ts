import type { Models } from '@kittycad/lib'
import crossPlatformFetch from '@src/lib/crossPlatformFetch'
import { kclManager } from '@src/lib/singletons'
import { withAPIBaseURL } from '@src/lib/withBaseURL'

export async function submitTextToCadCreateRequest(
  prompt: string,
  projectName: string,
  token?: string
): Promise<Models['TextToCad_type'] | Error> {
  const body: Models['TextToCadCreateBody_type'] = {
    prompt,
    project_name:
      projectName !== '' && projectName !== 'browser' ? projectName : undefined,
    kcl_version: kclManager.kclVersion,
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
  const url = withAPIBaseURL(`/user/text-to-cad/${id}`)
  const data: Models['TextToCad_type'] | Error = await crossPlatformFetch(
    url,
    {
      method: 'GET',
    },
    token
  )

  return data
}

export interface IResponseMlConversation {
  created_at: string
  first_prompt: string
  id: string
  updated_at: string
  user_id: string
}

export interface IResponseMlConversations {
  items: IResponseMlConversation[]
  next_page?: string
}

export async function textToCadMlConversations(
  token: string,
  args: {
    pageToken?: string
    limit?: number
    sortBy: 'created_at_descending'
  }
): Promise<IResponseMlConversations | Error> {
  const url = withAPIBaseURL(
    `/ml/conversations?limit=${args.limit ?? '20'}&sort_by=${args.sortBy ?? 'created_at_descending'}${args.pageToken ? '&page_token=' + args.pageToken : ''}`
  )
  const data: IResponseMlConversations | Error = await crossPlatformFetch(
    url,
    {
      method: 'GET',
    },
    token
  )

  return data
}

export type PromptsPaged = {
  items: Models['TextToCad_type'][]
  next_page?: string
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
  const url = withAPIBaseURL(
    `/user/text-to-cad?conversation_id=${args.conversationId}&no_models=true&limit=${args.limit ?? '20'}&sort_by=${args.sortBy ?? 'created_at_ascending'}${args.pageToken ? '&page_token=' + args.pageToken : ''}`
  )
  const data: PromptsPaged | Error = await crossPlatformFetch(
    url,
    {
      method: 'GET',
    },
    token
  )

  return data
}

export async function textToCadPromptFeedback(
  token: string,
  args: {
    id: Models['TextToCad_type']['id']
    feedback: Models['TextToCad_type']['feedback']
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

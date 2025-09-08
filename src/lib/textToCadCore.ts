import type { TextToCad, TextToCadCreateBody } from '@kittycad/lib'
import { ml } from '@kittycad/lib'
import type { TextToCadResponse } from '@kittycad/lib'
import type { Pager } from '@kittycad/lib/dist/types/src/pagination'
import { createKCClient, kcCall } from '@src/lib/kcClient'
import type {
  IResponseMlConversations,
  PromptsPaged,
} from '@src/lib/textToCadTypes'

export async function submitTextToCadCreateRequest(
  prompt: string,
  projectName: string,
  token?: string,
  kclVersion?: string
): Promise<TextToCad | Error> {
  const body: TextToCadCreateBody = {
    prompt,
    project_name:
      projectName !== '' && projectName !== 'browser' ? projectName : undefined,
    kcl_version: kclVersion,
  }
  const client = createKCClient(token)
  const data = await kcCall(() =>
    ml.create_text_to_cad({ client, output_format: 'glb', kcl: true, body })
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
): Promise<TextToCadResponse | Error> {
  const client = createKCClient(token)
  const data = await kcCall(() =>
    ml.get_text_to_cad_model_for_user({ client, id })
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
  // Use SDK pager internally; reuse across calls via token key.
  const client = createKCClient(token)
  const key = token || 'cookie'
  if (!conversationPagers.has(key)) {
    const pager = ml.list_conversations_for_user_pager({
      client,
      limit: args.limit ?? 20,
      sort_by: args.sortBy,
    } as any)
    conversationPagers.set(key, pager as unknown as Pager<any, any, any>)
  }
  const pager = conversationPagers.get(key) as Pager<any, any, any>
  if (!pager.hasNext() && args.pageToken) {
    // Reset if caller wants to start over
    pager.reset()
  }
  const items = await pager.next()
  return {
    items: (items as any) ?? [],
    next_page: pager.hasNext() ? '1' : undefined,
  }
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
  const client = createKCClient(token)
  const key = `${token || 'cookie'}:${args.conversationId}`
  if (!promptsPagers.has(key)) {
    const pager = ml.list_text_to_cad_models_for_user_pager({
      client,
      conversation_id: args.conversationId as any,
      no_models: true,
      limit: args.limit ?? 20,
      sort_by: args.sortBy,
    } as any)
    promptsPagers.set(key, pager as unknown as Pager<any, any, any>)
  }
  const pager = promptsPagers.get(key) as Pager<any, any, any>
  if (!pager.hasNext() && args.pageToken) {
    pager.reset()
  }
  const items = await pager.next()
  return {
    items: (items as any) ?? [],
    next_page: pager.hasNext() ? '1' : undefined,
  }
}

// Internal pager caches keyed by token (and conversation)
const conversationPagers = new Map<string, Pager<any, any, any>>()
const promptsPagers = new Map<string, Pager<any, any, any>>()

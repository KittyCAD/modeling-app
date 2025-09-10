import type { TextToCad, TextToCadCreateBody } from '@kittycad/lib'
import { ml } from '@kittycad/lib'
import type { TextToCadResponse } from '@kittycad/lib'
type ConversationsPager = ReturnType<
  typeof ml.list_conversations_for_user_pager
>
type PromptsPager = ReturnType<typeof ml.list_text_to_cad_models_for_user_pager>
import type {
  ConversationResultsPage,
  TextToCadResponseResultsPage,
} from '@kittycad/lib'
import { createKCClient, kcCall } from '@src/lib/kcClient'

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
): Promise<ConversationResultsPage | Error> {
  // Use SDK pager internally; reuse across calls via token key.
  const client = createKCClient(token)
  const key = token || 'cookie'
  if (!conversationPagers.has(key)) {
    const pager = ml.list_conversations_for_user_pager({
      client,
      limit: args.limit ?? 20,
      sort_by: args.sortBy,
    })
    conversationPagers.set(key, pager)
  }
  const pager = conversationPagers.get(key) as ConversationsPager
  if (!pager.hasNext() && args.pageToken) {
    // Reset if caller wants to start over
    pager.reset()
  }
  const items = await pager.next()
  return { items, next_page: pager.hasNext() ? '1' : undefined }
}

export async function textToCadMlPromptsBelongingToConversation(
  token: string,
  args: {
    conversationId: string
    pageToken?: string
    limit?: number
    sortBy: 'created_at_ascending' | 'created_at_descending'
  }
): Promise<TextToCadResponseResultsPage | Error> {
  const client = createKCClient(token)
  const key = `${token || 'cookie'}:${args.conversationId}`
  if (!promptsPagers.has(key)) {
    const pager = ml.list_text_to_cad_models_for_user_pager({
      client,
      conversation_id: args.conversationId,
      no_models: true,
      limit: args.limit ?? 20,
      sort_by: args.sortBy,
    })
    promptsPagers.set(key, pager)
  }
  const pager = promptsPagers.get(key) as PromptsPager
  if (!pager.hasNext() && args.pageToken) {
    pager.reset()
  }
  const items = await pager.next()
  return { items, next_page: pager.hasNext() ? '1' : undefined }
}

// Internal pager caches keyed by token (and conversation)
const conversationPagers = new Map<string, ConversationsPager>()
const promptsPagers = new Map<string, PromptsPager>()

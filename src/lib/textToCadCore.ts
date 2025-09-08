import type { TextToCad, TextToCadCreateBody } from '@kittycad/lib'
import { ml } from '@kittycad/lib'
import type { TextToCadResponse } from '@kittycad/lib'
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
  const client = createKCClient(token)
  const data = await kcCall(() =>
    ml.list_conversations_for_user({
      client,
      limit: args.limit ?? 20,
      page_token: args.pageToken ?? '',
      sort_by: args.sortBy,
    })
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
  const client = createKCClient(token)
  const data = await kcCall(() =>
    ml.list_text_to_cad_models_for_user({
      client,
      conversation_id: args.conversationId as any,
      no_models: true,
      limit: args.limit ?? 20,
      page_token: args.pageToken ?? '',
      sort_by: args.sortBy,
    })
  )
  if (data instanceof Error) return data
  return { items: data.items as any, next_page: data.next_page }
}

import { ml, type Conversation } from '@kittycad/lib'
import { createKCClient } from '@src/lib/kcClient'

export type ZookeeperConversationDetails = Record<
  string,
  Pick<Conversation, 'first_prompt' | 'created_at'>
>

export async function loadZookeeperConversationDetails(
  conversationIds: readonly string[],
  apiToken: string,
  signal: AbortSignal
): Promise<ZookeeperConversationDetails> {
  const remaining = new Set(conversationIds)
  const details: ZookeeperConversationDetails = {}
  const client = createKCClient(apiToken)
  const clientFetch = client.fetch!
  client.fetch = (input, init) => clientFetch(input, { ...init, signal })
  let pageToken: string | undefined

  // The endpoint lists all user chats. Only retain this project's metadata,
  // and stop paging as soon as every saved ID has been found.
  while (remaining.size > 0 && !signal.aborted) {
    const page = await ml.list_conversations_for_user({
      client,
      limit: 100,
      page_token: pageToken,
    })
    for (const conversation of page.items) {
      if (!remaining.delete(conversation.id)) continue
      details[conversation.id] = {
        first_prompt: conversation.first_prompt,
        created_at: conversation.created_at,
      }
    }
    if (!page.next_page || page.next_page === pageToken) break
    pageToken = page.next_page
  }
  return details
}

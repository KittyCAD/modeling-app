import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { AuthService } from '@src/contracts/auth'
import type { FileSystem } from '@src/contracts/fileSystem'
import type { ProjectSessionService } from '@src/contracts/projectSession'
import type {
  Conversation,
  ConversationId,
  ZookeeperService,
} from '@src/contracts/zookeeper'
import { captureProjectBaseline } from '@src/features/zookeeper/baseline'
import { createConversation } from '@src/features/zookeeper/createConversation'
import { createZookeeperConnection } from '@src/features/zookeeper/createZookeeperConnection'
import { createChangeHistory } from '@src/lib/collab/changeHistory'
import { createWriteClaims } from '@src/lib/collab/claims'

export interface ZookeeperServiceDependencies {
  auth: AuthService
  sessions: ProjectSessionService
  fileSystem: FileSystem
  /** Websocket base URL. Absent in a build with no service configured. */
  url: string | undefined
}

let counter = 0

/**
 * Every conversation with the CAD agent.
 *
 * Two things are shared across all of them and neither could be per
 * conversation:
 *
 * - **One `changeHistory`.** Reverting one writer's work means projecting its
 *   inverse through everything that happened afterwards, including other
 *   writers' edits and the user's typing. A log per conversation would each hold
 *   a partial history and none of them could do it.
 * - **One `WriteClaims`.** Its whole job is arbitrating *between* conversations,
 *   so one per conversation would arbitrate nothing.
 *
 * Everything else — the divergence ledger, the subscriptions, the view of what
 * the service last saw — is per conversation, because it is measured from that
 * conversation's document.
 */
export function createZookeeperService(
  dependencies: ZookeeperServiceDependencies
): ZookeeperService {
  const { auth, sessions, fileSystem, url } = dependencies

  const changeHistory = createChangeHistory()
  const claims = createWriteClaims()

  const conversations = signal<ReadonlyMap<ConversationId, Conversation>>(
    new Map()
  )
  const active = signal<ConversationId | null>(null)
  /** Disposers for each conversation's connection, which the conversation cannot own. */
  const connections = new Map<ConversationId, () => void>()

  const unavailableReason = computed(() => {
    if (url === undefined || url === '') {
      return 'This build has no Zookeeper service configured.'
    }
    if (auth.token.value === null) return 'Sign in to use Zookeeper.'
    if (sessions.current.value === null)
      return 'Open a project to use Zookeeper.'
    return null
  })

  const setConversations = (next: Map<ConversationId, Conversation>) => {
    conversations.value = next
  }

  const close = (id: ConversationId) => {
    const existing = conversations.peek().get(id)
    if (existing === undefined) return

    existing.dispose()
    connections.get(id)?.()
    connections.delete(id)

    const next = new Map(conversations.peek())
    next.delete(id)
    setConversations(next)

    if (active.peek() === id) {
      // Fall back to the most recently opened, or to nothing — which is a real
      // state and the one the user means when they close the last of them.
      active.value = [...next.keys()].at(-1) ?? null
    }
  }

  return {
    conversations: computed(() => conversations.value),
    active: computed(() => active.value),
    available: computed(() => unavailableReason.value === null),
    unavailableReason,

    open() {
      if (unavailableReason.peek() !== null) return null
      // Checked above, so this is narrowing rather than a second opinion.
      if (url === undefined) return null

      counter += 1
      const id: ConversationId = `zookeeper-${counter}`

      const connection = createZookeeperConnection({
        url,
        // Read at connect time, never captured: a token read once is the token
        // that has since been refreshed.
        token: () => auth.token.peek(),
      })

      const conversation = createConversation({
        id,
        author: `zookeeper:${id}`,
        transport: connection,
        target: {
          bufferForPath: (path) => sessions.current.peek()?.bufferForPath(path),
          executingBufferId: () =>
            sessions.current.peek()?.executingBuffer.peek()?.id ?? null,
        },
        changeHistory,
        claims,
        captureProject: async () => {
          const session = sessions.current.peek()
          if (session === undefined || session === null) return new Map()
          return captureProjectBaseline({ session, fileSystem })
        },
        connection: computed(() => ({
          status: connection.state.value.status,
          error: connection.state.value.error,
          superseded: connection.state.value.superseded,
        })),
      })

      connections.set(id, () => connection.dispose())

      const next = new Map(conversations.peek())
      next.set(id, conversation)
      setConversations(next)
      active.value = id

      /*
       * Started, not awaited. Waiting here would block the panel for as long as
       * the connect deadline, and the conversation is already in the map with a
       * connection signal the panel can render — "connecting", then either
       * "ready" or the reason it failed.
       *
       * The rejection is swallowed rather than ignored: `connection.state`
       * already carries the error, and an unhandled rejection here would be
       * noise reporting something the UI is about to show anyway.
       */
      void connection.connect().catch(() => {})

      return id
    },

    close,

    activate(id) {
      if (!conversations.peek().has(id)) return
      active.value = id
    },

    conversation(id) {
      return conversations.peek().get(id)
    },

    holderOf(path): ReadonlySignal<string | null> {
      return computed(() => claims.held.value.get(path) ?? null)
    },
  }
}

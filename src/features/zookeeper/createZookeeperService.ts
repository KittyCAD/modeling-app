import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { AuthService } from '@src/contracts/auth'
import type { FileSystem } from '@src/contracts/fileSystem'
import type { FsOperationQueue } from '@src/contracts/fsOperations'
import type { ProjectSessionService } from '@src/contracts/projectSession'
import type {
  Conversation,
  ConversationId,
  StoredConversation,
  Turn,
  ZookeeperService,
} from '@src/contracts/zookeeper'
import { captureProjectBaseline } from '@src/features/zookeeper/baseline'
import { createConversation } from '@src/features/zookeeper/createConversation'
import { createZookeeperConnection } from '@src/features/zookeeper/createZookeeperConnection'
import { createChangeLogStore } from '@src/features/zookeeper/changeLogStore'
import { createTranscriptStore } from '@src/features/zookeeper/transcriptStore'
import { createChangeHistory } from '@src/lib/collab/changeHistory'
import { createWriteClaims } from '@src/lib/collab/claims'
import { createPresence } from '@src/lib/collab/presence'

export interface ZookeeperServiceDependencies {
  auth: AuthService
  sessions: ProjectSessionService
  fileSystem: FileSystem
  /** Serialises transcript writes and records their provenance. */
  queue: FsOperationQueue
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
  const { auth, sessions, fileSystem, queue, url } = dependencies

  const changeHistory = createChangeHistory()
  const claims = createWriteClaims()
  const presence = createPresence()

  const conversations = signal<ReadonlyMap<ConversationId, Conversation>>(
    new Map()
  )
  const active = signal<ConversationId | null>(null)
  const stored = signal<readonly StoredConversation[]>([])

  /** Disposers for each connection, which a conversation cannot own itself. */
  const connections = new Map<ConversationId, () => void>()
  /** The service's own id per conversation, so a resume can ask for a replay. */
  const remoteIds = new Map<ConversationId, string | null>()
  const openedAt = new Map<ConversationId, number>()
  /** Paths whose change history is live, so it can be written back. */
  const tracked = new Set<string>()

  const unavailableReason = computed(() => {
    if (url === undefined || url === '') {
      return 'This build has no Zookeeper service configured.'
    }
    if (auth.token.value === null) return 'Sign in to use Zookeeper.'
    if (sessions.current.value === null) {
      return 'Open a project to use Zookeeper.'
    }
    return null
  })

  /**
   * Transcripts live in the project, so the store follows whichever is open.
   *
   * Null with no project — which is also when the service is unavailable, so
   * every caller below has already been gated.
   */
  const storeFor = () => {
    const session = sessions.current.peek()
    if (session === null || session === undefined) return null
    return createTranscriptStore({
      projectPath: session.project.peek().path,
      fileSystem,
      queue,
    })
  }

  const historyFor = () => {
    const session = sessions.current.peek()
    if (session === null || session === undefined) return null
    return createChangeLogStore({
      projectPath: session.project.peek().path,
      fileSystem,
      queue,
    })
  }

  /** The file as it now stands, for the change log's staleness check. */
  const headOf = (path: string) =>
    sessions.current.peek()?.bufferForPath(path)?.text.peek() ?? null

  /**
   * Adopt any history a previous session left for these paths.
   *
   * Done here rather than when a path is followed, because seeding only works
   * before anything live has been recorded for it — and this runs immediately
   * before the conversation starts tracking, for exactly the same paths.
   */
  const seedHistory = async (paths: Iterable<string>) => {
    const store = historyFor()
    if (store === null) return

    await Promise.all(
      [...paths].map(async (path) => {
        tracked.add(path)
        if (changeHistory.entries(path).length > 0) return

        const head = headOf(path)
        // Nothing open for the path means nothing to reconcile a log against.
        if (head === null) return

        const restored = await store.load(path, head)
        if (restored !== null) changeHistory.seed(path, restored)
      })
    )
  }

  /** Write back the history for every path a conversation has touched. */
  const persistHistory = () => {
    const store = historyFor()
    if (store === null) return

    for (const path of tracked) {
      const head = headOf(path)
      const entries = changeHistory.entries(path)
      if (head === null || entries.length === 0) continue

      store.save(path, entries, head).catch(() => {
        // A history that could not be written costs the *next* session an exact
        // revert. It must not cost this one the turn that just succeeded.
      })
    }
  }

  const refreshStored = () => {
    const store = storeFor()
    if (store === null) {
      stored.value = []
      return
    }
    store
      .list()
      .then((listed) => {
        stored.value = listed
      })
      .catch(() => {
        // A project whose transcripts cannot be read is, to the panel, a project
        // with none — better than an empty panel and a console error.
        stored.value = []
      })
  }

  const persist = (id: ConversationId) => {
    const conversation = conversations.peek().get(id)
    const store = storeFor()
    if (conversation === undefined || store === null) return

    store
      .save({
        id,
        remoteId: remoteIds.get(id) ?? null,
        createdAt: openedAt.get(id) ?? Date.now(),
        turns: conversation.transcript.peek(),
      })
      .then(refreshStored)
      .catch(() => {
        // Losing a transcript write must not take the conversation with it: the
        // in-memory transcript is still what the panel reads.
      })

    persistHistory()
  }

  const close = (id: ConversationId) => {
    const existing = conversations.peek().get(id)
    if (existing === undefined) return

    // Saved before disposing, so the last turn of a closed conversation is not
    // the one that goes missing.
    persist(id)

    existing.dispose()
    connections.get(id)?.()
    connections.delete(id)

    const next = new Map(conversations.peek())
    next.delete(id)
    conversations.value = next

    if (active.peek() === id) {
      // Fall back to the most recently opened, or to nothing — a real state, and
      // the one meant by closing the last of them.
      active.value = [...next.keys()].at(-1) ?? null
    }
  }

  /** Open a conversation, new or restored from disk. */
  const start = (options: {
    id?: ConversationId
    initialTurns?: readonly Turn[]
    remoteId?: string | null
    createdAt?: number
  }): ConversationId | null => {
    if (unavailableReason.peek() !== null) return null
    // Checked above; this narrows rather than asking a second time.
    if (url === undefined) return null

    let candidate = options.id
    if (candidate === undefined) {
      counter += 1
      candidate = `zookeeper-${counter}`
    }
    const id = candidate

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
      presence,
      captureProject: async () => {
        const session = sessions.current.peek()
        if (session === undefined || session === null) return new Map()
        const captured = await captureProjectBaseline({ session, fileSystem })
        // Before the conversation tracks these paths, so a restored log is not
        // seeded over live entries.
        await seedHistory(captured.keys())
        return captured
      },
      connection: computed(() => ({
        status: connection.state.value.status,
        error: connection.state.value.error,
        superseded: connection.state.value.superseded,
      })),
      ...(options.initialTurns === undefined
        ? {}
        : { initialTurns: options.initialTurns }),
      // Turn boundaries only. A transcript is written by rewriting the file,
      // which is cheap per turn and ruinous per streamed token.
      onTurnSettled: () => persist(id),
    })

    remoteIds.set(id, options.remoteId ?? null)
    openedAt.set(id, options.createdAt ?? Date.now())
    connections.set(id, () => connection.dispose())

    const next = new Map(conversations.peek())
    next.set(id, conversation)
    conversations.value = next
    active.value = id

    /*
     * Started, not awaited. Waiting here would block the panel for as long as
     * the connect deadline, and the conversation is already in the map with a
     * connection signal the panel can render.
     *
     * The rejection is swallowed rather than ignored: `connection.state` already
     * carries the error, and an unhandled rejection would report something the
     * UI is about to show anyway.
     */
    const resuming = options.remoteId
    connection
      .connect(
        resuming === null || resuming === undefined
          ? {}
          : { conversationId: resuming, replay: true }
      )
      .then(() => {
        // The service names the conversation, and may not name it what we asked
        // for. Whatever it says is what a later resume has to use.
        remoteIds.set(id, connection.state.peek().conversationId)
        persist(id)
      })
      .catch(() => {})

    return id
  }

  /*
   * Read once now, and again whenever the open project changes — transcripts
   * belong to a project, so a different project has a different list.
   *
   * Eagerly rather than on first read, because a caller that reads `stored`
   * expects a list rather than an empty array that fills in later. The watch
   * below only handles *changes*, so `lastProject` starts at what this read used.
   */
  refreshStored()
  let lastProject = sessions.current.peek()?.project.peek().path ?? null

  /*
   * A computed rather than an effect: the container forbids starting an effect
   * that reads a value spec inline, and this is kept live by `stored` reading it.
   */
  const projectWatch = computed(() => {
    const path = sessions.current.value?.project.value.path ?? null
    if (path !== lastProject) {
      lastProject = path
      refreshStored()
    }
    return path
  })

  return {
    conversations: computed(() => conversations.value),
    active: computed(() => active.value),
    available: computed(() => unavailableReason.value === null),
    unavailableReason,
    stored: computed(() => {
      // Reading the watch is what makes the project change re-read the list.
      void projectWatch.value
      return stored.value
    }),

    open: () => start({}),

    resume(id) {
      // Already open is the answer somebody wanted when they clicked it twice.
      if (conversations.peek().has(id)) {
        active.value = id
        return id
      }

      const previous = stored.peek().find((each) => each.id === id)
      if (previous === undefined) return null

      return start({
        id,
        initialTurns: previous.turns,
        remoteId: previous.remoteId,
        createdAt: previous.createdAt,
      })
    },

    forget(id) {
      close(id)
      stored.value = stored.peek().filter((each) => each.id !== id)
      storeFor()
        ?.remove(id)
        .catch(() => {})
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

    presence: presence.here,

    canRevert(turnId) {
      return computed(() => {
        for (const path of tracked) {
          const held = changeHistory
            .entries(path)
            .some((entry) => entry.contributionId === turnId)
          if (held) return true
        }
        return false
      })
    },
  }
}

import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type {
  Conversation,
  ConversationConnection,
  PathConflict,
  Turn,
  TurnStatus,
  ZookeeperTransport,
} from '@src/contracts/zookeeper'
import {
  type ApplyTarget,
  applyChanges,
} from '@src/features/zookeeper/applyChanges'
import {
  deriveChanges,
  manifestOf,
  outputsOf,
  toolResultFailed,
} from '@src/features/zookeeper/deriveEdit'
import type { ChangeHistory } from '@src/lib/collab/changeHistory'
import type { Presence } from '@src/lib/collab/presence'
import type { WriteClaims } from '@src/lib/collab/claims'
import { createDivergenceLedger } from '@src/lib/collab/divergence'
import { followLocalChanges } from '@src/lib/collab/followLocalChanges'
import { revertContribution } from '@src/lib/collab/revertContribution'

export interface ConversationDependencies {
  id: string
  /** Opaque collaborator id. `zookeeper:<conversation id>` by convention. */
  author: string
  transport: ZookeeperTransport
  target: ApplyTarget
  /** The single applied-change log, shared with every other writer. */
  changeHistory: ChangeHistory
  /** Required whenever a second conversation can run. See `claims.ts`. */
  claims?: WriteClaims
  /**
   * Where the other collaborators are, shared across conversations.
   *
   * Followed here rather than by the service because this is what knows which
   * paths a conversation has touched — and presence is only ever about paths
   * somebody actually wrote to.
   */
  presence?: Presence
  /**
   * The project as it stands, by project-relative path.
   *
   * Called once at the start of a turn. This is what the service is told and what
   * every diff for the turn is measured against, so it must be the same content
   * in both places — see `captureBaseline` in the design notes for why a buffer
   * snapshot alone is not enough.
   */
  captureProject: () => Promise<ReadonlyMap<string, string>>
  /**
   * The socket's state, for the panel to show.
   *
   * Optional because a conversation does not care: it sends through the
   * transport and reads what comes back. Defaults to reporting connected, which
   * is what a test with a fake transport means.
   */
  connection?: ReadonlySignal<ConversationConnection>
  /**
   * Turns from a stored transcript, when this conversation is being resumed.
   *
   * Display only. The divergence ledger deliberately starts empty: those turns
   * were applied in a session whose in-memory change history is gone, so an
   * exact revert of them is no longer possible — see the note on durable revert
   * in `src/lib/collab/revert.ts`.
   */
  initialTurns?: readonly Turn[]
  /**
   * Called when a turn reaches a resting state.
   *
   * The hook for persistence, and it fires at *turn* boundaries rather than on
   * every streamed token on purpose: a transcript is written by rewriting the
   * file, which is cheap per turn and ruinous per delta.
   */
  onTurnSettled?: () => void
  /** Ids for turns. Injected so a test can read them. */
  nextTurnId?: () => string
}

/**
 * One conversation with the service, as a participant in the project session.
 *
 * Owns the per-writer state that makes it a collaborator rather than a pane: one
 * divergence ledger keyed by path, one subscription per path it has touched, and
 * its own view of what the service last saw. Everything it writes is attributed
 * to `author` and grouped by turn, so it can be undone as a unit.
 *
 * **No state machine.** The genuinely multi-step parts live in the connection;
 * what is left here is a status signal, a transcript, and one `AbortController`
 * per turn — which is the house style for a cancellable async flow, and enough.
 *
 * Two rules that are easy to get wrong and are the reason this is one object
 * rather than a handler per message:
 *
 * - **A message from a turn that is over is dropped.** Aborting stops the UI
 *   waiting but cannot stop a frame already in flight, and a late
 *   `project_updated` would otherwise *write to the file* after the user
 *   cancelled. Every handler checks the turn id first.
 * - **Being told `waiting` means resync, not retry.** The held output was
 *   computed against a document the other writer has since changed, so replaying
 *   it reproduces the interleaving the claim prevented. The view is dropped for
 *   those paths so the next turn re-derives from current content.
 */
export function createConversation(
  dependencies: ConversationDependencies
): Conversation {
  const {
    id,
    author,
    transport,
    target,
    changeHistory,
    claims,
    presence,
    captureProject,
    connection,
    initialTurns,
    onTurnSettled,
    nextTurnId,
  } = dependencies

  const ledger = createDivergenceLedger()
  /** What the service last saw, per path. Advances as its output lands. */
  const view = new Map<string, string>()
  /** One subscription per path we have begun tracking. */
  const following = new Map<string, () => void>()

  const transcript = signal<readonly Turn[]>(initialTurns ?? [])
  const conflicts = signal<readonly PathConflict[]>([])

  let turn: { id: string; controller: AbortController } | null = null
  /*
   * Seeded past any restored turn, so a resumed conversation cannot mint an id
   * that already appears in its own transcript — which would make `revert` and
   * the transcript's own keys ambiguous.
   */
  let turnCounter = initialTurns?.length ?? 0

  const mintTurnId = nextTurnId ?? (() => `${id}-turn-${++turnCounter}`)

  const updateTurn = (turnId: string, change: (previous: Turn) => Turn) => {
    transcript.value = transcript
      .peek()
      .map((entry) => (entry.id === turnId ? change(entry) : entry))
  }

  /** Begin tracking a path: remember what the service saw, and watch for drift. */
  const track = (path: string, contents: string) => {
    view.set(path, contents)
    ledger.begin(path, contents.length)

    if (following.has(path)) return
    const buffer = target.bufferForPath(path)
    if (buffer === undefined) return

    following.set(
      path,
      followLocalChanges({
        path,
        buffer,
        ledger,
        remoteAuthor: author,
        /*
         * A drift that can no longer be trusted is worse than none: it would
         * make the next rebase measure against a document nobody has. Forgetting
         * the path means the next turn recaptures it instead.
         */
        onDesync: (desynced) => untrack(desynced),
      })
    )
    changeHistory.follow(path, buffer)
    presence?.follow(path, buffer)
  }

  const untrack = (path: string) => {
    following.get(path)?.()
    following.delete(path)
    ledger.forget(path)
    view.delete(path)
  }

  const applyOutputs = (
    turnId: string,
    outputs: Readonly<Record<string, string>>,
    manifest?: ReturnType<typeof manifestOf>
  ) => {
    const derived = deriveChanges({
      baseline: view,
      outputs,
      ...(manifest === undefined ? {} : { manifest }),
    })
    if (derived.changes.length === 0) return

    const outcome = applyChanges({
      changes: derived.changes,
      baseline: view,
      target,
      ledger,
      author,
      contributionId: turnId,
      ...(claims === undefined ? {} : { claims }),
    })

    // The view advances only for what actually landed, so a refused path is
    // re-derived from current content next time rather than from a fiction.
    for (const path of outcome.applied) {
      const applied = outputs[path]
      if (applied !== undefined) view.set(path, applied)
    }
    // Held paths are dropped entirely: their view is stale by definition, and the
    // one thing a held writer must not do is replay against it.
    for (const path of outcome.waiting) untrack(path)

    if (outcome.conflicts.length > 0) {
      conflicts.value = [...conflicts.peek(), ...outcome.conflicts]
    }

    updateTurn(turnId, (previous) => ({
      ...previous,
      paths: [...new Set([...previous.paths, ...outcome.applied])],
      conflicts: [...previous.conflicts, ...outcome.conflicts],
      waiting: [...new Set([...previous.waiting, ...outcome.waiting])],
      status: outcome.waiting.length > 0 ? 'waiting' : previous.status,
    }))
  }

  const interrupt = () => {
    const current = turn
    if (current === null) return

    /*
     * Both, and neither is enough alone: the abort stops us waiting, and the
     * message stops the service working. Skipping the message leaves the service
     * billing for a turn nobody will read.
     */
    current.controller.abort()
    transport.send({ type: 'system', command: 'interrupt' })
    finish(current.id, 'interrupted')
  }

  const finish = (turnId: string, status: TurnStatus) => {
    updateTurn(turnId, (previous) => ({
      ...previous,
      // A turn held off a file did not complete, whatever the service says.
      status: previous.status === 'waiting' ? 'waiting' : status,
    }))
    claims?.release(author)
    if (turn?.id === turnId) turn = null
    onTurnSettled?.()
  }

  const stopListening = transport.onMessage((message) => {
    const current = turn
    /*
     * Nothing to attribute a message to. Either the turn was interrupted and this
     * frame was already in flight, or the service is talking about a turn we have
     * forgotten — and under live-apply, acting on it would write to a file after
     * the user asked us to stop.
     */
    if (current === null) return
    const turnId = current.id

    /*
     * `MlCopilotServerMessage` is **externally** tagged — `{delta: {...}}`,
     * `{project_updated: {...}}` — unlike the client's messages, which carry a
     * `type` field. `main` handles this with a hand-maintained array of literal
     * keys and a comment saying it sucks, which means a server message added
     * without updating the list silently does nothing.
     *
     * `in` narrows these correctly and needs no list, so a variant this does not
     * handle is simply ignored here rather than ignored *everywhere*.
     */
    if ('delta' in message) {
      updateTurn(turnId, (previous) => ({
        ...previous,
        response: previous.response + message.delta.delta,
      }))
      return
    }

    if ('project_updated' in message) {
      // Mid-turn output. Carries no statuses, so it can never delete.
      applyOutputs(turnId, message.project_updated.files)
      return
    }

    if ('tool_output' in message) {
      const { result } = message.tool_output
      if (toolResultFailed(result)) {
        finish(turnId, 'failed')
        return
      }
      applyOutputs(turnId, outputsOf(result), manifestOf(result))
      return
    }

    if ('end_of_stream' in message) {
      finish(turnId, 'complete')
      return
    }

    if ('error' in message || 'access_denied' in message) {
      finish(turnId, 'failed')
      return
    }

    // Everything else — reasoning, usage, mode lists, replay — belongs to
    // somebody other than a turn's edit stream.
  })

  return {
    id,
    author,
    transcript: computed(() => transcript.value),
    conflicts: computed(() => conflicts.value),
    connection:
      connection ??
      computed(() => ({
        status: 'connected' as const,
        error: null,
        superseded: false,
      })),
    status: computed(() => {
      const latest = transcript.value.at(-1)
      if (latest === undefined) return 'idle'
      if (latest.status === 'streaming') return 'streaming'
      if (latest.status === 'waiting') return 'waiting'
      if (latest.status === 'failed') return 'failed'
      return 'idle'
    }),

    async send(prompt) {
      // One turn at a time per conversation. A second prompt supersedes the
      // first rather than racing it, which is also what the service assumes.
      if (turn !== null) interrupt()

      const turnId = mintTurnId()
      turn = { id: turnId, controller: new AbortController() }
      conflicts.value = []

      /*
       * The turn goes into the transcript before anything is awaited, so the
       * pane shows the prompt the moment it is sent rather than after the
       * project has been read off disk.
       */
      transcript.value = [
        ...transcript.peek(),
        {
          id: turnId,
          prompt,
          response: '',
          at: Date.now(),
          status: 'streaming',
          paths: [],
          conflicts: [],
          waiting: [],
        },
      ]

      /*
       * Captured before sending, and the same content is used for every diff this
       * turn produces. Sending one thing and diffing against another is the bug
       * that makes the model and the app disagree about what is on disk.
       *
       * Awaiting here is safe in a way awaiting between a rebase and a dispatch
       * is not — no edit exists yet. But the turn *can* be superseded while the
       * disk is read, so it is checked afterwards: sending a prompt for a turn
       * the user has already replaced would have the service work on a question
       * nobody asked.
       */
      const project = await captureProject()
      if (turn?.id !== turnId) return

      for (const [path, contents] of project) track(path, contents)

      transport.send({
        type: 'user',
        content: prompt,
        current_files: Object.fromEntries(
          [...project].map(([path, contents]) => [
            path,
            Array.from(new TextEncoder().encode(contents)),
          ])
        ),
      })
    },

    interrupt,

    revert(turnId) {
      const entry = transcript.peek().find((each) => each.id === turnId)
      if (entry === undefined) return

      /*
       * The shared implementation, the same one the project's undo stack uses.
       * `addToHistory` is left at its default: undoing the agent's turn is an
       * edit the user made, and they should be able to take it back.
       */
      revertContribution({
        contributionId: turnId,
        paths: entry.paths,
        changeHistory,
        bufferForPath: (path) => target.bufferForPath(path),
      })

      /*
       * The service's copy no longer matches ours, and it has no idea. Dropping
       * the view forces the next turn to recapture rather than diff against a
       * document we have just undone.
       */
      for (const path of entry.paths) untrack(path)
    },

    dispose() {
      stopListening()
      for (const stop of following.values()) stop()
      following.clear()
      ledger.clear()
      view.clear()
      claims?.release(author)
      turn = null
    },
  }
}

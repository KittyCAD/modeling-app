import type {
  MlCopilotClientMessage,
  MlCopilotServerMessage,
} from '@kittycad/lib'
import { type ReadonlySignal, computed, signal } from '@preact/signals'
import {
  type ApplyTarget,
  type PathConflict,
  applyChanges,
} from '@src/features/zookeeper/applyChanges'
import {
  deriveChanges,
  manifestOf,
  outputsOf,
  toolResultFailed,
} from '@src/features/zookeeper/deriveEdit'
import type { ChangeHistory } from '@src/lib/collab/changeHistory'
import type { WriteClaims } from '@src/lib/collab/claims'
import { createDivergenceLedger } from '@src/lib/collab/divergence'
import { followLocalChanges } from '@src/lib/collab/followLocalChanges'
import { inverseForContribution } from '@src/lib/collab/revert'

/**
 * Whatever carries messages to and from the service.
 *
 * A port rather than a socket, so a conversation can be driven in a test without
 * one — and so the socket's lifetime is somebody else's problem. A conversation
 * outlives a disconnection; it should not own the thing that disconnected.
 */
export interface ZookeeperTransport {
  send(message: MlCopilotClientMessage): void
  onMessage(listener: (message: MlCopilotServerMessage) => void): () => void
}

export type TurnStatus =
  | 'streaming'
  | 'complete'
  | 'interrupted'
  | 'failed'
  /** Held off a file another writer is mid-turn on. Needs a resync, not a retry. */
  | 'waiting'

export interface Turn {
  id: string
  prompt: string
  /** Accumulated `delta` text. */
  response: string
  at: number
  status: TurnStatus
  /** Paths this turn changed, in the order they first landed. */
  paths: readonly string[]
  /** Paths it could not change, and why. */
  conflicts: readonly PathConflict[]
  /** Paths another writer was holding. */
  waiting: readonly string[]
}

export interface Conversation {
  readonly id: string
  /** The collaborator id every edit of this conversation is attributed to. */
  readonly author: string
  readonly transcript: ReadonlySignal<readonly Turn[]>
  /**
   * What the pane shows.
   *
   * `waiting` is distinct from `idle` on purpose: a turn held off a file has not
   * finished and is not working either, and the user needs to be told which —
   * "Zookeeper (2) is waiting for main.kcl" is only renderable if this says so.
   */
  readonly status: ReadonlySignal<'idle' | 'streaming' | 'waiting' | 'failed'>
  /** Conflicts from the most recent turn, for a non-blocking bar. */
  readonly conflicts: ReadonlySignal<readonly PathConflict[]>
  send(prompt: string): void
  /** Stop the current turn, locally and at the service. */
  interrupt(): void
  /** Undo one turn's edits, keeping everything that happened since. */
  revert(turnId: string): void
  dispose(): void
}

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
   * The project as it stands, by project-relative path.
   *
   * Called once at the start of a turn. This is what the service is told and what
   * every diff for the turn is measured against, so it must be the same content
   * in both places — see `captureBaseline` in the design notes for why a buffer
   * snapshot alone is not enough.
   */
  captureProject: () => ReadonlyMap<string, string>
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
    captureProject,
    nextTurnId,
  } = dependencies

  const ledger = createDivergenceLedger()
  /** What the service last saw, per path. Advances as its output lands. */
  const view = new Map<string, string>()
  /** One subscription per path we have begun tracking. */
  const following = new Map<string, () => void>()

  const transcript = signal<readonly Turn[]>([])
  const conflicts = signal<readonly PathConflict[]>([])

  let turn: { id: string; controller: AbortController } | null = null
  let turnCounter = 0

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
    status: computed(() => {
      const latest = transcript.value.at(-1)
      if (latest === undefined) return 'idle'
      if (latest.status === 'streaming') return 'streaming'
      if (latest.status === 'waiting') return 'waiting'
      if (latest.status === 'failed') return 'failed'
      return 'idle'
    }),

    send(prompt) {
      // One turn at a time per conversation. A second prompt supersedes the
      // first rather than racing it, which is also what the service assumes.
      if (turn !== null) interrupt()

      const turnId = mintTurnId()
      turn = { id: turnId, controller: new AbortController() }
      conflicts.value = []

      /*
       * Captured before sending, and the same content is used for every diff this
       * turn produces. Sending one thing and diffing against another is the bug
       * that makes the model and the app disagree about what is on disk.
       */
      const project = captureProject()
      for (const [path, contents] of project) track(path, contents)

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

      for (const path of entry.paths) {
        const buffer = target.bufferForPath(path)
        if (buffer === undefined) continue

        const inverse = inverseForContribution({
          applied: changeHistory.entries(path),
          contributionId: turnId,
        })
        if (inverse.changes === null) continue

        buffer.dispatch({ changes: inverse.changes })
      }

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

import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type {
  MlCopilotClientMessage,
  MlCopilotServerMessage,
} from '@kittycad/lib'
import type { TextEdit } from '@src/contracts/modelingOperations'
import type { PresenceEntry } from '@src/lib/collab/presence'
import type { ConflictReason } from '@src/lib/collab/rebase'

/**
 * The panel's layout area id.
 *
 * Lives here rather than in the feature because the modelling layout preset has
 * to name it to place it on a rail, and a preset reaching into a feature for a
 * constant is the wrong direction. Both sides import the contract instead.
 */
export const ZOOKEEPER_AREA_ID = 'project.zookeeper'

export type ConversationId = string

/** A change that could not be applied, and what it was going to be. */
export interface PathConflict {
  path: string
  reason: ConflictReason
  /** In the writer's coordinates, so a conflict UI can offer its version. */
  edits: readonly TextEdit[]
}

export type TurnStatus =
  | 'streaming'
  | 'complete'
  | 'interrupted'
  | 'failed'
  /** Held off a file another writer is mid-turn on. Needs a resync, not a retry. */
  | 'waiting'

/** One step the service said it intends to take, before it takes it. */
export interface ReasoningPlanStep {
  /** The file it means to edit, as the service names it. */
  path: string
  instructions: string
}

/**
 * What the service showed of its working, in our own shape.
 *
 * Six kinds for the protocol's fifteen `ReasoningMessage` arms, because the
 * distinctions the protocol draws are mostly about *provenance* — `kcl_docs`
 * versus `kcl_code_examples` versus `feature_tree_outline` are three ways of
 * saying "here is something I looked at" — and a pane that rendered fifteen
 * things fifteen ways would be a worse explanation than one that renders six.
 *
 * Ours rather than the generated union, for the reason the transcript format
 * already gives: a local copy of a protocol type is a migration liability, and
 * these get written to disk.
 */
export type ReasoningEntry =
  /** Prose, streamed. Adjacent chunks are joined rather than listed. */
  | { kind: 'text'; content: string }
  /** `design_plan`: which files it intends to touch, and why. */
  | { kind: 'plan'; steps: readonly ReasoningPlanStep[] }
  | { kind: 'code'; content: string }
  | { kind: 'error'; message: string }
  /** A file the service says it created, changed or removed on its side. */
  | { kind: 'file'; action: 'created' | 'updated' | 'deleted'; path: string }
  /** Something it consulted: docs, examples, the feature tree. */
  | { kind: 'reference'; label: string; content: string }

export interface Turn {
  id: string
  prompt: string
  /** Accumulated streamed text. */
  response: string
  at: number
  status: TurnStatus
  /** Paths this turn changed, in the order they first landed. */
  paths: readonly string[]
  conflicts: readonly PathConflict[]
  /** Paths another writer was holding. */
  waiting: readonly string[]
  /**
   * Paths the turn meant to change and did not, with the reason verbatim.
   *
   * Separate from `conflicts`, which means "your edit and mine disagree". This
   * means the change never got as far as being attempted — no baseline, no
   * project to create a file in. Recorded because the alternative was what sent
   * Frank asking: a turn that reported success while a file it created never
   * appeared, and an agent that read the next turn's `current_files`, saw the
   * file missing, and reasonably concluded somebody had deleted it.
   *
   * The reason is a bare string on purpose: it comes from two enums a layer
   * apart (`RefusalReason` when deriving, `DeferralReason` when applying) and
   * uniting them in the contract would make every consumer care which layer
   * failed, which is not a thing anybody reading a transcript wants to know.
   */
  unapplied: readonly UnappliedChange[]
  /**
   * The turn's working, in arrival order.
   *
   * Kept on the turn rather than in a side channel because it is the answer to
   * "what does *working* mean", and that question is only ever asked about a
   * particular turn. It persists with the turn for the same reason.
   */
  reasoning: readonly ReasoningEntry[]
}

/** A path a turn intended to change but did not. */
export interface UnappliedChange {
  path: string
  reason: string
}

/** Whatever carries messages to and from the service. */
export interface ZookeeperTransport {
  send(message: MlCopilotClientMessage): void
  onMessage(listener: (message: MlCopilotServerMessage) => void): () => void
}

/** What the panel needs to say about a conversation's socket. */
export interface ConversationConnection {
  status: 'offline' | 'connecting' | 'connected' | 'failed'
  error: string | null
  /** True when the conversation was taken over elsewhere. Reconnecting will not help. */
  superseded: boolean
}

export interface Conversation {
  readonly id: ConversationId
  /** The collaborator id every edit of this conversation is attributed to. */
  readonly author: string
  /**
   * The project this conversation was opened in, by path, or null if there was
   * none.
   *
   * Recorded at open rather than read from the session, because the session's
   * *current* project is the wrong answer for a conversation that has outlived
   * the project it was started in — and one can: closing a project leaves its
   * conversations connected and streaming. Anything attributing a conversation's
   * work, credits included, needs where it started rather than where the app is
   * looking now.
   */
  readonly projectPath: string | null
  readonly transcript: ReadonlySignal<readonly Turn[]>
  /**
   * What the pane shows.
   *
   * `waiting` is distinct from `idle`: a turn held off a file has not finished
   * and is not working either, and the user needs to be told which.
   */
  readonly status: ReadonlySignal<'idle' | 'streaming' | 'waiting' | 'failed'>
  readonly conflicts: ReadonlySignal<readonly PathConflict[]>
  /**
   * The socket, for the panel.
   *
   * Separate from `status`, which is about turns: a conversation whose socket
   * never came up has no failed turn to show, and saying nothing would leave
   * somebody typing into a panel that cannot send.
   */
  readonly connection: ReadonlySignal<ConversationConnection>
  send(prompt: string): Promise<void>
  interrupt(): void
  /** Undo one turn's edits, keeping everything that happened since. */
  revert(turnId: string): void
  dispose(): void
}

/**
 * Every conversation with the CAD agent, and which one the pane is showing.
 *
 * Keyed rather than singular, and the reason is the framing: Zookeeper is the
 * app's first remote collaborator, so a second conversation is a second
 * collaborator in the room rather than a feature bolted on. Keyed the same way
 * `ExecutionCoordinator.states` is — several are representable even though the UI
 * picks one — because the alternative is a singular field that has to be
 * rearchitected the first time somebody wants two.
 */
export interface ZookeeperService {
  readonly conversations: ReadonlySignal<
    ReadonlyMap<ConversationId, Conversation>
  >
  /** Which one the pane shows. A display choice, not a model constraint. */
  readonly active: ReadonlySignal<ConversationId | null>
  /** Whether a conversation can be opened at all — signed in, and a project open. */
  readonly available: ReadonlySignal<boolean>
  /** Why not, when it is unavailable. */
  readonly unavailableReason: ReadonlySignal<string | null>
  /**
   * Open a new conversation and make it the active one.
   *
   * Synchronous, and returns before the socket is up. Waiting would block the
   * panel for as long as the connect deadline, and the conversation has a
   * connection signal precisely so it can be shown while it comes up.
   */
  open(): ConversationId | null
  close(id: ConversationId): void
  /**
   * Show one conversation, or `null` for the panel's home view.
   *
   * Null is a real destination, not an absence: home is where earlier
   * conversations are listed and new ones are started, and it has to be
   * reachable while conversations are open rather than only before the first
   * one exists.
   */
  activate(id: ConversationId | null): void
  conversation(id: ConversationId): Conversation | undefined
  /** Which conversation, if any, currently holds the write claim on a path. */
  holderOf(path: string): ReadonlySignal<string | null>
  /**
   * Who wrote to which file recently.
   *
   * Only what has landed: the service says nothing about which file it is *about*
   * to touch, so presence before the first edit of a turn would be a guess.
   */
  readonly presence: ReadonlySignal<ReadonlyMap<string, PresenceEntry>>
  /**
   * Whether a turn's edits can still be undone exactly.
   *
   * True while the change history holds that turn's rows — which now survives a
   * reload, as long as the files were not edited outside the app. A turn from
   * beyond the log's horizon, or whose file changed in another editor, answers
   * false, and the panel offers nothing rather than something weaker than it
   * claims.
   */
  canRevert(turnId: string): ReadonlySignal<boolean>

  /**
   * Conversations stored for this project, newest first.
   *
   * Read from disk when the project opens. Populated even for conversations that
   * are not currently open, which is the point: a transcript that survives a
   * reload is only useful if something lists it.
   */
  readonly stored: ReadonlySignal<readonly StoredConversation[]>
  /**
   * Reopen a stored conversation.
   *
   * Its turns come back for reading and its remote id is used to ask the service
   * to replay. Its *edits* do not come back as revertible: the change history
   * they were applied against died with the session that made them.
   */
  resume(id: ConversationId): ConversationId | null
  /** Forget a stored conversation, on disk as well as here. */
  forget(id: ConversationId): void
}

/** A conversation on disk. */
export interface StoredConversation {
  id: ConversationId
  remoteId: string | null
  createdAt: number
  turns: readonly Turn[]
}

export const zookeeperContract = defineContract({
  zookeeperService: defineService<ZookeeperService>('zookeeper.service'),
})

export const { zookeeperService } = zookeeperContract

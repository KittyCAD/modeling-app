import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type {
  MlCopilotClientMessage,
  MlCopilotServerMessage,
} from '@kittycad/lib'
import type { TextEdit } from '@src/contracts/modelingOperations'
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
  activate(id: ConversationId): void
  conversation(id: ConversationId): Conversation | undefined
  /** Which conversation, if any, currently holds the write claim on a path. */
  holderOf(path: string): ReadonlySignal<string | null>
}

export const zookeeperContract = defineContract({
  zookeeperService: defineService<ZookeeperService>('zookeeper.service'),
})

export const { zookeeperService } = zookeeperContract

import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { BufferId } from '@src/contracts/buffers'
import type { ProjectSnapshot } from '@src/contracts/projectSession'

export type ExecutionStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/**
 * A finding about a document.
 *
 * Volatile by nature: it changes on every run, so it travels through
 * transactions and state fields rather than through the structural context. Byte
 * offsets, matching CodeMirror's own positions and KCL's source ranges.
 */
export interface ExecutionDiagnostic {
  from: number
  to: number
  severity: 'error' | 'warning' | 'info'
  message: string
}

/**
 * What gets submitted for execution.
 *
 * A versioned *capture*, never live state. The coordinator and the executor both
 * work from immutable content, which is what makes a result attributable to a
 * specific document version and therefore rejectable when stale.
 */
export interface ExecutionRequest {
  requestId: string
  bufferId: BufferId
  /** The buffer version this content came from. Guards stale results. */
  bufferVersion: number
  pathRevision: number
  /** Absolute resource path, or null for a scratch buffer. */
  path: string | null
  languageId: string
  contents: string
  contentId: string
  /** The rest of the project, for executors that resolve imports. */
  project: ProjectSnapshot
  /** Aborted when the request is superseded or cancelled. */
  signal: AbortSignal
}

export interface ExecutionResult {
  requestId: string
  diagnostics: readonly ExecutionDiagnostic[]
  /**
   * Executor-specific payload — an artifact graph, geometry ids, an outcome
   * object. Opaque here so the coordinator never grows a dependency on what any
   * particular executor produces.
   */
  outcome?: unknown
}

/**
 * Something that can run a request.
 *
 * Injected rather than owned: the coordinator schedules, and an executor
 * executes. That separation is why a KCL analysis pass and an engine-backed
 * modelling run can share all the scheduling, supersession, and staleness logic
 * without either knowing about the other.
 */
export interface Executor {
  id: string
  order?: number
  /** Which requests this executor handles. First match wins. */
  accepts: (request: ExecutionRequest) => boolean
  run: (request: ExecutionRequest) => Promise<ExecutionResult>
}

/** Per-buffer execution state, for the editor and the status bar. */
export interface BufferExecutionState {
  bufferId: BufferId
  status: ExecutionStatus
  /** Buffer version the last completed result described. */
  resultVersion: number | null
  diagnostics: readonly ExecutionDiagnostic[]
  /** Set when the run itself failed, as opposed to producing diagnostics. */
  error: string | null
  durationMs: number | null
  /** Completed runs, so a consumer can tell "no diagnostics yet" from "clean". */
  runCount: number
}

export interface ExecutionRequestInput {
  bufferId: BufferId
  bufferVersion: number
  pathRevision: number
  path: string | null
  languageId: string
  contents: string
  contentId: string
  project: ProjectSnapshot
}

/**
 * Owns everything asynchronous about execution.
 *
 * Scheduling, supersession, cancellation, access to the shared engine, and
 * stale-result rejection all live here. Buffers and CodeMirror extensions
 * deliberately do not: an extension that owned a modelling runtime would tie the
 * runtime's lifetime to a mounted view.
 *
 * Keyed by buffer, so several executing buffers are representable even while the
 * session UI picks one.
 */
export interface ExecutionCoordinator {
  readonly states: ReadonlySignal<ReadonlyMap<BufferId, BufferExecutionState>>
  /** Never null: a buffer that has never run reports `idle`. */
  stateFor(bufferId: BufferId): ReadonlySignal<BufferExecutionState>
  /** Whether any run is in flight. The engine is shared, so runs serialize. */
  readonly busy: ReadonlySignal<boolean>

  /**
   * Ask for a run.
   *
   * Supersedes any queued or running request for the same buffer: the newest
   * content is the only content anyone wants, and an in-flight run for older
   * content is wasted work.
   */
  request(input: ExecutionRequestInput): void
  cancel(bufferId: BufferId): void
  cancelAll(): void
  /** Forget a buffer's state, when it closes. */
  forget(bufferId: BufferId): void
}

export const executionContract = defineContract({
  executorsValueSpec: appendValueSpec<Executor>('execution.executors'),
  executionCoordinatorService: defineService<ExecutionCoordinator>(
    'execution.coordinator'
  ),
})

export const { executorsValueSpec, executionCoordinatorService } =
  executionContract

export const idleExecutionState = (
  bufferId: BufferId
): BufferExecutionState => ({
  bufferId,
  status: 'idle',
  resultVersion: null,
  diagnostics: [],
  error: null,
  durationMs: null,
  runCount: 0,
})

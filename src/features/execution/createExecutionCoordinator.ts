import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { BufferId } from '@src/contracts/buffers'
import type {
  BufferExecutionState,
  ExecutionCoordinator,
  ExecutionRequest,
  ExecutionRequestInput,
  Executor,
} from '@src/contracts/execution'
import { idleExecutionState } from '@src/contracts/execution'

interface PendingRequest {
  request: ExecutionRequest
  controller: AbortController
}

export interface CoordinatorOptions {
  executors: ReadonlySignal<readonly Executor[]>
  /** Injectable for tests; production passes `Date.now`. */
  now?: () => number
}

let requestCounter = 0

/**
 * Schedules execution.
 *
 * Three things it owns, all of which are wrong to put in a buffer or an
 * extension:
 *
 * **Supersession.** A newer request for the same buffer aborts the older one,
 * queued or in flight. Nobody wants the results of content that no longer
 * exists, and finishing that run costs engine time the newer one needs.
 *
 * **Shared-engine serialization.** At most one run proceeds at a time, because
 * there is one engine behind this. Requests for other buffers queue rather than
 * racing, and the queue holds one entry per buffer — the newest.
 *
 * **Stale-result rejection.** A result is only applied if the buffer is still at
 * the version the request captured. Otherwise it describes a document that has
 * already changed, and showing its diagnostics would point at the wrong text.
 */
export function createExecutionCoordinator(
  options: CoordinatorOptions
): ExecutionCoordinator & { dispose: () => void } {
  const now = options.now ?? (() => Date.now())
  const states = signal<ReadonlyMap<BufferId, BufferExecutionState>>(new Map())

  /** One queued request per buffer: the newest supersedes the rest. */
  const queue = new Map<BufferId, PendingRequest>()
  let active: PendingRequest | null = null
  let draining = false
  let scheduled = false
  const busy = signal(false)

  /** Current buffer version, used to reject a stale result on completion. */
  const currentVersions = new Map<BufferId, number>()

  const patch = (bufferId: BufferId, change: Partial<BufferExecutionState>) => {
    const next = new Map(states.value)
    const previous = next.get(bufferId) ?? idleExecutionState(bufferId)
    next.set(bufferId, { ...previous, ...change })
    states.value = next
  }

  const executorFor = (request: ExecutionRequest) =>
    [...options.executors.value]
      .toSorted(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
      )
      .find((executor) => executor.accepts(request))

  async function runOne(pending: PendingRequest) {
    const { request, controller } = pending
    active = pending
    busy.value = true
    patch(request.bufferId, { status: 'running', error: null })

    const startedAt = now()
    try {
      const executor = executorFor(request)
      if (!executor) {
        // Nothing installed that can run this. Not an error: a build without a
        // KCL executor should simply not execute KCL.
        patch(request.bufferId, {
          status: 'idle',
          error: null,
          durationMs: null,
        })
        return
      }

      const result = await executor.run(request)

      if (controller.signal.aborted) {
        patch(request.bufferId, { status: 'cancelled' })
        return
      }

      // The buffer may have moved on while this ran. Applying the result now
      // would attach diagnostics to text that no longer exists.
      const currentVersion = currentVersions.get(request.bufferId)
      if (
        currentVersion !== undefined &&
        currentVersion !== request.bufferVersion
      ) {
        patch(request.bufferId, { status: 'cancelled' })
        return
      }

      patch(request.bufferId, {
        status: 'succeeded',
        diagnostics: result.diagnostics,
        resultVersion: request.bufferVersion,
        error: null,
        durationMs: now() - startedAt,
        runCount: (states.value.get(request.bufferId)?.runCount ?? 0) + 1,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        patch(request.bufferId, { status: 'cancelled' })
        return
      }
      patch(request.bufferId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        durationMs: now() - startedAt,
        runCount: (states.value.get(request.bufferId)?.runCount ?? 0) + 1,
      })
    } finally {
      if (active === pending) {
        active = null
        busy.value = queue.size > 0
      }
    }
  }

  /**
   * Start draining on a microtask, not synchronously.
   *
   * Two requests for the same buffer in one tick — an edit immediately followed
   * by an explicit re-run — would otherwise start the first run and abort it a
   * moment later. Deferring by one tick lets supersession collapse them before
   * the executor is handed work that is already dead, and engine time is the
   * scarce resource here.
   */
  function scheduleDrain() {
    if (scheduled || draining) return
    scheduled = true
    void Promise.resolve().then(() => {
      scheduled = false
      void drain()
    })
  }

  async function drain() {
    if (draining) return
    draining = true
    try {
      while (queue.size > 0) {
        // Oldest queued buffer first, so one buffer editing continuously cannot
        // starve another that is waiting.
        const [bufferId, pending] = queue.entries().next().value as [
          BufferId,
          PendingRequest,
        ]
        queue.delete(bufferId)

        if (pending.controller.signal.aborted) {
          patch(bufferId, { status: 'cancelled' })
          continue
        }

        await runOne(pending)
      }
    } finally {
      draining = false
      busy.value = active !== null
    }
  }

  return {
    states: computed(() => states.value),
    busy: computed(() => busy.value),

    stateFor(bufferId) {
      return computed(
        () => states.value.get(bufferId) ?? idleExecutionState(bufferId)
      )
    },

    request(input: ExecutionRequestInput) {
      currentVersions.set(input.bufferId, input.bufferVersion)

      // Supersede: the queued entry and any in-flight run for this buffer are
      // both for older content.
      queue.get(input.bufferId)?.controller.abort()
      queue.delete(input.bufferId)
      if (active?.request.bufferId === input.bufferId) {
        active.controller.abort()
      }

      requestCounter += 1
      const controller = new AbortController()
      const request: ExecutionRequest = {
        ...input,
        requestId: `execution-${requestCounter}`,
        signal: controller.signal,
      }

      queue.set(input.bufferId, { request, controller })
      patch(input.bufferId, { status: 'queued' })
      busy.value = true

      scheduleDrain()
    },

    cancel(bufferId) {
      queue.get(bufferId)?.controller.abort()
      queue.delete(bufferId)
      if (active?.request.bufferId === bufferId) active.controller.abort()
      patch(bufferId, { status: 'cancelled' })
    },

    cancelAll() {
      for (const [bufferId, pending] of queue) {
        pending.controller.abort()
        patch(bufferId, { status: 'cancelled' })
      }
      queue.clear()
      active?.controller.abort()
    },

    forget(bufferId) {
      this.cancel(bufferId)
      currentVersions.delete(bufferId)
      const next = new Map(states.value)
      next.delete(bufferId)
      states.value = next
    },

    dispose() {
      this.cancelAll()
    },
  }
}

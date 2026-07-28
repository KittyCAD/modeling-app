import { type ReadonlySignal, type Signal, signal } from '@preact/signals-core'
import type {
  SystemIOOperation,
  SystemIOOperationSnapshot,
  SystemIOOperationStatus,
  SystemIORequestBase,
} from '@src/lib/systemIO/registry/contract'

export type SystemIOOperationHandlerContext = {
  readonly signal: AbortSignal
}

export type SystemIOOperationHandler<TResult> = (
  context: SystemIOOperationHandlerContext
) => Promise<TResult> | TResult

export type SystemIOOperationQueueOptions = {
  createId?: () => string
  now?: () => number
  /**
   * Initial value for the {@link SystemIOOperationQueue.recordLimit} signal.
   * Defaults to {@link DEFAULT_OPERATION_RECORD_LIMIT}.
   */
  recordLimit?: number
}

export type SystemIOOperationQueue<
  TRequest extends SystemIORequestBase = SystemIORequestBase,
> = {
  readonly operations: ReadonlySignal<
    readonly SystemIOOperationSnapshot<TRequest>[]
  >
  /**
   * Maximum number of operation snapshots to retain. Only settled
   * (succeeded/failed/cancelled) records are evicted, oldest first; in-flight
   * operations are always kept. Set to `Infinity` to retain every record
   * (e.g. for a debug/inspection UI) at the cost of unbounded growth.
   */
  readonly recordLimit: Signal<number>
  enqueue: <TResult>(
    operationRequest: SystemIOQueueRequest<TRequest>,
    handler: SystemIOOperationHandler<TResult>
  ) => SystemIOOperation<TResult, TRequest>
}

export type SystemIOQueueRequest<
  TRequest extends SystemIORequestBase = SystemIORequestBase,
> = {
  readonly request: TRequest
  readonly resourceKey?: string
  readonly coalesceKey?: string
}

type CoalesceEntry<TRequest extends SystemIORequestBase> = {
  readonly operation: SystemIOOperation<unknown, TRequest>
  readonly status: ReadonlySignal<SystemIOOperationStatus>
  readonly replacePending: (
    request: TRequest,
    handler: SystemIOOperationHandler<unknown>
  ) => void
}

const DEFAULT_RESOURCE_KEY = 'system-io.default'

export const DEFAULT_OPERATION_RECORD_LIMIT = 200

function isSettledStatus(status: SystemIOOperationStatus) {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

export function createSystemIOAbortError() {
  const error = new Error('SystemIO operation was cancelled')
  error.name = 'AbortError'
  return error
}

export function createSystemIOOperationQueue<
  TRequest extends SystemIORequestBase = SystemIORequestBase,
>(
  options: SystemIOOperationQueueOptions = {}
): SystemIOOperationQueue<TRequest> {
  const operations = signal<readonly SystemIOOperationSnapshot<TRequest>[]>([])
  const createId = options.createId ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => Date.now())
  const recordLimit = signal<number>(
    options.recordLimit ?? DEFAULT_OPERATION_RECORD_LIMIT
  )
  const resourceTails = new Map<string, Promise<void>>()
  const coalescedOperations = new Map<string, CoalesceEntry<TRequest>>()

  const pruneSettledOperations = () => {
    const limit = recordLimit.value
    if (!Number.isFinite(limit)) {
      return
    }

    const maxRecords = Math.max(0, Math.floor(limit))
    const current = operations.value
    if (current.length <= maxRecords) {
      return
    }

    let excess = current.length - maxRecords
    const kept = current.filter((snapshot) => {
      // Evict finished records only, oldest first, so in-flight operations are
      // always represented and their later status updates still land.
      if (excess > 0 && isSettledStatus(snapshot.status)) {
        excess -= 1
        return false
      }
      return true
    })

    if (kept.length !== current.length) {
      operations.value = kept
    }
  }

  return {
    operations,
    recordLimit,
    enqueue<TResult>(
      operationRequest: SystemIOQueueRequest<TRequest>,
      handler: SystemIOOperationHandler<TResult>
    ) {
      const { request, resourceKey, coalesceKey } = operationRequest

      if (coalesceKey) {
        const existing = coalescedOperations.get(coalesceKey)
        // Only fold into an operation that hasn't started yet. A `running`
        // operation may have already captured state that predates whatever
        // triggered this request (e.g. a filesystem mutation), so it must run
        // as a fresh operation rather than reuse the in-flight result.
        if (existing && existing.status.value === 'queued') {
          // Adopt the newest request/handler so the freshest intent runs when
          // the still-queued operation starts, rather than silently discarding
          // this caller's work in favor of whatever enqueued first.
          existing.replacePending(request, handler)
          return existing.operation as SystemIOOperation<TResult, TRequest>
        }
      }

      const id = createId()
      // Track request/handler mutably so a later coalesced request can replace
      // a still-queued operation's work with the newest intent.
      let activeRequest = request
      let activeHandler: SystemIOOperationHandler<TResult> = handler
      const queueResourceKey = resourceKey ?? DEFAULT_RESOURCE_KEY
      const status = signal<SystemIOOperationStatus>('queued')
      const abortController = new AbortController()
      let settled = false
      let cancelled = false
      let resolveResult!: (value: TResult | PromiseLike<TResult>) => void
      let rejectResult!: (reason?: unknown) => void

      const result = new Promise<TResult>((resolve, reject) => {
        resolveResult = resolve
        rejectResult = reject
      })

      // Many callers only observe operations through the status signals and
      // never read `.result` (fire-and-forget refreshes, for example). Attach
      // an internal no-op rejection handler so a failed or cancelled operation
      // cannot escape as an unhandled promise rejection. Consumers that do
      // await `.result` still receive the rejection through their own handler.
      void result.catch(() => {})

      const updateSnapshot = (
        patch: Partial<SystemIOOperationSnapshot<TRequest>>
      ) => {
        operations.value = operations.value.map((snapshot) =>
          snapshot.id === id ? { ...snapshot, ...patch } : snapshot
        )
      }

      const clearCoalescedOperation = () => {
        if (
          coalesceKey &&
          coalescedOperations.get(coalesceKey)?.operation === operation
        ) {
          coalescedOperations.delete(coalesceKey)
        }
      }

      const finishCancelled = (error: unknown = createSystemIOAbortError()) => {
        if (settled) {
          return
        }

        settled = true
        status.value = 'cancelled'
        updateSnapshot({
          status: 'cancelled',
          finishedAt: now(),
          error,
        })
        clearCoalescedOperation()
        pruneSettledOperations()
        rejectResult(error)
      }

      const finishFailed = (error: unknown) => {
        if (settled) {
          return
        }

        settled = true
        status.value = 'failed'
        updateSnapshot({
          status: 'failed',
          finishedAt: now(),
          error,
        })
        clearCoalescedOperation()
        pruneSettledOperations()
        rejectResult(error)
      }

      const finishSucceeded = (value: TResult) => {
        if (settled) {
          return
        }

        settled = true
        status.value = 'succeeded'
        updateSnapshot({
          status: 'succeeded',
          finishedAt: now(),
        })
        clearCoalescedOperation()
        pruneSettledOperations()
        resolveResult(value)
      }

      function cancel() {
        if (settled || cancelled) {
          return
        }

        cancelled = true
        abortController.abort()
        finishCancelled()
      }

      const operation: SystemIOOperation<TResult, TRequest> = {
        id,
        get request() {
          return activeRequest
        },
        status,
        result,
        cancel,
      }

      operations.value = [
        ...operations.value,
        {
          id,
          request,
          status: 'queued',
          enqueuedAt: now(),
        },
      ]
      pruneSettledOperations()

      if (coalesceKey) {
        coalescedOperations.set(coalesceKey, {
          operation,
          status,
          replacePending: (nextRequest, nextHandler) => {
            activeRequest = nextRequest
            activeHandler = nextHandler as SystemIOOperationHandler<TResult>
            updateSnapshot({ request: activeRequest })
          },
        })
      }

      const previousTail =
        resourceTails.get(queueResourceKey) ?? Promise.resolve()
      const currentTail = previousTail
        .catch(() => undefined)
        .then(async () => {
          if (cancelled) {
            return
          }

          status.value = 'running'
          updateSnapshot({
            status: 'running',
            startedAt: now(),
          })

          try {
            const value = await activeHandler({
              signal: abortController.signal,
            })
            if (cancelled || abortController.signal.aborted) {
              finishCancelled()
              return
            }

            finishSucceeded(value)
          } catch (error) {
            if (cancelled || abortController.signal.aborted) {
              finishCancelled(error)
              return
            }

            finishFailed(error)
          }
        })
        .finally(() => {
          if (resourceTails.get(queueResourceKey) === currentTail) {
            resourceTails.delete(queueResourceKey)
          }
        })

      resourceTails.set(queueResourceKey, currentTail)
      void currentTail

      return operation
    },
  }
}

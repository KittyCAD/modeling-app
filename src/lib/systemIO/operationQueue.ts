import { type ReadonlySignal, signal } from '@preact/signals-core'
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
}

export type SystemIOOperationQueue<
  TRequest extends SystemIORequestBase = SystemIORequestBase,
> = {
  readonly operations: ReadonlySignal<
    readonly SystemIOOperationSnapshot<TRequest>[]
  >
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

const DEFAULT_RESOURCE_KEY = 'system-io.default'

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
  const resourceTails = new Map<string, Promise<void>>()
  const coalescedOperations = new Map<
    string,
    SystemIOOperation<unknown, TRequest>
  >()

  return {
    operations,
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
          return existing as SystemIOOperation<TResult, TRequest>
        }
      }

      const id = createId()
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

      const updateSnapshot = (
        patch: Partial<SystemIOOperationSnapshot<TRequest>>
      ) => {
        operations.value = operations.value.map((snapshot) =>
          snapshot.id === id ? { ...snapshot, ...patch } : snapshot
        )
      }

      const clearCoalescedOperation = () => {
        if (coalesceKey && coalescedOperations.get(coalesceKey) === operation) {
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
        request,
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

      if (coalesceKey) {
        coalescedOperations.set(coalesceKey, operation)
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
            const value = await handler({
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

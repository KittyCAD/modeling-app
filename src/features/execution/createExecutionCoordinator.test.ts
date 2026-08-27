import { computed, signal } from '@preact/signals'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ExecutionRequest,
  ExecutionRequestInput,
  Executor,
} from '@src/contracts/execution'
import { createExecutionCoordinator } from '@src/features/execution/createExecutionCoordinator'

const snapshot = {
  operationId: 'op-1',
  capturedAt: 0,
  projectPath: '/p',
  buffers: [],
}

const requestFor = (
  bufferId: string,
  version = 1,
  contents = 'thickness = 4'
): ExecutionRequestInput => ({
  bufferId,
  bufferVersion: version,
  pathRevision: 0,
  path: `/p/${bufferId}.kcl`,
  languageId: 'kcl',
  contents,
  contentId: `content-${version}`,
  project: snapshot,
})

/** An executor whose completion the test controls. */
function createDeferredExecutor(id = 'test') {
  const started: ExecutionRequest[] = []
  let resolveCurrent: ((diagnostics?: unknown[]) => void) | null = null
  let rejectCurrent: ((error: Error) => void) | null = null

  const executor: Executor = {
    id,
    accepts: () => true,
    run: (request) => {
      started.push(request)
      return new Promise((resolve, reject) => {
        resolveCurrent = (diagnostics = []) =>
          resolve({
            requestId: request.requestId,
            diagnostics: diagnostics as never,
          })
        rejectCurrent = reject
      })
    },
  }

  return {
    executor,
    started,
    finish: (diagnostics?: unknown[]) => {
      resolveCurrent?.(diagnostics)
      return Promise.resolve().then(() => Promise.resolve())
    },
    fail: (message: string) => {
      rejectCurrent?.(new Error(message))
      return Promise.resolve().then(() => Promise.resolve())
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('execution coordinator', () => {
  let deferred: ReturnType<typeof createDeferredExecutor>
  let coordinator: ReturnType<typeof createExecutionCoordinator>

  beforeEach(() => {
    deferred = createDeferredExecutor()
    coordinator = createExecutionCoordinator({
      executors: computed(() => [deferred.executor]),
      now: () => 1000,
    })
  })

  it('reports idle for a buffer that has never run', () => {
    const state = coordinator.stateFor('unknown').value
    expect(state.status).toBe('idle')
    expect(state.diagnostics).toEqual([])
    expect(state.runCount).toBe(0)
  })

  it('queues, runs, and succeeds', async () => {
    coordinator.request(requestFor('a'))
    expect(coordinator.stateFor('a').value.status).toBe('queued')

    await flush()
    expect(coordinator.stateFor('a').value.status).toBe('running')
    expect(coordinator.busy.value).toBe(true)

    await deferred.finish([
      { from: 0, to: 4, severity: 'warning', message: 'unused' },
    ])
    await flush()

    const state = coordinator.stateFor('a').value
    expect(state.status).toBe('succeeded')
    expect(state.diagnostics).toHaveLength(1)
    expect(state.resultVersion).toBe(1)
    expect(state.runCount).toBe(1)
    expect(coordinator.busy.value).toBe(false)
  })

  it('supersedes a queued request for the same buffer', async () => {
    coordinator.request(requestFor('a', 1, 'first'))
    coordinator.request(requestFor('a', 2, 'second'))
    await flush()

    // Only the newest content is worth running.
    expect(deferred.started).toHaveLength(1)
    expect(deferred.started[0].contents).toBe('second')
  })

  it('aborts an in-flight run when the same buffer is resubmitted', async () => {
    coordinator.request(requestFor('a', 1))
    await flush()
    const firstSignal = deferred.started[0].signal
    expect(firstSignal.aborted).toBe(false)

    coordinator.request(requestFor('a', 2))
    // The executor is told, so it can stop burning engine time on stale content.
    expect(firstSignal.aborted).toBe(true)
  })

  it('does not apply the result of an aborted run', async () => {
    coordinator.request(requestFor('a', 1))
    await flush()
    coordinator.request(requestFor('a', 2))

    await deferred.finish([
      { from: 0, to: 1, severity: 'error', message: 'stale' },
    ])
    await flush()

    expect(coordinator.stateFor('a').value.diagnostics).toHaveLength(0)
  })

  it('rejects a result whose version no longer matches the buffer', async () => {
    coordinator.request(requestFor('a', 1))
    await flush()

    // A newer version registered without a new run — the buffer moved on while
    // this was in flight. Its diagnostics would point at text that has changed.
    coordinator.request(requestFor('a', 5))
    await flush()
    deferred.started[0] // the stale one

    await deferred.finish([
      { from: 0, to: 1, severity: 'error', message: 'stale' },
    ])
    await flush()

    expect(coordinator.stateFor('a').value.diagnostics).toHaveLength(0)
  })

  it('serializes runs, because the engine is shared', async () => {
    coordinator.request(requestFor('a'))
    coordinator.request(requestFor('b'))
    await flush()

    // Only one at a time; b waits.
    expect(deferred.started).toHaveLength(1)
    expect(deferred.started[0].bufferId).toBe('a')
    expect(coordinator.stateFor('b').value.status).toBe('queued')

    await deferred.finish()
    await flush()

    expect(deferred.started).toHaveLength(2)
    expect(deferred.started[1].bufferId).toBe('b')
  })

  it('keeps per-buffer state, so several executing buffers are representable', async () => {
    coordinator.request(requestFor('a'))
    await flush()
    await deferred.finish()
    await flush()

    coordinator.request(requestFor('b'))
    await flush()
    await deferred.finish()
    await flush()

    expect(coordinator.states.value.size).toBe(2)
    expect(coordinator.stateFor('a').value.status).toBe('succeeded')
    expect(coordinator.stateFor('b').value.status).toBe('succeeded')
  })

  it('records a run failure without losing the buffer state', async () => {
    coordinator.request(requestFor('a'))
    await flush()
    await deferred.fail('engine exploded')
    await flush()

    const state = coordinator.stateFor('a').value
    expect(state.status).toBe('failed')
    expect(state.error).toBe('engine exploded')
    expect(state.runCount).toBe(1)
  })

  it('cancels a specific buffer', async () => {
    coordinator.request(requestFor('a'))
    await flush()

    coordinator.cancel('a')
    expect(deferred.started[0].signal.aborted).toBe(true)
    expect(coordinator.stateFor('a').value.status).toBe('cancelled')
  })

  it('cancels everything, including what is queued', async () => {
    coordinator.request(requestFor('a'))
    coordinator.request(requestFor('b'))
    await flush()

    coordinator.cancelAll()
    expect(deferred.started[0].signal.aborted).toBe(true)
    expect(coordinator.stateFor('b').value.status).toBe('cancelled')
  })

  it('forgets a buffer, for when it closes', async () => {
    coordinator.request(requestFor('a'))
    await flush()
    await deferred.finish()
    await flush()

    coordinator.forget('a')
    expect(coordinator.states.value.has('a')).toBe(false)
  })

  it('stays idle when no executor accepts the request', async () => {
    const picky = createExecutionCoordinator({
      executors: computed(() => [
        { id: 'none', accepts: () => false, run: vi.fn() } as never,
      ]),
    })

    picky.request(requestFor('a'))
    await flush()

    // A build with no KCL executor should simply not execute KCL, not error.
    expect(picky.stateFor('a').value.status).toBe('idle')
    expect(picky.stateFor('a').value.error).toBeNull()
  })

  it('picks the accepting executor with the lowest order', async () => {
    const engine = createDeferredExecutor('engine')
    const analysis = createDeferredExecutor('analysis')
    const ordered = createExecutionCoordinator({
      executors: computed(() => [
        { ...analysis.executor, order: 100 },
        { ...engine.executor, order: 0 },
      ]),
    })

    ordered.request(requestFor('a'))
    await flush()

    // This is how an engine-backed executor takes precedence over the offline
    // analysis one without either knowing about the other.
    expect(engine.started).toHaveLength(1)
    expect(analysis.started).toHaveLength(0)
  })

  it('follows a change in the installed executors', async () => {
    const executors = signal<Executor[]>([])
    const dynamic = createExecutionCoordinator({
      executors: computed(() => executors.value),
    })

    dynamic.request(requestFor('a'))
    await flush()
    expect(dynamic.stateFor('a').value.status).toBe('idle')

    executors.value = [deferred.executor]
    dynamic.request(requestFor('a', 2))
    await flush()
    expect(deferred.started).toHaveLength(1)
  })
})

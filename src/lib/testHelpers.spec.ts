import { createEmptyAst } from '@src/editor/plugins/ast'
import { createKclManagerTestHarness } from '@src/lang/testHelpers/kclManagerTestHarness'
import { emptyExecState } from '@src/lang/wasm'
import type * as ClientErrors from '@src/lib/clientErrors'
import { getAstAndArtifactGraph } from '@src/lib/testHelpers'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@src/lib/clientErrors', async (importOriginal) => ({
  ...(await importOriginal<typeof ClientErrors>()),
  reportClientError: vi.fn().mockResolvedValue(undefined),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
  localStorage.clear()
})

it('reads the result of its own execution when the manager is idle', async () => {
  const { kclManager } = createKclManagerTestHarness('x = 1')
  const instance = await kclManager.wasmInstancePromise
  const ownState = emptyExecState()
  kclManager.engineCommandManager.started = true
  vi.spyOn(kclManager.rustContext, 'execute').mockResolvedValue(ownState)
  const result = await getAstAndArtifactGraph('x = 2', instance, kclManager)
  expect(result.artifactGraph).toBe(ownState.artifactGraph)
  expect(result.operations).toBe(ownState.operations)
  expect(kclManager.isExecuting).toBe(false)
})

it('keeps artifact reads pending until its requested execution finishes behind an active render', async () => {
  const { kclManager } = createKclManagerTestHarness('x = 1')
  const instance = await kclManager.wasmInstancePromise
  const active = deferred<ReturnType<typeof emptyExecState>>()
  const own = deferred<ReturnType<typeof emptyExecState>>()
  const activeState = emptyExecState()
  const ownState = emptyExecState()
  kclManager.engineCommandManager.started = true
  const rustExecute = vi
    .spyOn(kclManager.rustContext, 'execute')
    .mockReturnValueOnce(active.promise)
    .mockReturnValueOnce(own.promise)
  vi.useFakeTimers()
  const priorRender = kclManager.executeAst({
    ast: createEmptyAst(),
    executionId: 101,
  })
  await vi.waitFor(() => expect(rustExecute).toHaveBeenCalledTimes(1))
  let settled = false
  const artifactRead = getAstAndArtifactGraph(
    'x = 2',
    instance,
    kclManager
  ).then((result) => {
    settled = true
    return result
  })
  await vi.advanceTimersByTimeAsync(200)
  const returnedBeforePriorFinished = settled
  active.resolve(activeState)
  await priorRender
  await vi.waitFor(() => expect(rustExecute).toHaveBeenCalledTimes(2))
  const returnedBeforeOwnFinished = settled
  own.resolve(ownState)
  await kclManager.flushPendingEditorExecution()
  await vi.advanceTimersByTimeAsync(200)
  const result = await artifactRead
  expect(returnedBeforePriorFinished).toBe(false)
  expect(returnedBeforeOwnFinished).toBe(false)
  expect(result.artifactGraph).toBe(ownState.artifactGraph)
  expect(result.operations).toBe(ownState.operations)
})

it('serializes artifact helpers waiting for the same active render', async () => {
  const { kclManager } = createKclManagerTestHarness('x = 1')
  const instance = await kclManager.wasmInstancePromise
  const active = deferred<ReturnType<typeof emptyExecState>>()
  const first = deferred<ReturnType<typeof emptyExecState>>()
  const second = deferred<ReturnType<typeof emptyExecState>>()
  const firstState = emptyExecState()
  const secondState = emptyExecState()
  kclManager.engineCommandManager.started = true
  const rustExecute = vi
    .spyOn(kclManager.rustContext, 'execute')
    .mockReturnValueOnce(active.promise)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  vi.useFakeTimers()
  const priorRender = kclManager.executeAst({
    ast: createEmptyAst(),
    executionId: 101,
  })
  await vi.waitFor(() => expect(rustExecute).toHaveBeenCalledTimes(1))
  const firstRead = getAstAndArtifactGraph('x = 2', instance, kclManager)
  let secondSettled = false
  const secondRead = getAstAndArtifactGraph('x = 3', instance, kclManager).then(
    (result) => {
      secondSettled = true
      return result
    }
  )
  active.resolve(emptyExecState())
  await priorRender
  await vi.waitFor(() => expect(rustExecute).toHaveBeenCalledTimes(2))
  await vi.advanceTimersByTimeAsync(200)
  const secondReturnedBeforeFirstFinished = secondSettled
  first.resolve(firstState)
  await vi.advanceTimersByTimeAsync(200)
  await vi.waitFor(() => expect(rustExecute).toHaveBeenCalledTimes(3))
  second.resolve(secondState)
  await kclManager.flushPendingEditorExecution()
  await vi.advanceTimersByTimeAsync(200)
  const [firstResult, secondResult] = await Promise.all([firstRead, secondRead])
  expect(secondReturnedBeforeFirstFinished).toBe(false)
  expect(firstResult.artifactGraph).toBe(firstState.artifactGraph)
  expect(secondResult.artifactGraph).toBe(secondState.artifactGraph)
})

it('releases the next artifact helper after a queued parse fails', async () => {
  const { kclManager } = createKclManagerTestHarness('x = 1')
  const instance = await kclManager.wasmInstancePromise
  const ownState = emptyExecState()
  kclManager.engineCommandManager.started = true
  const rustExecute = vi
    .spyOn(kclManager.rustContext, 'execute')
    .mockResolvedValue(ownState)
  const invalidRead = getAstAndArtifactGraph('x =', instance, kclManager)
  const nextRead = getAstAndArtifactGraph('x = 2', instance, kclManager)
  await expect(invalidRead).rejects.toBeDefined()
  const result = await nextRead
  expect(rustExecute).toHaveBeenCalledOnce()
  expect(result.artifactGraph).toBe(ownState.artifactGraph)
})

it('lets a separate manager finish while another artifact helper is blocked', async () => {
  const first = createKclManagerTestHarness('x = 1').kclManager
  const second = createKclManagerTestHarness('x = 2').kclManager
  const instance = await first.wasmInstancePromise
  await second.wasmInstancePromise
  const blocked = deferred<ReturnType<typeof emptyExecState>>()
  const firstState = emptyExecState()
  const secondState = emptyExecState()
  first.engineCommandManager.started = true
  second.engineCommandManager.started = true
  const firstExecute = vi
    .spyOn(first.rustContext, 'execute')
    .mockReturnValue(blocked.promise)
  vi.spyOn(second.rustContext, 'execute').mockResolvedValue(secondState)
  vi.useFakeTimers()
  const firstRead = getAstAndArtifactGraph('x = 3', instance, first)
  await vi.waitFor(() => expect(firstExecute).toHaveBeenCalledOnce())
  let secondFinished = false
  const secondRead = getAstAndArtifactGraph('x = 4', instance, second).then(
    (result) => {
      secondFinished = true
      return result
    }
  )
  await vi.advanceTimersByTimeAsync(200)
  const secondFinishedIndependently = secondFinished
  blocked.resolve(firstState)
  await first.flushPendingEditorExecution()
  await vi.advanceTimersByTimeAsync(200)
  const [firstResult, secondResult] = await Promise.all([firstRead, secondRead])
  expect(secondFinishedIndependently).toBe(true)
  expect(firstResult.artifactGraph).toBe(firstState.artifactGraph)
  expect(secondResult.artifactGraph).toBe(secondState.artifactGraph)
})

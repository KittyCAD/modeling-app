import { createEmptyAst } from '@src/editor/plugins/ast'
import { createKclManagerTestHarness } from '@src/lang/testHelpers/kclManagerTestHarness'
import { emptyExecState } from '@src/lang/wasm'
import { getAstAndArtifactGraph } from '@src/lib/testHelpers'
import { afterEach, expect, it, vi } from 'vitest'

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

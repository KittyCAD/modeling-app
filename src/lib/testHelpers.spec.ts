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

it('serializes artifact helpers behind active work on the same manager', async () => {
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
  const secondRead = getAstAndArtifactGraph('x = 3', instance, kclManager)
  active.resolve(emptyExecState())
  await priorRender
  await vi.waitFor(() => expect(rustExecute).toHaveBeenCalledTimes(2))
  await vi.advanceTimersByTimeAsync(0)
  expect(rustExecute).toHaveBeenCalledTimes(2)
  first.resolve(firstState)
  await vi.advanceTimersByTimeAsync(100)
  await vi.waitFor(() => expect(rustExecute).toHaveBeenCalledTimes(3))
  second.resolve(secondState)
  await vi.advanceTimersByTimeAsync(100)
  const [firstResult, secondResult] = await Promise.all([firstRead, secondRead])
  expect(firstResult.artifactGraph).toBe(firstState.artifactGraph)
  expect(firstResult.operations).toBe(firstState.operations)
  expect(secondResult.artifactGraph).toBe(secondState.artifactGraph)
  expect(secondResult.operations).toBe(secondState.operations)
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

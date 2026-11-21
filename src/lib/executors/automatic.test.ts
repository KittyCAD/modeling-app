import { signal } from '@preact/signals-core'
import { createEditorDocument } from '@src/lib/editors/document'
import { createExecutor } from '@src/lib/executors/executor'
import { acquireAutomaticExecution } from '@src/lib/executors/automatic'
import { defineExecutorCapability } from '@src/lib/executors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { beforeAll, expect, it, onTestFinished, vi } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
function fixture(
  execute: (
    text: string,
    context: { signal: AbortSignal }
  ) => Promise<{ text: string }> | { text: string }
) {
  const source = createEditorDocument('original')
  const editor = {
    ...source.document,
    id: Symbol(),
    src: signal('notes.md'),
    classification: signal(undefined),
    readOnly: signal(false),
  }
  const capability = defineExecutorCapability({
    id: 'preview',
    matches: '*',
    execute,
  })
  const owned = createExecutor(editor, signal([capability]), () => {})
  onTestFinished(() => {
    owned.dispose()
    source.dispose()
  })
  return {
    ...owned,
    capability,
    edit: (text: string) =>
      source.document.dispatch({
        changes: {
          from: 0,
          to: source.document.state.doc.length,
          insert: text,
        },
      }),
  }
}

it('coalesces edits and shares one policy across leases, releasing it with its last consumer', async () => {
  const execute = vi.fn((text: string) => ({ text }))
  const f = fixture(execute)
  const first = acquireAutomaticExecution(f.executor, f.capability)
  const second = acquireAutomaticExecution(f.executor, f.capability)
  await vi.waitFor(() =>
    expect(f.executor.output.value.get(f.capability)).toEqual({
      text: 'original',
    })
  )
  expect(execute).toHaveBeenCalledOnce()
  first()
  f.edit('intermediate')
  f.edit('latest')
  await vi.waitFor(() =>
    expect(f.executor.output.value.get(f.capability)).toEqual({
      text: 'latest',
    })
  )
  expect(execute.mock.calls.map(([text]) => text)).toEqual([
    'original',
    'latest',
  ])
  second()
  f.edit('unscheduled')
  await Promise.resolve()
  expect(execute).toHaveBeenCalledTimes(2)
  expect(f.executor.result(f.capability).value.stale).toBe(true)
})

it('lets active work finish and then requests the latest input, skipping intermediate edits', async () => {
  const pending = Promise.withResolvers<{ text: string }>()
  let captured: AbortSignal | undefined
  const execute = vi.fn((text: string, context: { signal: AbortSignal }) => {
    captured ??= context.signal
    return text === 'original' ? pending.promise : { text }
  })
  const f = fixture(execute)
  onTestFinished(acquireAutomaticExecution(f.executor, f.capability))
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
  f.edit('intermediate')
  f.edit('latest')
  await Promise.resolve()
  expect(captured?.aborted).toBe(false)
  expect(execute).toHaveBeenCalledOnce()
  pending.resolve({ text: 'original' })
  await vi.waitFor(() =>
    expect(f.executor.output.value.get(f.capability)).toEqual({
      text: 'latest',
    })
  )
  expect(execute.mock.calls.map(([text]) => text)).toEqual([
    'original',
    'latest',
  ])
})

it('stops queued requests when disabled and catches up once when enabled again', async () => {
  const enabled = signal(false)
  const execute = vi.fn((text: string) => ({ text }))
  const f = fixture(execute)
  onTestFinished(
    acquireAutomaticExecution(f.executor, f.capability, () => enabled.value)
  )
  f.edit('off')
  await Promise.resolve()
  expect(execute).not.toHaveBeenCalled()
  enabled.value = true
  enabled.value = false
  await Promise.resolve()
  expect(execute).not.toHaveBeenCalled()
  await f.executor.run(f.capability)
  enabled.value = true
  await Promise.resolve()
  expect(execute).toHaveBeenCalledOnce()
  enabled.value = false
  f.edit('latest')
  enabled.value = true
  await vi.waitFor(() =>
    expect(f.executor.result(f.capability).value.data).toEqual({
      text: 'latest',
    })
  )
  expect(execute).toHaveBeenCalledTimes(2)
})

it('does not keep retrying a failed automatic request without changed input', async () => {
  const execute = vi.fn(() => Promise.reject(new Error('bad input')))
  const f = fixture(execute)
  onTestFinished(acquireAutomaticExecution(f.executor, f.capability))
  await vi.waitFor(() =>
    expect(f.executor.result(f.capability).value.error?.message).toBe(
      'bad input'
    )
  )
  await Promise.resolve()
  expect(execute).toHaveBeenCalledOnce()
})

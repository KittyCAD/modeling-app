import { signal } from '@preact/signals-core'
import { createEditorDocument } from '@src/lib/editors/document'
import { createExecutor } from '@src/lib/executors/executor'
import { expect, it, vi } from 'vitest'

it('refreshes only the requested executor while keeping source and dependency inputs current', async () => {
  const source = createEditorDocument('answer = 42')
  const editor = {
    ...source.document,
    backing: { type: 'text' as const },
    id: Symbol('editor'),
    src: signal('/main.kcl'),
    classification: signal({ languageId: 'kcl' }),
    readOnly: signal(false),
  }
  const execute = vi.fn(async (contents: string) => ({ contents }))
  const contributions = signal([{ id: 'test', matches: '*' as const, execute }])
  const first = createExecutor(editor, contributions, () => {}),
    second = createExecutor(editor, contributions, () => {})
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
  first.executor.refresh()
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3))
  expect(execute.mock.calls.at(-1)?.[0]).toBe('answer = 42')
  first.dispose()
  second.dispose()
  source.dispose()
  first.executor.refresh()
  await Promise.resolve()
  expect(execute).toHaveBeenCalledTimes(3)
})

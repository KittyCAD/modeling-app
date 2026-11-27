import { signal } from '@preact/signals-core'
import { createEditorDocument } from '@src/lib/editors/document'
import { createExecutor } from '@src/lib/executors/executor'
import { expect, it, vi } from 'vitest'

it('runs only the requested executor and ignores requests after disposal', async () => {
  const source = createEditorDocument('answer = 42')
  const editor = {
    ...source.document,
    id: Symbol('editor'),
    src: signal('/main.kcl'),
    classification: signal({ languageId: 'kcl' }),
    readOnly: signal(false),
  }
  const execute = vi.fn(async (contents: string) => ({ contents }))
  const contributions = signal([{ id: 'test', matches: '*' as const, execute }])
  const first = createExecutor(editor, contributions, () => {}),
    second = createExecutor(editor, contributions, () => {})
  await first.executor.run(contributions.peek()[0])
  await second.executor.run(contributions.peek()[0])
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
  await first.executor.run(contributions.peek()[0])
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3))
  expect(execute.mock.calls.at(-1)?.[0]).toBe('answer = 42')
  first.dispose()
  second.dispose()
  source.dispose()
  await first.executor.run(contributions.peek()[0])
  await Promise.resolve()
  expect(execute).toHaveBeenCalledTimes(3)
})

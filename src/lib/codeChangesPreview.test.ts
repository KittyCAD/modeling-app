import { signal } from '@preact/signals-core'
import {
  createCodeChangesPreview,
  type CodeChangesPreview,
} from '@src/lib/codeChangesPreview'
import { expect, it } from 'vitest'

it('isolates projects and rejects pending results after leaving a file or closing its project', async () => {
  const path = signal('/project/main.kcl')
  const editor = {
    get path() {
      return path.value
    },
  }
  const otherEditor = { path: '/project/main.kcl' }
  const activeEditor = signal<{ readonly path: string } | undefined>(editor)
  const first = createCodeChangesPreview(() => activeEditor.value)
  const second = createCodeChangesPreview(() => otherEditor)
  const pending: CodeChangesPreview = {
    owner: {},
    title: 'Code changes',
    status: 'loading',
  }
  const ready: CodeChangesPreview = {
    ...pending,
    status: 'ready',
    beforeText: 'width = 1mm',
    afterText: 'width = 2mm',
  }
  try {
    const publish = first.open(editor, pending)
    if (!publish) throw new Error('Expected the active editor to own a preview')
    let finish!: (result: CodeChangesPreview) => void
    const result = new Promise<CodeChangesPreview>((resolve) => {
      finish = resolve
    }).then(publish)
    second.open(otherEditor, pending)

    // The same legacy editor can change files and return before work finishes.
    path.value = '/project/other.kcl'
    expect(first.current.value).toBeNull()
    expect(second.current.value).toBe(pending)
    path.value = '/project/main.kcl'
    const publishCurrent = first.open(editor, pending)
    if (!publishCurrent) throw new Error('Expected a new preview')
    finish(ready)
    await result
    expect(first.current.value).toBe(pending)

    publishCurrent(ready)
    expect(first.current.value).toBe(ready)
    activeEditor.value = undefined
    expect(first.current.value).toBeNull()
    expect(first.open(editor, pending)).toBeUndefined()
    activeEditor.value = editor
    const publishBeforeClose = first.open(editor, pending)
    first.dispose()
    publishBeforeClose?.(ready)
    expect(first.current.value).toBeNull()
    expect(first.open(editor, pending)).toBeUndefined()
    expect(second.current.value).toBe(pending)
  } finally {
    first.dispose()
    second.dispose()
  }
})

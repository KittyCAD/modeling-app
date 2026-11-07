import '@src/lib/projectSession/next/testFeature'
import { undo } from '@codemirror/commands'
import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
  Slot,
} from '@kittycad/registry'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import savingExtension, {
  SAVE_EDITOR_COMMAND,
  saveExtension,
} from '@src/lib/save/registry'
import {
  editorSaveService,
  editorOnSaveValueSpec,
} from '@src/lib/save/registry/contract'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorCapabilityValueSpec,
  editorTabIndicatorValueSpec,
  editorsService,
  type Editor,
} from '@src/lib/editors/registry/contract'
import { EditorsPane } from '@src/lib/editors/EditorsPane'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { LayoutType } from '@src/lib/layout/types'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'

vi.mock('@src/lib/paths', () => ({ PATHS: { INDEX: '/' } }))

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('contributed editor saving', () => {
  let registry: Registry
  const writeFile = vi.fn<typeof testFileOperations.writeFile>()
  const extra = new Slot()
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  beforeEach(() => {
    writeFile.mockReset().mockResolvedValue(undefined)
    registry = new Registry()
    registry.configure([
      editorsExtension,
      savingExtension,
      extra.of(),
      defineRegistryItem({
        providesServices: [
          provideService(fileOperationsService, {
            ...testFileOperations,
            writeFile,
          }),
        ],
      }),
    ])
  })
  afterEach(() => {
    cleanup()
    registry[Symbol.dispose]()
  })
  const open = (src = '/project/notes.txt') =>
    registry.get(editorsService).openEditor(src, 'original')
  const change = (editor: Editor, text: string) =>
    editor.view.dispatch({
      changes: { from: 0, to: editor.view.state.doc.length, insert: text },
    })
  const saving = () => registry.get(editorSaveService)

  it('keeps unnamed buffers dirty and refuses IO until a source is assigned', async () => {
    const editors = registry.get(editorsService)
    const editor = editors.createEditor()
    expect(saving().state(editor).value.dirty).toBe(true)
    expect(await saving().save(editor)).toBeInstanceOf(Error)
    expect(writeFile).not.toHaveBeenCalled()
    editors.setSource(editor.id, '/project/new.txt')
    await saving().save(editor)
    expect(writeFile).toHaveBeenCalledWith('/project/new.txt', '')
    expect(saving().state(editor).value.dirty).toBe(false)
  })

  it('supports save behavior without disk persistence or a fileOperations service', async () => {
    registry.configure([editorsExtension, saveExtension, extra.of()])
    const editor = open()
    change(editor, 'save elsewhere')
    const missing = await saving().save(editor)
    expect(missing).toBeInstanceOf(Error)
    expect(saving().state(editor).value).toMatchObject({
      dirty: true,
      error: missing,
    })
    const commit = vi.fn(async () => undefined)
    await registry.reconfigureAsync(extra, [
      defineRegistryItem({
        provides: [
          provide(editorOnSaveValueSpec, {
            id: 'test.customSave',
            matches: '*',
            onSave: commit,
          }),
        ],
      }),
    ])
    expect(await saving().save(editor)).toBeUndefined()
    expect(commit).toHaveBeenCalledWith({
      editor,
      src: editor.src.peek(),
      contents: 'save elsewhere',
    })
    expect(saving().state(editor).value.dirty).toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('runs matching hooks only after a successful write, using the saved snapshot rather than later typing', async () => {
    const saved = vi.fn()
    const unrelated = vi.fn()
    await registry.reconfigureAsync(extra, [
      defineRegistryItem({
        provides: [
          provide(editorOnSaveValueSpec, {
            id: 'test.saved',
            matches: ({ contents }) => contents === 'to save',
            onSave: saved,
          }),
          provide(editorOnSaveValueSpec, {
            id: 'test.other',
            matches: '.md',
            onSave: unrelated,
          }),
        ],
      }),
    ])
    const editor = open()
    change(editor, 'to save')
    const pending = deferred()
    writeFile.mockReturnValueOnce(pending.promise)
    const result = saving().save(editor)
    await Promise.resolve()
    expect(saved).not.toHaveBeenCalled()
    change(editor, 'typed during save')
    pending.resolve()
    await result
    expect(saved).toHaveBeenCalledWith({
      editor,
      src: editor.src.peek(),
      contents: 'to save',
    })
    expect(unrelated).not.toHaveBeenCalled()
    saved.mockClear()
    change(editor, 'to save')
    writeFile.mockRejectedValueOnce(new Error('Disk unavailable'))
    expect(await saving().save(editor)).toBeInstanceOf(Error)
    expect(saved).not.toHaveBeenCalled()
  })

  it('orders handlers explicitly and stops on failure without completing the save', async () => {
    const other = vi.fn()
    const failure = new Error('Metadata could not be applied')
    await registry.reconfigureAsync(extra, [
      defineRegistryItem({
        provides: [
          provide(editorOnSaveValueSpec, {
            id: 'test.other',
            order: 20,
            matches: '*',
            onSave: other,
          }),
          provide(editorOnSaveValueSpec, {
            id: 'test.failure',
            order: 10,
            matches: '*',
            onSave: () => failure,
          }),
        ],
      }),
    ])
    const editor = open()
    change(editor, 'updated')
    const result = await saving().save(editor)
    expect(result).toBe(failure)
    expect(writeFile).toHaveBeenCalledWith(editor.src.peek(), 'updated')
    expect(other).not.toHaveBeenCalled()
    expect(saving().state(editor).value).toMatchObject({
      dirty: true,
      saving: false,
      error: result,
    })
  })

  it('clears dirty on undo and saves a snapshot while subsequent typing stays dirty', async () => {
    const editor = open()
    const state = saving().state(editor)
    change(editor, 'changed')
    expect(state.value.dirty).toBe(true)
    undo(editor.view)
    expect(state.value.dirty).toBe(false)
    change(editor, 'to save')
    const pending = deferred()
    writeFile.mockReturnValueOnce(pending.promise)
    const save = saving().save(editor)
    await Promise.resolve()
    expect(writeFile).toHaveBeenCalledWith(editor.src.peek(), 'to save')
    change(editor, 'typed during save')
    expect(state.value.saving).toBe(true)
    pending.resolve()
    await save
    expect(state.value).toMatchObject({ dirty: true, saving: false })
    change(editor, 'to save')
    expect(state.value.dirty).toBe(false)
  })

  it('keeps failures dirty and exposes a recoverable error', async () => {
    const editor = open()
    change(editor, 'changed')
    const error = new Error('Disk full')
    writeFile.mockRejectedValueOnce(error)
    expect(await saving().save(editor)).toBe(error)
    expect(saving().state(editor).value).toMatchObject({
      dirty: true,
      saving: false,
      error,
    })
    await saving().save(editor)
    expect(saving().state(editor).value).toEqual({
      dirty: false,
      saving: false,
      error: undefined,
    })
  })

  it('orders saves to one path and updates other buffers against the actual disk baseline', async () => {
    const first = open(),
      second = open()
    change(first, 'first')
    change(second, 'second')
    const pending = deferred()
    writeFile.mockReturnValueOnce(pending.promise)
    const one = saving().save(first),
      two = saving().save(second)
    await Promise.resolve()
    expect(writeFile).toHaveBeenCalledTimes(1)
    pending.resolve()
    await Promise.all([one, two])
    expect(writeFile.mock.calls.map(([, contents]) => contents)).toEqual([
      'first',
      'second',
    ])
    expect(saving().state(first).value.dirty).toBe(true)
    expect(saving().state(second).value.dirty).toBe(false)
  })

  it('skips queued saves for closed or reassociated buffers', async () => {
    const first = open(),
      closed = open(),
      renamed = open()
    const pending = deferred()
    writeFile.mockReturnValueOnce(pending.promise)
    const saves = [first, closed, renamed].map((editor) =>
      saving().save(editor)
    )
    registry.get(editorsService).closeEditor(closed.id)
    registry.get(editorsService).setSource(renamed.id, '/project/other.txt')
    pending.resolve()
    const results = await Promise.all(saves)
    expect(results.slice(1).every((result) => result instanceof Error)).toBe(
      true
    )
    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('stops queued writes when its registry lifetime ends', async () => {
    const first = open(),
      second = open()
    const persistenceService = saving()
    const pending = deferred()
    writeFile.mockReturnValueOnce(pending.promise)
    const one = persistenceService.save(first),
      two = persistenceService.save(second)
    await Promise.resolve()
    registry[Symbol.dispose]()
    pending.resolve()
    await one
    expect(await two).toBeInstanceOf(Error)
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(await persistenceService.save(first)).toBeInstanceOf(Error)
  })

  it('preserves the saved baseline when capabilities change and cleans up on close', async () => {
    const editor = open()
    change(editor, 'changed')
    await registry.reconfigureAsync(extra, [
      defineRegistryItem({
        provides: [
          provide(editorCapabilityValueSpec, {
            id: 'extra',
            matches: '*',
            capabilities: [],
          }),
        ],
      }),
    ])
    expect(saving().state(editor).value.dirty).toBe(true)
    registry.get(editorsService).setSource(editor.id, '/project/renamed.md')
    await saving().save(editor)
    expect(writeFile).toHaveBeenCalledWith('/project/renamed.md', 'changed')
    registry.get(editorsService).closeEditor(editor.id)
    expect(await saving().save(editor)).toBeInstanceOf(Error)
  })

  it('shows contributed indicators independently and saves the focused buffer with the shortcut and command', async () => {
    const first = open(),
      second = open('/project/other.md')
    const indicators = registry.signal(editorTabIndicatorValueSpec)
    const layout = {
      id: 'editors',
      label: 'Editors',
      type: LayoutType.Simple,
      areaType: 'editors',
    } as const
    render(
      <EditorsPane
        editors={registry.get(editorsService)}
        indicators={indicators}
        layout={layout}
      />
    )
    expect(
      screen.queryByRole('img', { name: 'Unsaved changes' })
    ).not.toBeInTheDocument()
    await act(async () => {
      change(first, 'save first')
    })
    expect(screen.getByRole('tab', { name: /notes.txt/ })).toContainElement(
      screen.getByRole('img', { name: 'Unsaved changes' })
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /notes.txt/ }))
      first.view.focus()
      fireEvent.keyDown(first.view.contentDOM, {
        key: 's',
        code: 'KeyS',
        keyCode: 83,
        ctrlKey: !/Mac/.test(navigator.platform),
        metaKey: /Mac/.test(navigator.platform),
      })
    })
    expect(writeFile).toHaveBeenCalledWith(first.src.peek(), 'save first')
    expect(
      screen.queryByRole('img', { name: 'Unsaved changes' })
    ).not.toBeInTheDocument()
    expect(second.view.state.doc.toString()).toBe('original')
    await act(async () => {
      change(first, 'save via command')
      first.view.contentDOM.blur()
      const command = registry
        .get(commandsValueSpec)
        .find(({ id }) => id === SAVE_EDITOR_COMMAND.id)!
      await command.onSubmit?.()
    })
    expect(writeFile).toHaveBeenLastCalledWith(
      first.src.peek(),
      'save via command'
    )
    // A second extension can decorate the same tab without knowing about saving.
    await act(async () => {
      await registry.reconfigureAsync(extra, [
        defineRegistryItem({
          provides: [
            provide(editorTabIndicatorValueSpec, {
              id: 'test.notice',
              component: () => <span title="Independent indicator">!</span>,
            }),
          ],
        }),
      ])
      change(first, 'unsaved again')
    })
    expect(screen.getAllByTitle('Independent indicator')).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Unsaved changes' })).toBeVisible()
  })
})

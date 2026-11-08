import '@src/lib/projectSession/next/testFeature'
import { Registry, Slot, defineRegistryItem, provide } from '@kittycad/registry'
import { useSignals } from '@preact/signals-react/runtime'
import { computed } from '@preact/signals-core'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { EditorView } from '@src/lib/editors/EditorView'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorViewValueSpec,
  type EditorViewHost,
  type Editor,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'

vi.mock('@src/lib/paths', () => ({ PATHS: { INDEX: '/' } }))
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
let registry: Registry
afterEach(() => {
  cleanup()
  registry?.[Symbol.dispose]()
})

it('retains typed mode context across switches and remounts, and releases it when withdrawn or closed', async () => {
  const slot = new Slot()
  const release = vi.fn()
  const bind = vi.fn(({ editor, onDispose }: EditorViewHost) => {
    onDispose(release)
    return { text: computed(() => editor.contents.value.toUpperCase()) }
  })
  const mode = defineEditorView(bind)({
    id: 'preview',
    label: 'Preview',
    matches: '.txt',
    priority: 100,
    Component: ({ context }) => {
      useSignals()
      return <p>{context.text.value}</p>
    },
  })
  const contribution = defineRegistryItem({
    provides: [provide(editorViewValueSpec, mode)],
  })
  registry = new Registry()
  registry.configure([editorsExtension, slot.of(contribution)])
  const editors = registry.get(editorsService)
  const editor = editors.openEditor('/notes.txt', 'original')
  const workspace = render(<EditorView editor={editor} editors={editors} />)
  expect(screen.getByText('ORIGINAL')).toBeVisible()
  act(() => editors.setView(editor.id, 'editors.code'))
  act(() => editor.view.dispatch({ changes: { from: 0, insert: 'edited ' } }))
  act(() => editors.setView(editor.id, 'preview'))
  expect(screen.getByText('EDITED ORIGINAL')).toBeVisible()
  workspace.unmount()
  render(<EditorView editor={editor} editors={editors} />)
  expect(bind).toHaveBeenCalledTimes(1)
  expect(release).not.toHaveBeenCalled()
  act(() => registry.reconfigure(slot, []))
  // Context withdrawal is deferred past any CodeMirror document update.
  await act(async () => {
    await Promise.resolve()
  })
  expect(release).toHaveBeenCalledTimes(1)
  expect(editors.viewState(editor).value.selected?.id).toBe('editors.code')
  act(() => registry.reconfigure(slot, [contribution]))
  editors.setView(editor.id, 'preview')
  expect(bind).toHaveBeenCalledTimes(2)
  act(() => editors.closeEditor(editor.id))
  expect(release).toHaveBeenCalledTimes(2)
})

it('defers content-matched binding until the CodeMirror update completes and releases it when unmatched', async () => {
  const release = vi.fn()
  const bind = vi.fn(({ editor, onDispose }: EditorViewHost) => {
    editor.view.dispatch({ effects: [] })
    onDispose(release)
    return editor.contents
  })
  registry = new Registry()
  registry.configure([
    editorsExtension,
    defineRegistryItem({
      provides: [
        provide(
          editorViewValueSpec,
          defineEditorView(bind)({
            id: 'render',
            label: 'Render',
            matches: ({ contents }) => contents.startsWith('render:'),
            Component: () => null,
          })
        ),
      ],
    }),
  ])
  const editors = registry.get(editorsService)
  const editor = editors.openEditor('/notes.txt', 'plain')
  expect(bind).not.toHaveBeenCalled()
  editor.view.dispatch({ changes: { from: 0, insert: 'render:' } })
  await Promise.resolve()
  expect(bind).toHaveBeenCalledTimes(1)
  expect(editors.viewState(editor).value.binding.type).toBe('ready')
  editor.view.dispatch({ changes: { from: 0, to: 7, insert: '' } })
  await Promise.resolve()
  expect(release).toHaveBeenCalledTimes(1)
})

it('keeps source/content matching and explicit mode choices independent for duplicate sources', async () => {
  const extraViews = new Slot()
  registry = new Registry()
  registry.configure([editorsExtension, extraViews.of()])
  const service = registry.get(editorsService)
  await registry.reconfigureAsync(extraViews, [
    defineRegistryItem({
      provides: [
        provide(
          editorViewValueSpec,
          defineEditorView({
            id: 'test.form',
            label: 'Form',
            matches: ({ src, contents }) =>
              // Just proving that content can be used: you should allow an empty settings file to be valid.
              src.endsWith('project.toml') && contents.startsWith('title'),
            Component: () => null,
          })
        ),
      ],
    }),
  ])
  const first = service.openEditor('/project/project.toml', 'title = "Project"')
  const second = service.openEditor(
    '/project/project.toml',
    'title = "Other buffer"'
  )
  service.setView(first.id, 'editors.code')
  expect(service.viewState(first).value.selected?.id).toBe('editors.code')
  expect(service.viewState(second).value.selected?.id).toBe('test.form')
  service.setSource(second.id, '/project/other.toml')
  expect(service.viewState(second).value.selected?.id).toBe('editors.code')
  service.setSource(second.id, '/project/project.toml')
  expect(service.viewState(second).value.selected?.id).toBe('test.form')
  second.view.dispatch({
    changes: {
      from: 0,
      to: second.view.state.doc.length,
      insert: '# empty settings',
    },
  })
  expect(
    service.viewState(second).value.available.map((view) => view.id)
  ).toEqual(['editors.code'])
  expect(service.viewState(second).value.selected?.id).toBe('editors.code')
  service.setView(second.id, 'test.form')
  expect(service.viewState(second).value.selected?.id).toBe('editors.code')
})

it('rejects recursive editor creation during mode setup', () => {
  registry = new Registry()
  registry.configure([
    editorsExtension,
    defineRegistryItem({
      provides: [
        provide(
          editorViewValueSpec,
          defineEditorView(() => {
            registry.get(editorsService).openEditor('/helper.parent', 'helper')
          })({
            id: 'parent',
            label: 'Parent',
            matches: '.parent',
            Component: () => null,
          })
        ),
      ],
    }),
  ])
  const editors = registry.get(editorsService)
  const parent = editors.openEditor('/main.parent', 'parent')
  expect(
    editors.editors.peek().map((editor) => editor.contents.peek())
  ).toEqual(['parent'])
  const binding = editors.viewState(parent).value.binding
  expect(binding.type).toBe('error')
  if (binding.type === 'error')
    expect(binding.error.message).toContain('during mode setup or cleanup')
})

it('protects other buffers from mode cleanup and continues releasing owned resources', () => {
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  const release = vi.fn()
  registry = new Registry()
  let child: Editor
  registry.configure([
    editorsExtension,
    defineRegistryItem({
      provides: [
        provide(
          editorViewValueSpec,
          defineEditorView(({ onDispose }) => {
            onDispose(release)
            onDispose(() => registry.get(editorsService).closeEditor(child.id))
          })({
            id: 'parent',
            label: 'Parent',
            matches: '.parent',
            Component: () => null,
          })
        ),
      ],
    }),
  ])
  const editors = registry.get(editorsService)
  const parent = editors.openEditor('/main.parent', '')
  child = editors.createEditor()
  const destroy = vi.spyOn(child.view, 'destroy')
  editors.closeEditor(parent.id)
  expect(editors.editors.peek()).toEqual([child])
  expect(destroy).not.toHaveBeenCalled()
  expect(release).toHaveBeenCalledOnce()
  expect(report).toHaveBeenCalled()
  // The setup/cleanup restriction ends with the callback, so user actions still work.
  editors.closeEditor(child.id)
  expect(destroy).toHaveBeenCalledOnce()
  report.mockRestore()
})

it('releases partially initialized mode resources in reverse order and surfaces the failure', () => {
  const released: string[] = []
  registry = new Registry()
  registry.configure([
    editorsExtension,
    defineRegistryItem({
      provides: [
        provide(
          editorViewValueSpec,
          defineEditorView(({ onDispose }) => {
            onDispose(() => released.push('first'))
            onDispose(() => released.push('second'))
            // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- Exercise cleanup when a contributed provider throws.
            throw new Error('Mode initialization failed')
          })({
            id: 'broken',
            label: 'Broken',
            matches: '*',
            Component: () => null,
          })
        ),
      ],
    }),
  ])
  const editors = registry.get(editorsService)
  const editor = editors.createEditor()
  render(<EditorView editor={editor} editors={editors} />)
  expect(screen.getByText('Mode initialization failed')).toBeVisible()
  expect(released).toEqual(['second', 'first'])
  act(() => editors.setView(editor.id, 'editors.code'))
  expect(screen.getByRole('textbox')).toBeVisible()
  act(() => editors.closeEditor(editor.id))
  expect(released).toHaveLength(2)
})

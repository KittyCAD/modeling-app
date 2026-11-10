import '@src/lib/projectSession/next/testFeature'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Registry, Slot, defineRegistryItem, provide } from '@kittycad/registry'
import { beforeAll, afterEach, expect, it, vi } from 'vitest'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorCapabilityValueSpec,
  codeEditorExtensionValueSpec,
  editorViewValueSpec,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
let registry: Registry
const setup = () => {
  registry = new Registry()
  registry.configure([editorsExtension])
  return registry.get(editorsService)
}
afterEach(() => registry?.[Symbol.dispose]())

it('shares edits and document history while preserving each Code surface selection', () => {
  const editors = setup()
  const editor = editors.createEditor('one two')
  const first = editors.createView(editor).codeView.peek()!
  const second = editors.createView(editor).codeView.peek()!
  second.dispatch({ selection: { anchor: 4 } })
  first.dispatch({ selection: { anchor: 0 } })
  first.dispatch({
    changes: { from: 0, insert: 'new ' },
    selection: { anchor: 4 },
  })
  expect(second.state.doc.toString()).toBe('new one two')
  expect(second.state.selection.main.anchor).toBe(8)
  first.dispatch({ selection: { anchor: 2 } })
  expect(second.state.selection.main.anchor).toBe(8)
  expect(editor.undo()).toBe(true)
  expect(first.state.doc.toString()).toBe('one two')
  expect(second.state.doc.toString()).toBe('one two')
  expect(editor.redo()).toBe(true)
  expect(second.state.doc.toString()).toBe('new one two')
})

it('selects modes per presentation and releases the buffer only after its last view closes', () => {
  const releaseDocument = vi.fn()
  registry = new Registry()
  registry.configure([
    editorsExtension,
    defineRegistryItem({
      provides: [
        provide(editorCapabilityValueSpec, {
          id: 'owned-resource',
          matches: '*',
          setup: ({ onDispose }) => onDispose(releaseDocument),
        }),
        provide(
          editorViewValueSpec,
          defineEditorView({
            id: 'preview',
            label: 'Preview',
            matches: '*',
            Component: () => null,
          })
        ),
      ],
    }),
  ])
  const editors = registry.get(editorsService)
  const editor = editors.createEditor()
  const first = editors.createView(editor, 'editors.code')
  const second = editors.createView(editor, 'preview')
  expect(editors.viewState(first).peek().selected?.id).toBe('editors.code')
  expect(editors.viewState(second).peek().selected?.id).toBe('preview')
  const destroy = vi.spyOn(first.codeView.peek()!, 'destroy')
  editors.closeView(first.id)
  expect(destroy).toHaveBeenCalledOnce()
  expect(editor.signal.aborted).toBe(false)
  expect(releaseDocument).not.toHaveBeenCalled()
  editor.dispatch({ changes: { from: 0, insert: 'still open' } })
  editors.closeView(second.id)
  expect(editor.signal.aborted).toBe(true)
  expect(releaseDocument).toHaveBeenCalledOnce()
  expect(editors.editors.peek()).toEqual([])
})

it('preserves Code selection events for argument picking without moving another view selection', () => {
  const picked = vi.fn()
  registry = new Registry()
  registry.configure([
    editorsExtension,
    defineRegistryItem({
      provides: [
        provide(codeEditorExtensionValueSpec, {
          id: 'argument-selection',
          matches: '*',
          extensions: ({ instance }) =>
            EditorView.updateListener.of((update) => {
              if (update.selectionSet)
                picked(instance.id, update.state.selection.main.anchor)
            }),
        }),
      ],
    }),
  ])
  const editors = registry.get(editorsService)
  const editor = editors.createEditor('sketch = circle()')
  const first = editors.createView(editor)
  const second = editors.createView(editor)
  first.codeView.peek()!.dispatch({ selection: { anchor: 11 } })
  expect(picked).toHaveBeenCalledWith(first.id, 11)
  expect(picked).not.toHaveBeenCalledWith(second.id, expect.anything())
  expect(second.codeView.peek()!.state.selection.main.anchor).toBe(0)
})

it('releases Code contribution resources on withdrawal and reacquires them per surface', () => {
  const slot = new Slot()
  const release = vi.fn()
  const contribution = defineRegistryItem({
    provides: [
      provide(codeEditorExtensionValueSpec, {
        id: 'resource',
        matches: '*',
        extensions: ({ onDispose }) => {
          onDispose(release)
          return EditorState.tabSize.of(8)
        },
      }),
    ],
  })
  registry = new Registry()
  registry.configure([editorsExtension, slot.of(contribution)])
  const editors = registry.get(editorsService)
  const editor = editors.createEditor('original')
  const first = editors.createView(editor)
  const second = editors.createView(editor)
  registry.reconfigure(slot, [])
  expect(release).toHaveBeenCalledTimes(2)
  expect(first.codeView.peek()!.state.tabSize).toBe(4)
  expect(editor.signal.aborted).toBe(false)
  registry.reconfigure(slot, [contribution])
  expect(second.codeView.peek()!.state.tabSize).toBe(8)
  editors.closeView(first.id)
  expect(release).toHaveBeenCalledTimes(3)
  expect(second.codeView.peek()!.state.doc.toString()).toBe('original')
  editors.closeView(second.id)
  expect(release).toHaveBeenCalledTimes(4)
})

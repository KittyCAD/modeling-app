import '@src/lib/projectSession/next/testFeature'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import editorsExtension from '@src/lib/editors/registry'
import {
  codeEditorsExtensionFacet,
  editorCapabilityFacet,
  editorsService,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'
import { requireSuccess } from '@src/lib/editors/testViews'
import { defineEditorView } from '@src/lib/editors/views'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import {
  contribute,
  slot as createSlot,
  type InputOf,
  Registry,
} from 'plankton'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})
let registry: Registry
const setup = async () => {
  registry = new Registry()
  await registry.configure([editorsExtension])
  return registry.required(editorsService)
}
afterEach(() => registry?.dispose())
it('shares edits and document history while preserving each Code surface selection', async () => {
  const editors = await setup()
  const editor = requireSuccess(editors.createEditor('one two'))
  const first = requireSuccess(editors.createView(editor)).codeView.peek()!
  const second = requireSuccess(editors.createView(editor)).codeView.peek()!
  second.dispatch({
    selection: {
      anchor: 4,
    },
  })
  first.dispatch({
    selection: {
      anchor: 0,
    },
  })
  first.dispatch({
    changes: {
      from: 0,
      insert: 'new ',
    },
    selection: {
      anchor: 4,
    },
  })
  expect(second.state.doc.toString()).toBe('new one two')
  expect(second.state.selection.main.anchor).toBe(8)
  first.dispatch({
    selection: {
      anchor: 2,
    },
  })
  expect(second.state.selection.main.anchor).toBe(8)
  expect(editor.undo()).toBe(true)
  expect(first.state.doc.toString()).toBe('one two')
  expect(second.state.doc.toString()).toBe('one two')
  expect(editor.redo()).toBe(true)
  expect(second.state.doc.toString()).toBe('new one two')
})
it('selects modes per presentation and releases the buffer only after its last view closes', async () => {
  const releaseDocument = vi.fn()
  registry = new Registry()
  const _editorCapabilityContribution: InputOf<typeof editorCapabilityFacet> = {
    id: 'owned-resource',
    matches: '*',
    setup: ({ onDispose }) => {
      onDispose(releaseDocument)
    },
  } satisfies InputOf<typeof editorCapabilityFacet>
  const _editorViewsContribution: InputOf<typeof editorViewsFacet> =
    defineEditorView({
      id: 'preview',
      label: 'Preview',
      matches: '*',
      Component: () => null,
    })
  await registry.configure([
    editorsExtension,
    [
      contribute(editorCapabilityFacet, () => _editorCapabilityContribution),
      contribute(editorViewsFacet, () => _editorViewsContribution),
    ],
  ])
  const editors = registry.required(editorsService)
  const editor = requireSuccess(editors.createEditor())
  const first = requireSuccess(editors.createView(editor, 'editors.code'))
  const second = requireSuccess(editors.createView(editor, 'preview'))
  expect(editors.viewState(first).peek().selected?.id).toBe('editors.code')
  expect(editors.viewState(second).peek().selected?.id).toBe('preview')
  const destroy = vi.spyOn(first.codeView.peek()!, 'destroy')
  editors.closeView(first.id)
  expect(destroy).toHaveBeenCalledOnce()
  expect(editor.signal.aborted).toBe(false)
  expect(releaseDocument).not.toHaveBeenCalled()
  editor.dispatch({
    changes: {
      from: 0,
      insert: 'still open',
    },
  })
  editors.closeView(second.id)
  expect(editor.signal.aborted).toBe(true)
  expect(releaseDocument).toHaveBeenCalledOnce()
  expect(editors.editors.peek()).toEqual([])
})
it('preserves Code selection events for argument picking without moving another view selection', async () => {
  const picked = vi.fn()
  registry = new Registry()
  const _codeEditorsExtensionContribution: InputOf<
    typeof codeEditorsExtensionFacet
  > = {
    id: 'argument-selection',
    matches: '*',
    extensions: ({ instance }) =>
      EditorView.updateListener.of((update) => {
        if (update.selectionSet)
          picked(instance.id, update.state.selection.main.anchor)
      }),
  } satisfies InputOf<typeof codeEditorsExtensionFacet>
  await registry.configure([
    editorsExtension,
    [
      contribute(
        codeEditorsExtensionFacet,
        () => _codeEditorsExtensionContribution
      ),
    ],
  ])
  const editors = registry.required(editorsService)
  const editor = requireSuccess(editors.createEditor('sketch = circle()'))
  const first = requireSuccess(editors.createView(editor))
  const second = requireSuccess(editors.createView(editor))
  first.codeView.peek()!.dispatch({
    selection: {
      anchor: 11,
    },
  })
  expect(picked).toHaveBeenCalledWith(first.id, 11)
  expect(picked).not.toHaveBeenCalledWith(second.id, expect.anything())
  expect(second.codeView.peek()!.state.selection.main.anchor).toBe(0)
})
it('releases Code contribution resources on withdrawal and reacquires them per surface', async () => {
  const slot = createSlot([], Symbol())
  const release = vi.fn()
  const _codeEditorsExtensionContribution2: InputOf<
    typeof codeEditorsExtensionFacet
  > = {
    id: 'resource',
    matches: '*',
    extensions: ({ onDispose }) => {
      onDispose(release)
      return EditorState.tabSize.of(8)
    },
  } satisfies InputOf<typeof codeEditorsExtensionFacet>
  const contribution = [
    contribute(
      codeEditorsExtensionFacet,
      () => _codeEditorsExtensionContribution2
    ),
  ]
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    {
      ...slot,
      create: () => ({
        items: [contribution],
      }),
    },
  ])
  const editors = registry.required(editorsService)
  const editor = requireSuccess(editors.createEditor('original'))
  const first = requireSuccess(editors.createView(editor))
  const second = requireSuccess(editors.createView(editor))
  await registry.replace(slot, [])
  expect(release).toHaveBeenCalledTimes(2)
  expect(first.codeView.peek()!.state.tabSize).toBe(4)
  expect(editor.signal.aborted).toBe(false)
  await registry.replace(slot, [contribution])
  expect(second.codeView.peek()!.state.tabSize).toBe(8)
  editors.closeView(first.id)
  expect(release).toHaveBeenCalledTimes(3)
  expect(second.codeView.peek()!.state.doc.toString()).toBe('original')
  editors.closeView(second.id)
  expect(release).toHaveBeenCalledTimes(4)
})
it('retains multiple cursor positions in document undo history', async () => {
  const editors = await setup()
  const editor = requireSuccess(editors.createEditor('abcd'))
  const view = requireSuccess(editors.createView(editor)).codeView.peek()!
  view.dispatch({
    selection: EditorSelection.create([
      EditorSelection.cursor(1),
      EditorSelection.cursor(3),
    ]),
  })
  view.dispatch(view.state.replaceSelection('X'))
  expect(editor.contents.peek()).toBe('aXbcXd')
  expect(editor.undo()).toBe(true)
  expect(editor.contents.peek()).toBe('abcd')
  expect(editor.state.selection.ranges.map((range) => range.anchor)).toEqual([
    1, 3,
  ])
})
it.each(['return', 'throw'] as const)(
  'keeps Code usable when a newly matching extension factory fails by %s',
  async (failureMode) => {
    const failure = new Error('Code extension failed')
    const release = vi.fn()
    const releaseHealthy = vi.fn()
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      registry = new Registry()
      const _codeEditorsExtensionContribution3: InputOf<
        typeof codeEditorsExtensionFacet
      > = {
        id: 'broken',
        matches: ({ contents }) => contents.startsWith('activate'),
        extensions: ({ onDispose }) => {
          onDispose(release)
          if (failureMode === 'throw') throw failure
          return failure
        },
      } satisfies InputOf<typeof codeEditorsExtensionFacet>
      const _codeEditorsExtensionContribution4: InputOf<
        typeof codeEditorsExtensionFacet
      > = {
        id: 'healthy',
        matches: ({ contents }) => contents.startsWith('activate'),
        extensions: ({ onDispose }) => {
          onDispose(releaseHealthy)
          return EditorState.tabSize.of(8)
        },
      } satisfies InputOf<typeof codeEditorsExtensionFacet>
      await registry.configure([
        editorsExtension,
        [
          contribute(
            codeEditorsExtensionFacet,
            () => _codeEditorsExtensionContribution3
          ),
          contribute(
            codeEditorsExtensionFacet,
            () => _codeEditorsExtensionContribution4
          ),
        ],
      ])
      const editors = registry.required(editorsService)
      const editor = requireSuccess(editors.createEditor())
      const view = requireSuccess(editors.createView(editor)).codeView.peek()!
      // Exercise reconfiguration queued during an actual CodeMirror update.
      view.dispatch({
        changes: {
          from: 0,
          insert: 'activate',
        },
      })
      await Promise.resolve()
      expect(view.state.doc.toString()).toBe('activate')
      expect(view.state.tabSize).toBe(8)
      expect(release).toHaveBeenCalledOnce()
      expect(report).toHaveBeenCalledWith(failure)
      view.dispatch({
        changes: {
          from: 8,
          insert: ' again',
        },
      })
      await Promise.resolve()
      expect(report).toHaveBeenCalledTimes(1)
      editors.closeEditor(editor.id)
      expect(release).toHaveBeenCalledOnce()
      expect(releaseHealthy).toHaveBeenCalledOnce()
    } finally {
      report.mockRestore()
    }
  }
)

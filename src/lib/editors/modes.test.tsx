import '@src/lib/projectSession/next/testFeature'
import { computed } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { EditorView } from '@src/lib/editors/EditorView'
import editorsExtension from '@src/lib/editors/registry'
import {
  type Editor,
  type EditorViewHost,
  editorsService,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'
import {
  codeSurface,
  presentation,
  requireSuccess,
} from '@src/lib/editors/testViews'
import { defineEditorView } from '@src/lib/editors/views'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { act, cleanup, render, screen } from '@testing-library/react'
import {
  extension as defineExtension,
  contribute,
  slot as createSlot,
  Registry,
  type InputOf,
} from 'plankton'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
vi.mock('@src/lib/paths', () => ({
  PATHS: {
    INDEX: '/',
  },
}))
beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})
let registry: Registry
afterEach(async () => {
  cleanup()
  await registry?.dispose()
})
it('retains typed mode context across switches and remounts, and releases it when withdrawn or closed', async () => {
  const slot = createSlot([], Symbol())
  const release = vi.fn()
  const bind = vi.fn(({ editor, onDispose }: EditorViewHost) => {
    onDispose(release)
    return {
      text: computed(() => editor.contents.value.toUpperCase()),
    }
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
  const contribution = [contribute(editorViewsFacet, () => mode)]
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    defineExtension({
      ...slot,
      create: () => ({
        items: [contribution],
      }),
    }),
  ])
  const editors = registry.required(editorsService)
  const editor = requireSuccess(editors.openEditor('/notes.txt', 'original'))
  const workspace = render(
    <EditorView instance={presentation(editors, editor)} editors={editors} />
  )
  expect(screen.getByText('ORIGINAL')).toBeVisible()
  act(() => {
    requireSuccess(
      editors.setView(presentation(editors, editor).id, 'editors.code')
    )
  })
  act(() =>
    editor.dispatch({
      changes: {
        from: 0,
        insert: 'edited ',
      },
    })
  )
  act(() => {
    requireSuccess(editors.setView(presentation(editors, editor).id, 'preview'))
  })
  expect(screen.getByText('EDITED ORIGINAL')).toBeVisible()
  workspace.unmount()
  render(
    <EditorView instance={presentation(editors, editor)} editors={editors} />
  )
  expect(bind).toHaveBeenCalledTimes(1)
  expect(release).not.toHaveBeenCalled()
  await act(async () => await registry.replace(slot, []))
  // Context withdrawal is deferred past any CodeMirror document update.
  await act(async () => {
    await Promise.resolve()
  })
  expect(release).toHaveBeenCalledTimes(1)
  expect(
    editors.viewState(presentation(registry.required(editorsService), editor))
      .value.selected?.id
  ).toBe('editors.code')
  await act(async () => await registry.replace(slot, [contribution]))
  editors.setView(presentation(editors, editor).id, 'preview')
  expect(bind).toHaveBeenCalledTimes(2)
  act(() => {
    requireSuccess(editors.closeEditor(editor.id))
  })
  expect(release).toHaveBeenCalledTimes(2)
})
it('defers content-matched binding until the CodeMirror update completes and releases it when unmatched', async () => {
  const release = vi.fn()
  const bind = vi.fn(({ editor, onDispose }: EditorViewHost) => {
    editor.dispatch({
      effects: [],
    })
    onDispose(release)
    return editor.contents
  })
  registry = new Registry()
  const _editorViewsContribution: InputOf<typeof editorViewsFacet> =
    defineEditorView(bind)({
      id: 'render',
      label: 'Render',
      matches: ({ contents }) => contents.startsWith('render:'),
      Component: () => null,
    })
  await registry.configure([
    editorsExtension,
    [contribute(editorViewsFacet, () => _editorViewsContribution)],
  ])
  const editors = registry.required(editorsService)
  const editor = requireSuccess(editors.openEditor('/notes.txt', 'plain'))
  editors.createView(editor)
  expect(bind).not.toHaveBeenCalled()
  editor.dispatch({
    changes: {
      from: 0,
      insert: 'render:',
    },
  })
  await Promise.resolve()
  expect(bind).toHaveBeenCalledTimes(1)
  expect(
    editors.viewState(presentation(registry.required(editorsService), editor))
      .value.binding.type
  ).toBe('ready')
  editor.dispatch({
    changes: {
      from: 0,
      to: 7,
      insert: '',
    },
  })
  await Promise.resolve()
  expect(release).toHaveBeenCalledTimes(1)
})
it('keeps source/content matching and explicit mode choices independent for duplicate sources', async () => {
  const extraViews = createSlot([], Symbol())
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    defineExtension({
      ...extraViews,
      create: () => ({
        items: [],
      }),
    }),
  ])
  const service = registry.required(editorsService)
  const _editorViewsContribution2: InputOf<typeof editorViewsFacet> =
    defineEditorView({
      id: 'test.form',
      label: 'Form',
      matches: ({ src, contents }) =>
        // Just proving that content can be used: you should allow an empty settings file to be valid.
        src.endsWith('project.toml') && contents.startsWith('title'),
      Component: () => null,
    })
  await registry.replace(extraViews, [
    [contribute(editorViewsFacet, () => _editorViewsContribution2)],
  ])
  const first = requireSuccess(
    service.openEditor('/project/project.toml', 'title = "Project"')
  )
  const second = requireSuccess(
    service.openEditor('/project/project.toml', 'title = "Other buffer"')
  )
  service.setView(presentation(service, first).id, 'editors.code')
  expect(
    service.viewState(presentation(registry.required(editorsService), first))
      .value.selected?.id
  ).toBe('editors.code')
  expect(
    service.viewState(presentation(registry.required(editorsService), second))
      .value.selected?.id
  ).toBe('test.form')
  service.setSource(second.id, '/project/other.toml')
  expect(
    service.viewState(presentation(registry.required(editorsService), second))
      .value.selected?.id
  ).toBe('editors.code')
  service.setSource(second.id, '/project/project.toml')
  expect(
    service.viewState(presentation(registry.required(editorsService), second))
      .value.selected?.id
  ).toBe('test.form')
  second.dispatch({
    changes: {
      from: 0,
      to: codeSurface(registry.required(editorsService), second).state.doc
        .length,
      insert: '# empty settings',
    },
  })
  expect(
    service
      .viewState(presentation(registry.required(editorsService), second))
      .value.available.map((view) => view.id)
  ).toEqual(['editors.code'])
  expect(
    service.viewState(presentation(registry.required(editorsService), second))
      .value.selected?.id
  ).toBe('editors.code')
  service.setView(presentation(service, second).id, 'test.form')
  expect(
    service.viewState(presentation(registry.required(editorsService), second))
      .value.selected?.id
  ).toBe('editors.code')
})
it('rejects recursive editor creation during mode setup', async () => {
  registry = new Registry()
  const _editorViewsContribution3: InputOf<typeof editorViewsFacet> =
    defineEditorView(() => {
      return registry
        .required(editorsService)
        .openEditor('/helper.parent', 'helper')
    })({
      id: 'parent',
      label: 'Parent',
      matches: '.parent',
      Component: () => null,
    })
  await registry.configure([
    editorsExtension,
    [contribute(editorViewsFacet, () => _editorViewsContribution3)],
  ])
  const editors = registry.required(editorsService)
  const parent = requireSuccess(editors.openEditor('/main.parent', 'parent'))
  presentation(editors, parent)
  expect(
    editors.editors.peek().map((editor) => editor.contents.peek())
  ).toEqual(['parent'])
  const binding = editors.viewState(
    presentation(registry.required(editorsService), parent)
  ).value.binding
  expect(binding.type).toBe('error')
  if (binding.type === 'error')
    expect(binding.error.message).toContain('during mode setup or cleanup')
})
it('protects other buffers from mode cleanup and continues releasing owned resources', async () => {
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  const release = vi.fn()
  registry = new Registry()
  let child: Editor
  const _editorViewsContribution4: InputOf<typeof editorViewsFacet> =
    defineEditorView(({ onDispose }) => {
      onDispose(release)
      onDispose(() => registry.required(editorsService).closeEditor(child.id))
    })({
      id: 'parent',
      label: 'Parent',
      matches: '.parent',
      Component: () => null,
    })
  await registry.configure([
    editorsExtension,
    [contribute(editorViewsFacet, () => _editorViewsContribution4)],
  ])
  const editors = registry.required(editorsService)
  const parent = requireSuccess(editors.openEditor('/main.parent', ''))
  presentation(editors, parent)
  child = requireSuccess(editors.createEditor())
  const destroy = vi.spyOn(
    codeSurface(registry.required(editorsService), child),
    'destroy'
  )
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
it.each(['return', 'throw'] as const)(
  'releases partial mode resources when its provider fails by %s',
  async (failureMode) => {
    const released: string[] = []
    registry = new Registry()
    const _editorViewsContribution5: InputOf<typeof editorViewsFacet> =
      defineEditorView(({ onDispose }) => {
        onDispose(() => released.push('first'))
        onDispose(() => released.push('second'))
        const failure = new Error('Mode initialization failed')
        if (failureMode === 'throw') throw failure
        return failure
      })({
        id: 'broken',
        label: 'Broken',
        matches: '*',
        Component: () => null,
      })
    await registry.configure([
      editorsExtension,
      [contribute(editorViewsFacet, () => _editorViewsContribution5)],
    ])
    const editors = registry.required(editorsService)
    const editor = requireSuccess(editors.createEditor())
    render(
      <EditorView instance={presentation(editors, editor)} editors={editors} />
    )
    expect(screen.getByText('Mode initialization failed')).toBeVisible()
    expect(released).toEqual(['second', 'first'])
    act(() => {
      requireSuccess(
        editors.setView(presentation(editors, editor).id, 'editors.code')
      )
    })
    expect(screen.getByRole('textbox')).toBeVisible()
    act(() => {
      requireSuccess(editors.closeEditor(editor.id))
    })
    expect(released).toHaveLength(2)
  }
)

import '@src/lib/projectSession/next/testFeature'
import { language } from '@codemirror/language'
import { Registry } from '@kittycad/registry'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { EditorView } from '@src/lib/editors/EditorView'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { codeSurface } from '@src/lib/editors/testViews'
import executorsExtension from '@src/lib/executors/registry'
import { executorsService } from '@src/lib/executors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { PYORIGAMI_DOCUMENT } from '@src/lib/pyorigami/document'
import { pyorigamiExecutorCapability } from '@src/lib/pyorigami/executor'
import { pyorigamiExtension } from '@src/lib/pyorigami/registry'
import {
  PYORIGAMI_CANCEL_CHANNEL,
  PYORIGAMI_RENDER_CHANNEL,
  PYORIGAMI_AUTHOR_CHANNEL,
} from '@src/registry/plugins/pyorigami/ipc'
import type { PluginIpcChannel } from '@src/registry/pluginIpc'
import { pyorigamiAuthoringService } from '@src/lib/pyorigami/authoring'
import { keymapEventOwnersValueSpec } from '@src/registry/contracts/keymap'
import { isRecord } from '@src/lib/utils'

const originalElectron = Object.getOwnPropertyDescriptor(window, 'electron')
const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
const invoke =
  vi.fn<(channel: PluginIpcChannel, request?: unknown) => Promise<unknown>>()
const createUrl = vi.fn<(blob: Blob) => string>()
const revokeUrl = vi.fn()
let registry: Registry

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
beforeEach(() => {
  invoke
    .mockReset()
    .mockImplementation(async (channel) =>
      channel === PYORIGAMI_RENDER_CHANNEL
        ? { ok: true, pages: ['<svg/>', '<svg><path/></svg>'] }
        : undefined
    )
  createUrl
    .mockReset()
    .mockImplementation(() => `blob:diagram-${createUrl.mock.calls.length}`)
  revokeUrl.mockReset()
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { pluginIpc: { invoke } },
  })
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createUrl,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeUrl,
  })
  registry = new Registry()
  registry.configure([editorsExtension, executorsExtension, pyorigamiExtension])
})
afterEach(() => {
  cleanup()
  registry[Symbol.dispose]()
  for (const [target, key, descriptor] of [
    [window, 'electron', originalElectron],
    [URL, 'createObjectURL', originalCreate],
    [URL, 'revokeObjectURL', originalRevoke],
  ] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor)
    else Reflect.deleteProperty(target, key)
  }
})

it('recognizes origami Python files and unnamed origami documents without executing ordinary Python', async () => {
  const editors = registry.get(editorsService)
  const files = [
    editors.openEditor('/fold.ORIGAMI.PY', 'diagram = make_diagram()'),
    editors.createEditor('diagram = another_diagram()', {
      documentType: PYORIGAMI_DOCUMENT,
    }),
  ]
  const ordinary = editors.openEditor('/script.py', 'print("hello")')
  const executors = registry.get(executorsService)
  for (const editor of [...files, ordinary]) executors.acquireExecutor(editor)
  for (const editor of files) {
    expect(codeSurface(editors, editor).state.facet(language)?.name).toBe(
      'python'
    )
  }
  await vi.waitFor(() =>
    expect(
      invoke.mock.calls.filter(
        ([channel]) => channel === PYORIGAMI_RENDER_CHANNEL
      )
    ).toHaveLength(2)
  )
  expect(invoke).not.toHaveBeenCalledWith(
    PYORIGAMI_RENDER_CHANNEL,
    expect.objectContaining({ src: '/script.py' })
  )
})

it('displays every SVG page and releases the old page URL when navigating', async () => {
  const editors = registry.get(editorsService)
  const editor = editors.openEditor(
    '/fold.origami.py',
    'diagram = make_diagram()'
  )
  const instance = editors.createView(editor, 'pyorigami.diagram')
  const mounted = render(<EditorView instance={instance} editors={editors} />)
  const first = await screen.findByRole('img', {
    name: 'Origami diagram, page 1',
  })
  const firstUrl = first.getAttribute('src')
  expect(createUrl.mock.calls[0][0].type).toBe('image/svg+xml')
  fireEvent.change(screen.getByRole('combobox', { name: 'Diagram page' }), {
    target: { value: '1' },
  })
  expect(
    await screen.findByRole('img', { name: 'Origami diagram, page 2' })
  ).toBeVisible()
  expect(revokeUrl).toHaveBeenCalledWith(firstUrl)
  const secondUrl = createUrl.mock.results.at(-1)?.value
  mounted.unmount()
  expect(revokeUrl).toHaveBeenCalledWith(secondUrl)
})

it('cancels an obsolete snapshot and keeps the newer output when the old run finishes late', async () => {
  const old = Promise.withResolvers<unknown>()
  invoke.mockImplementationOnce(() => old.promise)
  const editors = registry.get(editorsService)
  const editor = editors.openEditor('/fold.origami.py', 'old program')
  const executor = registry
    .get(executorsService)
    .acquireExecutor(editor).executor
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      PYORIGAMI_RENDER_CHANNEL,
      expect.objectContaining({ contents: 'old program' })
    )
  )
  const first = invoke.mock.calls[0][1]
  act(() =>
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.contents.peek().length,
        insert: 'new program',
      },
    })
  )
  await vi.waitFor(() =>
    expect(executor.output.value.contents).toBe('new program')
  )
  await vi.waitFor(() => expect(executor.output.value.running).toBe(false))
  expect(invoke).toHaveBeenCalledWith(
    PYORIGAMI_CANCEL_CHANNEL,
    expect.objectContaining({ runId: expect.any(String) })
  )
  expect(
    invoke.mock.calls.find(
      ([channel]) => channel === PYORIGAMI_CANCEL_CHANNEL
    )?.[1]
  ).toEqual(
    expect.objectContaining({
      runId:
        first && typeof first === 'object' && 'runId' in first
          ? first.runId
          : undefined,
    })
  )
  await act(async () => old.resolve({ ok: true, pages: ['obsolete'] }))
  expect(
    executor.output.value.get(pyorigamiExecutorCapability)?.pages
  ).not.toContain('obsolete')
})

it('shows Python errors and recovers after editing the document', async () => {
  invoke.mockResolvedValueOnce({
    ok: false,
    error: 'NameError: unknown corner',
  })
  const editors = registry.get(editorsService)
  const editor = editors.openEditor('/fold.origami.py', 'broken program')
  render(
    <EditorView
      instance={editors.createView(editor, 'pyorigami.diagram')}
      editors={editors}
    />
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'NameError: unknown corner'
  )
  act(() =>
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.contents.peek().length,
        insert: 'fixed program',
      },
    })
  )
  expect(
    await screen.findByRole('img', { name: 'Origami diagram, page 1' })
  ).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('applies imports and commands together as an isolated undo operation', async () => {
  const editor = registry.get(editorsService).createEditor('original')
  editor.dispatch({ changes: { from: 8, insert: '\n# manual change' } })
  const before = editor.contents.peek()
  const transformed =
    'from pyorigami import Title\n' + before + '\nTitle("New title")'
  invoke.mockResolvedValueOnce({ ok: true, contents: transformed })
  const changes = vi.fn()
  editor.subscribe((transaction) => {
    if (transaction.docChanged) changes()
  })
  expect(
    await registry
      .get(pyorigamiAuthoringService)
      .apply(
        editor,
        before,
        { kind: 'property', property: 'title', value: 'New title' },
        new AbortController().signal
      )
  ).toBeUndefined()
  expect(changes).toHaveBeenCalledOnce()
  expect(editor.contents.peek()).toBe(transformed)
  editor.undo()
  expect(editor.contents.peek()).toBe(before)
  editor.undo()
  expect(editor.contents.peek()).toBe('original')
  editor.redo()
  editor.redo()
  expect(editor.contents.peek()).toBe(transformed)
})

it('rejects an authoring reply after Code edits even when undo restores the same text', async () => {
  const editor = registry.get(editorsService).createEditor('original')
  const pending = Promise.withResolvers<unknown>()
  invoke.mockReturnValueOnce(pending.promise)
  const applying = registry
    .get(pyorigamiAuthoringService)
    .apply(
      editor,
      'original',
      { kind: 'addStep' },
      new AbortController().signal
    )
  editor.dispatch({ changes: { from: 0, insert: 'manual ' } })
  editor.undo()
  pending.resolve({ ok: true, contents: 'obsolete rewrite' })
  expect(await applying).toBeInstanceOf(Error)
  expect(editor.contents.peek()).toBe('original')
})

it('cancels authoring when its view closes without changing the document', async () => {
  const editor = registry.get(editorsService).createEditor('original')
  const controller = new AbortController()
  const pending = Promise.withResolvers<unknown>()
  invoke.mockReturnValueOnce(pending.promise)
  const applying = registry
    .get(pyorigamiAuthoringService)
    .apply(editor, 'original', { kind: 'addStep' }, controller.signal)
  controller.abort()
  pending.resolve({ ok: true, contents: 'late rewrite' })
  expect(await applying).toBeInstanceOf(Error)
  expect(editor.contents.peek()).toBe('original')
  expect(invoke).toHaveBeenCalledWith(
    PYORIGAMI_CANCEL_CHANNEL,
    expect.objectContaining({ runId: expect.any(String) })
  )
})

it.each(['metaKey', 'ctrlKey'])(
  'edits an output field and routes %s undo and redo to its document',
  async (modifier) => {
    invoke.mockImplementation(async (channel) =>
      channel === PYORIGAMI_AUTHOR_CHANNEL
        ? { ok: true, contents: 'updated title with import' }
        : {
            ok: true,
            pages: ['<svg/>'],
            authoring: {
              canAddStep: true,
              fields: [
                {
                  page: 0,
                  target: { kind: 'property', property: 'title' },
                  value: 'Original title',
                  editable: true,
                  x: 0.1,
                  y: 0.1,
                  width: 0.8,
                  height: 0.1,
                },
              ],
            },
          }
    )
    const editors = registry.get(editorsService)
    const editor = editors.openEditor('/fold.origami.py', 'original')
    render(
      <EditorView
        instance={editors.createView(editor, 'pyorigami.diagram')}
        editors={editors}
      />
    )
    fireEvent.focus(await screen.findByRole('button', { name: 'Title' }))
    const input = screen.getByRole('textbox', { name: 'Title' })
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: 'New title' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() =>
      expect(editor.contents.peek()).toBe('updated title with import')
    )
    expect(invoke).toHaveBeenCalledWith(
      PYORIGAMI_AUTHOR_CHANNEL,
      expect.objectContaining({
        operation: { kind: 'property', property: 'title', value: 'New title' },
      })
    )
    const preview = screen.getByRole('region', { name: 'pyOrigami preview' })
    expect(preview).toHaveFocus()
    const legacyUndo = vi.fn()
    const owners = registry.get(keymapEventOwnersValueSpec)
    const globalHandler = (event: KeyboardEvent) => {
      if (!owners.some((owner) => owner.owns(event))) legacyUndo()
    }
    document.addEventListener('keydown', globalHandler, true)
    try {
      fireEvent.keyDown(preview, { key: 'z', [modifier]: true })
      expect(editor.contents.peek()).toBe('original')
      fireEvent.keyDown(preview, { key: 'z', shiftKey: true, [modifier]: true })
      expect(editor.contents.peek()).toBe('updated title with import')
      fireEvent.keyDown(preview, { key: 'z', [modifier]: true })
      fireEvent.keyDown(preview, { key: 'y', [modifier]: true })
      expect(editor.contents.peek()).toBe('updated title with import')
      expect(legacyUndo).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', globalHandler, true)
    }
  }
)

it('keeps the next field draft focused across a new SVG and commits it after the preceding edit', async () => {
  const firstEdit = Promise.withResolvers<unknown>()
  invoke.mockImplementation(async (channel, request) => {
    if (channel === PYORIGAMI_AUTHOR_CHANNEL) {
      if (isRecord(request) && request.contents === 'original')
        return firstEdit.promise
      return { ok: true, contents: 'after designer' }
    }
    const source =
      isRecord(request) && typeof request.contents === 'string'
        ? request.contents
        : ''
    return {
      ok: true,
      pages: [`<svg><title>${source}</title></svg>`],
      authoring: {
        canAddStep: true,
        fields: [
          {
            page: 0,
            target: { kind: 'property', property: 'title' },
            value: source === 'original' ? 'Original' : 'New title',
            editable: true,
            x: 0.1,
            y: 0.1,
            width: 0.8,
            height: 0.1,
          },
          {
            page: 0,
            target: { kind: 'property', property: 'designer' },
            value: '',
            editable: true,
            x: 0.1,
            y: 0.3,
            width: 0.8,
            height: 0.1,
          },
        ],
      },
    }
  })
  const editors = registry.get(editorsService)
  const editor = editors.openEditor('/fold.origami.py', 'original')
  render(
    <EditorView
      instance={editors.createView(editor, 'pyorigami.diagram')}
      editors={editors}
    />
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Title' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'New title' },
  })
  act(() => screen.getByRole('button', { name: 'Designer' }).focus())
  fireEvent.change(screen.getByRole('textbox', { name: 'Designer' }), {
    target: { value: 'Draft in progress' },
  })
  await act(async () =>
    firstEdit.resolve({ ok: true, contents: 'after title' })
  )
  await vi.waitFor(() => expect(createUrl.mock.calls.length).toBeGreaterThan(1))
  const designer = screen.getByRole('textbox', { name: 'Designer' })
  expect(designer).toHaveFocus()
  expect(designer).toHaveValue('Draft in progress')
  fireEvent.keyDown(designer, { key: 'Enter' })
  await vi.waitFor(() => expect(editor.contents.peek()).toBe('after designer'))
  expect(invoke).toHaveBeenCalledWith(
    PYORIGAMI_AUTHOR_CHANNEL,
    expect.objectContaining({
      contents: 'after title',
      operation: {
        kind: 'property',
        property: 'designer',
        value: 'Draft in progress',
      },
    })
  )
})

it('undo cancels a pending Add step rather than applying its late reply', async () => {
  const pending = Promise.withResolvers<unknown>()
  invoke.mockImplementation(async (channel) =>
    channel === PYORIGAMI_AUTHOR_CHANNEL
      ? pending.promise
      : {
          ok: true,
          pages: ['<svg/>'],
          authoring: { fields: [], canAddStep: true },
        }
  )
  const editors = registry.get(editorsService)
  const editor = editors.openEditor('/fold.origami.py', 'original')
  render(
    <EditorView
      instance={editors.createView(editor, 'pyorigami.diagram')}
      editors={editors}
    />
  )
  fireEvent.click(await screen.findByRole('button', { name: '+ Add step' }))
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      PYORIGAMI_AUTHOR_CHANNEL,
      expect.objectContaining({ operation: { kind: 'addStep' } })
    )
  )
  fireEvent.keyDown(screen.getByRole('region', { name: 'pyOrigami preview' }), {
    key: 'z',
    metaKey: true,
  })
  await act(async () =>
    pending.resolve({ ok: true, contents: 'late new step' })
  )
  expect(editor.contents.peek()).toBe('original')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(invoke).toHaveBeenCalledWith(
    PYORIGAMI_CANCEL_CHANNEL,
    expect.objectContaining({ runId: expect.any(String) })
  )
})

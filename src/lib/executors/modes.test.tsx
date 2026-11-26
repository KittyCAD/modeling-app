import '@src/lib/projectSession/next/testFeature'
import { requireSuccess, presentation } from '@src/lib/editors/testViews'
import { contribute, Registry, slot } from 'plankton'
import { useSignals } from '@preact/signals-react/runtime'
import { EditorView } from '@src/lib/editors/EditorView'
import type { EditorMatcher } from '@src/lib/editors/matching'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorCapabilityFacet,
  editorViewsFacet,
  type EditorViewContribution,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { executionContext } from '@src/lib/executors/context'
import executorsExtension from '@src/lib/executors/registry'
import {
  defineExecutorCapability,
  executorCapabilityFacet,
  executorsService,
} from '@src/lib/executors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@src/lib/paths', () => ({ PATHS: { INDEX: '/' } }))
let registry: Registry
const modes = slot([])
const definitions = new Map<string, EditorViewContribution>()
const execute = vi.fn((contents: string) => ({ text: contents }))
const capability = defineExecutorCapability({
  id: 'preview',
  matches: '*',
  execute,
})
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
beforeEach(async () => {
  execute.mockClear()
  definitions.clear()
  registry = new Registry()
  await registry.configure([editorsExtension, executorsExtension, modes])
})
afterEach(async () => {
  cleanup()
  await registry.dispose()
})
async function installModes(
  names = ['modeling', 'drawings'],
  matches: EditorMatcher = '.kcl'
) {
  await registry.replace(modes, [
    [
      contribute(executorCapabilityFacet, () => capability),
      ...names.map((name) =>
        contribute(
          editorViewsFacet,
          () =>
            definitions.get(name) ??
            (() => {
              const definition = defineEditorView(
                executionContext(
                  capability,
                  () => registry.required(executorsService),
                  () => true
                )
              )({
                id: name,
                label: name,
                matches,
                priority: name === 'modeling' ? 1000 : 0,
                Component: ({ context }) => {
                  useSignals()
                  return (
                    <p>
                      {name}: {context.result.value.data?.text ?? 'running'}
                    </p>
                  )
                },
              })
              definitions.set(name, definition)
              return definition
            })()
        )
      ),
    ],
  ])
}

it('retains its executor across mode switches and presentation remounts', async () => {
  await installModes()
  const editors = registry.required(editorsService),
    executors = registry.required(executorsService)
  const editor = requireSuccess(editors.openEditor('/main.kcl', 'original'))
  presentation(editors, editor)
  const first = render(
    <EditorView instance={presentation(editors, editor)} editors={editors} />
  )
  expect(await screen.findByText('modeling: original')).toBeVisible()
  const executor = executors.executors.value[0]
  await act(() =>
    editors.setView(presentation(editors, editor).id, 'editors.code')
  )
  expect(screen.getByRole('textbox')).toBeVisible()
  await act(async () =>
    editor.dispatch({ changes: { from: 0, insert: 'edited ' } })
  )
  await act(() => editors.setView(presentation(editors, editor).id, 'drawings'))
  expect(await screen.findByText('drawings: edited original')).toBeVisible()
  expect(executors.executors.value).toEqual([executor])
  first.unmount()
  expect(executors.executors.value).toEqual([executor])
  render(
    <EditorView instance={presentation(editors, editor)} editors={editors} />
  )
  expect(screen.getByText('drawings: edited original')).toBeVisible()
  await act(() => editors.closeEditor(editor.id))
  expect(executors.executors.value).toEqual([])
})

it('keeps separate editor instances independent and releases withdrawn mode contexts', async () => {
  await installModes()
  const editors = registry.required(editorsService),
    executors = registry.required(executorsService)
  const first = requireSuccess(editors.openEditor('/main.kcl', 'first'))
  presentation(editors, first)
  const second = requireSuccess(editors.openEditor('/main.kcl', 'second'))
  presentation(editors, second)
  expect(executors.executors.value).toHaveLength(2)
  editors.setView(presentation(editors, first).id, 'drawings')
  const retained = executors.executors.value[0]
  await installModes(['drawings'])
  await Promise.resolve()
  expect(executors.executors.value).toContain(retained)
  expect(
    editors.viewState(presentation(editors, second)).value.selected?.id
  ).toBe('drawings')
  await installModes([])
  await Promise.resolve()
  expect(
    editors.viewState(presentation(editors, first)).value.selected?.id
  ).toBe('editors.code')
  expect(executors.executors.value).toEqual([])
})

it('binds content-matched contexts after CodeMirror updates and releases them when the buffer stops matching', async () => {
  await installModes(['modeling'], ({ contents }) =>
    contents.startsWith('render:')
  )
  const editors = registry.required(editorsService),
    executors = registry.required(executorsService)
  const editor = requireSuccess(editors.openEditor('/notes.txt', 'plain'))
  presentation(editors, editor)
  expect(executors.executors.value).toEqual([])
  editor.dispatch({ changes: { from: 0, insert: 'render:' } })
  await Promise.resolve()
  expect(
    editors.viewState(presentation(editors, editor)).value.selected?.id
  ).toBe('modeling')
  expect(executors.executors.value).toHaveLength(1)
  editor.dispatch({ changes: { from: 0, to: 7, insert: '' } })
  await Promise.resolve()
  expect(executors.executors.value).toEqual([])
})

it('updates a parallel preview while document capabilities remain acquired', async () => {
  const acquire = vi.fn()
  const release = vi.fn()
  await registry.configure([
    editorsExtension,
    executorsExtension,
    modes,
    [
      contribute(editorCapabilityFacet, () => ({
        id: 'document-behavior',
        matches: '*' as const,
        setup: ({ onDispose }) => {
          acquire()
          onDispose(release)
          return undefined
        },
      })),
    ],
  ])
  await installModes()
  const editors = registry.required(editorsService)
  const editor = requireSuccess(editors.openEditor('/main.kcl', 'original'))
  const code = requireSuccess(editors.createView(editor, 'editors.code'))
  const modeling = requireSuccess(editors.createView(editor, 'modeling'))
  render(
    <>
      <EditorView instance={code} editors={editors} />
      <EditorView instance={modeling} editors={editors} />
    </>
  )
  expect(await screen.findByText('modeling: original')).toBeVisible()
  await act(async () =>
    code.codeView.peek()!.dispatch({ changes: { from: 0, insert: 'edited ' } })
  )
  expect(await screen.findByText('modeling: edited original')).toBeVisible()
  expect(acquire).toHaveBeenCalledOnce()
  expect(release).not.toHaveBeenCalled()
  await act(() => editors.closeView(code.id))
  expect(registry.required(executorsService).executors.peek()).toHaveLength(1)
  await act(() => editors.closeView(modeling.id))
  expect(registry.required(executorsService).executors.peek()).toEqual([])
  expect(release).toHaveBeenCalledOnce()
})

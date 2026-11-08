import '@src/lib/projectSession/next/testFeature'
import { defineRegistryItem, provide, Registry, Slot } from '@kittycad/registry'
import { useSignals } from '@preact/signals-react/runtime'
import { EditorView } from '@src/lib/editors/EditorView'
import type { EditorMatcher } from '@src/lib/editors/matching'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorViewValueSpec,
  type EditorViewContribution,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { executionContext } from '@src/lib/executors/context'
import executorsExtension from '@src/lib/executors/registry'
import {
  defineExecutorCapability,
  executorCapabilityValueSpec,
  executorsService,
} from '@src/lib/executors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@src/lib/paths', () => ({ PATHS: { INDEX: '/' } }))
let registry: Registry
const modes = new Slot()
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
beforeEach(() => {
  execute.mockClear()
  definitions.clear()
  registry = new Registry()
  registry.configure([editorsExtension, executorsExtension, modes.of()])
})
afterEach(() => {
  cleanup()
  registry[Symbol.dispose]()
})
function contribute(
  names = ['modeling', 'drawings'],
  matches: EditorMatcher = '.kcl'
) {
  registry.reconfigure(modes, [
    defineRegistryItem({
      provides: [
        provide(executorCapabilityValueSpec, capability),
        ...names.map((name) =>
          provide(
            editorViewValueSpec,
            definitions.get(name) ??
              (() => {
                const definition = defineEditorView(
                  executionContext(capability, () =>
                    registry.get(executorsService)
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
    }),
  ])
}

it('defaults to the highest-priority mode and retains its executor and buffer through mode switches and remounts', async () => {
  contribute()
  const editors = registry.get(editorsService),
    executors = registry.get(executorsService)
  const editor = editors.openEditor('/main.kcl', 'original')
  expect(editors.viewState(editor).value.selected?.id).toBe('modeling')
  const first = render(<EditorView editor={editor} editors={editors} />)
  expect(await screen.findByText('modeling: original')).toBeVisible()
  const executor = executors.executors.value[0]
  act(() => editors.setView(editor.id, 'editors.code'))
  expect(screen.getByRole('textbox')).toBeVisible()
  await act(async () =>
    editor.view.dispatch({ changes: { from: 0, insert: 'edited ' } })
  )
  act(() => editors.setView(editor.id, 'drawings'))
  expect(await screen.findByText('drawings: edited original')).toBeVisible()
  expect(executors.executors.value).toEqual([executor])
  first.unmount()
  expect(executors.executors.value).toEqual([executor])
  render(<EditorView editor={editor} editors={editors} />)
  expect(screen.getByText('drawings: edited original')).toBeVisible()
  act(() => editors.closeEditor(editor.id))
  expect(executors.executors.value).toEqual([])
})

it('keeps separate editor instances independent and releases withdrawn mode contexts', async () => {
  contribute()
  const editors = registry.get(editorsService),
    executors = registry.get(executorsService)
  const first = editors.openEditor('/main.kcl', 'first')
  const second = editors.openEditor('/main.kcl', 'second')
  expect(executors.executors.value).toHaveLength(2)
  editors.setView(first.id, 'drawings')
  const retained = executors.executors.value[0]
  contribute(['drawings'])
  await Promise.resolve()
  expect(executors.executors.value).toContain(retained)
  expect(editors.viewState(second).value.selected?.id).toBe('drawings')
  contribute([])
  await Promise.resolve()
  expect(editors.viewState(first).value.selected?.id).toBe('editors.code')
  expect(executors.executors.value).toEqual([])
})

it('binds content-matched contexts after CodeMirror updates and releases them when the buffer stops matching', async () => {
  contribute(['modeling'], ({ contents }) => contents.startsWith('render:'))
  const editors = registry.get(editorsService),
    executors = registry.get(executorsService)
  const editor = editors.openEditor('/notes.txt', 'plain')
  expect(executors.executors.value).toEqual([])
  editor.view.dispatch({ changes: { from: 0, insert: 'render:' } })
  await Promise.resolve()
  expect(editors.viewState(editor).value.selected?.id).toBe('modeling')
  expect(executors.executors.value).toHaveLength(1)
  editor.view.dispatch({ changes: { from: 0, to: 7, insert: '' } })
  await Promise.resolve()
  expect(executors.executors.value).toEqual([])
})

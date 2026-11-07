import { EditorView } from '@src/lib/editors/EditorView'
import '@src/lib/projectSession/next/testFeature'
import { history, undo } from '@codemirror/commands'
import { Popover } from '@headlessui/react'
import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorCapabilityValueSpec,
  editorsService,
} from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import { executorsService } from '@src/lib/executors/registry/contract'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import savingExtension from '@src/lib/save/registry'
import { editorSaveService } from '@src/lib/save/registry/contract'
import settingsExtension from '@src/lib/settings/registry'
import tomlExtension from '@src/lib/toml/registry'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

vi.mock('@src/lib/paths', () => ({ PATHS: { INDEX: '/' } }))
// Native popover positioning is tested separately in ToolbarDropdownPanel.
vi.mock('@src/components/ToolbarDropdownPanel', () => ({
  ToolbarDropdownPanel: ({ children }: PropsWithChildren) => (
    <Popover.Panel>
      <ul>{children}</ul>
    </Popover.Panel>
  ),
}))
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
let registry: Registry | undefined
afterEach(() => {
  cleanup()
  registry?.[Symbol.dispose]()
})

const source = `# preserved comment
[settings.app]
theme = "system"
notes = """
first line
second line"""
[settings.modeling]
show_grid = false
[plugin]
custom = "keep me"
`

it('prefers Settings for project.toml and switches to TOML without restarting execution', async () => {
  registry = new Registry()
  registry.configure([
    editorsExtension,
    executorsExtension,
    tomlExtension,
    settingsExtension,
  ])
  const editors = registry.get(editorsService)
  const editor = editors.openEditor('/project/project.toml', source)
  expect(
    editors.viewState(editor).value.available.map((view) => view.id)
  ).toEqual(['settings.editor', 'toml.table', 'editors.code'])
  expect(editors.viewState(editor).value.selected?.id).toBe('settings.editor')
  const executor = registry.get(executorsService).executors.value[0]
  editors.setView(editor.id, 'toml.table')
  render(<EditorView editor={editor} editors={editors} />)
  expect((await screen.findAllByRole('table'))[0]).toBeVisible()
  expect(screen.getByText('"keep me"')).toBeVisible()
  expect(registry.get(executorsService).executors.value).toEqual([executor])
})

it('edits sections through the shared buffer, preserves source changes, supports undo and saves the same document', async () => {
  const writeFile = vi.fn(async () => undefined)
  registry = new Registry()
  registry.configure([
    editorsExtension,
    executorsExtension,
    savingExtension,
    tomlExtension,
    settingsExtension,
    defineRegistryItem({
      providesServices: [
        provideService(fileOperationsService, {
          ...testFileOperations,
          writeFile,
        }),
      ],
      provides: [
        provide(editorCapabilityValueSpec, {
          id: 'test.history',
          matches: '*',
          capabilities: () => [history()],
        }),
      ],
    }),
  ])
  const editors = registry.get(editorsService)
  const editor = editors.openEditor('/project/project.toml', source)
  render(<EditorView editor={editor} editors={editors} />)
  const theme = await screen.findByRole('textbox', { name: 'theme' })
  fireEvent.blur(screen.getByRole('textbox', { name: 'notes' }))
  expect(editor.view.state.doc.toString()).toBe(source)
  // An edit made directly in source must survive a later form edit.
  act(() =>
    editor.view.dispatch({
      changes: { from: 0, insert: '# new source comment\n' },
    })
  )
  fireEvent.change(theme, { target: { value: 'dark' } })
  fireEvent.blur(theme)
  expect(editor.view.state.doc.toString()).toBe(
    '# new source comment\n' + source.replace('"system"', '"dark"')
  )
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'modeling' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'show grid' }))
  expect(editor.view.state.doc.toString()).toContain('show_grid = true')
  act(() => {
    undo(editor.view)
  })
  expect(editor.view.state.doc.toString()).toContain('show_grid = false')
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Save file' }))
  await act(async () => {})
  expect(writeFile).toHaveBeenCalledWith(
    '/project/project.toml',
    editor.view.state.doc.toString()
  )
  expect(registry.get(editorSaveService).state(editor).value.dirty).toBe(false)
  act(() =>
    editor.view.dispatch({
      changes: { from: 0, to: editor.view.state.doc.length, insert: '[broken' },
    })
  )
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})

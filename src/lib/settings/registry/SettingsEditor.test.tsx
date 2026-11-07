import '@src/lib/projectSession/next/testFeature'
import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { undo, history } from '@codemirror/commands'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorCapabilityValueSpec,
} from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import {
  executorsService,
  executorCapabilityValueSpec,
  executorViewValueSpec,
} from '@src/lib/executors/registry/contract'
import { ExecutorView } from '@src/lib/executors/ExecutorView'
import {
  viewsForSource,
  candidateViewsForSource,
} from '@src/lib/executors/views'
import { OPEN_EXECUTOR_COMMAND } from '@src/lib/executors/commands'
import savingExtension from '@src/lib/save/registry'
import { editorSaveService } from '@src/lib/save/registry/contract'
import settingsExtension from '@src/lib/settings/registry'
import tomlExtension from '@src/lib/toml/registry'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { provide } from '@kittycad/registry'
import { Popover } from '@headlessui/react'
import type { PropsWithChildren } from 'react'

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

it('prefers Settings for project.toml while allowing the explicit generic TOML mode', async () => {
  registry = new Registry()
  registry.configure([
    editorsExtension,
    executorsExtension,
    tomlExtension,
    settingsExtension,
  ])
  const capabilities = registry.get(executorCapabilityValueSpec)
  const views = registry.get(executorViewValueSpec)
  expect(
    viewsForSource(
      { src: '/project/project.toml', contents: source },
      capabilities,
      views
    ).map((view) => view.id)
  ).toEqual(['settings.editor', 'toml.table'])
  expect(
    candidateViewsForSource('/project/project.toml', capabilities, views).map(
      (view) => view.id
    )
  ).toEqual(['settings.editor', 'toml.table'])
  expect(
    viewsForSource(
      { src: '/project/other.toml', contents: source },
      capabilities,
      views
    ).map((view) => view.id)
  ).toEqual(['toml.table'])
  const editor = registry
    .get(editorsService)
    .openEditor('/project/project.toml', source)
  const command = registry
    .get(commandsValueSpec)
    .find((command) => command.id === OPEN_EXECUTOR_COMMAND.id)!
  await command.onSubmit?.({ src: editor.src.value })
  const executors = registry.get(executorsService)
  expect(executors.viewTabs.value[0].viewId).toBe('settings.editor')
  await command.onSubmit?.({ src: editor.src.value, view: 'toml.table' })
  expect(executors.viewTabs.value[1].viewId).toBe('toml.table')
  render(
    <ExecutorView
      executors={executors}
      capabilities={registry.signal(executorCapabilityValueSpec)}
      views={registry.signal(executorViewValueSpec)}
      onOpenExecutor={() => {}}
    />
  )
  expect((await screen.findAllByRole('table'))[0]).toBeVisible()
  expect(screen.getByText('"keep me"')).toBeVisible()
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
  const executors = registry.get(executorsService)
  executors.openView(editor, 'settings.editor')
  render(
    <ExecutorView
      executors={executors}
      capabilities={registry.signal(executorCapabilityValueSpec)}
      views={registry.signal(executorViewValueSpec)}
      onOpenExecutor={() => {}}
    />
  )
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

import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { signal } from '@preact/signals-core'
import { presentation, requireSuccess } from '@src/lib/editors/testViews'
import { EditorView } from '@src/lib/editors/EditorView'
import '@src/lib/projectSession/next/testFeature'
import { Popover } from '@headlessui/react'
import { Registry, provide, contribute } from 'plankton'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorReadOnlyPoliciesFacet,
  editorsService,
} from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import savingExtension from '@src/lib/save/registry'
import { editorSaveService } from '@src/lib/save/registry/contract'
import settingsExtension from '@src/lib/settings/registry'
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
afterEach(async () => {
  cleanup()
  await registry?.dispose()
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

it('offers Settings and editable Code for project.toml, and only Code for ordinary TOML files', async () => {
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    executorsExtension,
    settingsExtension,
  ])
  const editors = registry.required(editorsService)
  const project = requireSuccess(
    editors.openEditor('/project/project.toml', source)
  )
  const settingsView = presentation(editors, project)
  expect(
    editors.viewState(settingsView).value.available.map((view) => view.id)
  ).toEqual(['settings.editor', 'editors.code'])
  expect(editors.viewState(settingsView).value.selected?.id).toBe(
    'settings.editor'
  )
  const ordinary = requireSuccess(
    editors.openEditor('/project/other.toml', source)
  )
  expect(
    editors
      .viewState(presentation(editors, ordinary))
      .value.available.map((view) => view.id)
  ).toEqual(['editors.code'])
  render(<EditorView instance={settingsView} editors={editors} />)
  expect(await screen.findByRole('textbox', { name: 'theme' })).toBeVisible()
})

it('edits sections through the shared buffer, preserves source changes, supports undo and saves the same document', async () => {
  const writeFile = vi.fn(async () => undefined)
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    executorsExtension,
    savingExtension,
    settingsExtension,
    [provide(fileOperationsService, { ...testFileOperations, writeFile })],
  ])
  const editors = registry.required(editorsService)
  const editor = requireSuccess(
    editors.openEditor('/project/project.toml', source)
  )
  render(
    <EditorView instance={presentation(editors, editor)} editors={editors} />
  )
  const theme = await screen.findByRole('textbox', { name: 'theme' })
  fireEvent.blur(screen.getByRole('textbox', { name: 'notes' }))
  expect(editor.state.doc.toString()).toBe(source)
  // An edit made directly in source must survive a later form edit.
  act(() =>
    editor.dispatch({
      changes: { from: 0, insert: '# new source comment\n' },
    })
  )
  fireEvent.change(theme, { target: { value: 'dark' } })
  fireEvent.blur(theme)
  expect(editor.state.doc.toString()).toBe(
    '# new source comment\n' + source.replace('"system"', '"dark"')
  )
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'modeling' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'show grid' }))
  expect(editor.state.doc.toString()).toContain('show_grid = true')
  act(() => {
    editor.undo()
  })
  expect(editor.state.doc.toString()).toContain('show_grid = false')
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Save file' }))
  await act(async () => {})
  expect(writeFile).toHaveBeenCalledWith(
    '/project/project.toml',
    editor.state.doc.toString()
  )
  expect(registry.required(editorSaveService).state(editor).value.dirty).toBe(
    false
  )
  act(() =>
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: '[broken' },
    })
  )
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})

it('disables settings fields when the document is read-only', async () => {
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    executorsExtension,
    settingsExtension,
    [
      contribute(editorReadOnlyPoliciesFacet, () => ({
        id: 'readonly-test',
        matches: () => true,
        readOnly: signal(true),
      })),
    ],
  ])
  const editors = registry.required(editorsService)
  const editor = requireSuccess(
    editors.openEditor('/project/project.toml', source)
  )
  render(
    <EditorView instance={presentation(editors, editor)} editors={editors} />
  )
  expect(await screen.findByRole('textbox', { name: 'theme' })).toBeDisabled()
})

it("refreshes project metadata only when saving that opening's root settings file", async () => {
  const files = {
    ...testFileOperations,
    writeFile: vi.fn(async () => undefined),
  }
  const projects = createProjectSessionService(files)
  projects.openProject({
    contents: { name: 'project', path: '/project', children: [] },
    metadata: { title: 'Original', readWriteAccess: true },
  })
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    executorsExtension,
    savingExtension,
    settingsExtension,
    [
      provide(fileOperationsService, files),
      provide(projectSessionService, projects),
    ],
  ])
  const editors = registry.required(editorsService)
  const saving = registry.required(editorSaveService)
  const contents = 'title = "Changed"\ndefault_file = "other.kcl"\n'
  const nested = requireSuccess(
    editors.openEditor('/project/nested/project.toml', '')
  )
  nested.dispatch({ changes: { from: 0, insert: contents } })
  expect(await saving.save(nested)).toBeUndefined()
  expect(projects.currentProject.peek()?.metadata.title).toBe('Original')
  const root = requireSuccess(editors.openEditor('/project/project.toml', ''))
  root.dispatch({ changes: { from: 0, insert: contents } })
  expect(await saving.save(root)).toBeUndefined()
  expect(projects.currentProject.peek()?.metadata).toMatchObject({
    title: 'Changed',
    defaultFile: 'other.kcl',
  })
  projects.closeProject()
})

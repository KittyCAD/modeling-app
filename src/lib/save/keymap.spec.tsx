import '@src/lib/projectSession/next/testFeature'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { Registry, contribute, provide, slot } from 'plankton'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorNamingService,
  editorsService,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'
import { EditorsPane } from '@src/lib/editors/EditorsPane'
import { codeSurface, requireSuccess } from '@src/lib/editors/testViews'
import { defineEditorView } from '@src/lib/editors/views'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { LayoutType } from '@src/lib/layout/types'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import savingExtension, {
  SAVE_EDITOR_COMMAND,
  RENAME_EDITOR_COMMAND,
} from '@src/lib/save/registry'
import { editorSaveService } from '@src/lib/save/registry/contract'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import {
  keymapService,
  provideKeymapItem,
} from '@src/registry/contracts/keymap'
import {
  CODE_EDITOR_FOCUSED_COMMAND_SCOPE,
  EDITABLE_FOCUSED_COMMAND_SCOPE,
  EDITOR_FOCUSED_COMMAND_SCOPE,
  commandScopeService,
  provideCommand,
} from '@src/registry/contracts/commands'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { commandsExtension } from '@src/registry/extensions/commands'
import keymapExtension from '@src/registry/extensions/keymap'

vi.mock('@src/registry/extensions/keymap/persistence', () => ({
  readUserKeymapFile: async () => ({ version: 2, bindings: [] }),
  writeUserKeymapFile: async () => {},
}))
vi.mock('@src/lib/paths', () => ({ PATHS: { INDEX: '/' } }))

let registry: Registry
const writeFile = vi.fn<typeof testFileOperations.writeFile>()
const createFile = vi.fn<typeof testFileOperations.createFile>()
const rename = vi.fn<typeof testFileOperations.rename>()
const unrelatedSave = vi.fn()
const extraViews = slot()
const layout = {
  id: 'editors',
  label: 'Editors',
  type: LayoutType.Simple,
  areaType: 'editors',
} as const

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
beforeEach(async () => {
  writeFile.mockReset().mockResolvedValue(undefined)
  createFile.mockReset().mockResolvedValue(undefined)
  rename.mockReset().mockResolvedValue(undefined)
  unrelatedSave.mockReset()
  const projects = createProjectSessionService(testFileOperations)
  projects.openProject({
    contents: { name: 'project', path: '/project', children: [] },
    metadata: { title: 'Project', readWriteAccess: true },
  })
  registry = new Registry()
  await registry.configure([
    extraViews,
    editorsExtension,
    savingExtension,
    commandsExtension,
    keymapExtension,
    provideWasmPromise(() => new Promise(() => {})),
    provide(projectSessionService, projects),
    provide(fileOperationsService, {
      ...testFileOperations,
      writeFile,
      createFile,
      rename,
    }),
    provideKeymapItem({
      id: 'test.save',
      title: 'Other save',
      source: 'test',
      command: 'test.save',
      keystrokes: ['mod+s'],
    }),
    provideCommand({
      id: 'test.save',
      name: 'other-save',
      groupId: 'test',
      scopes: ['base'],
      needsReview: false,
      onSubmit: unrelatedSave,
    }),
  ])
})
afterEach(async () => {
  cleanup()
  await registry.dispose()
})
function pane() {
  const editors = registry.required(editorsService)
  render(
    <EditorsPane
      editors={editors}
      naming={registry.required(editorNamingService)}
      layout={layout}
    />
  )
  return editors
}
function press(target: HTMLElement, key: string, modified = false) {
  fireEvent.keyDown(target, {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined,
    ctrlKey: modified && !/Mac/.test(navigator.platform),
    metaKey: modified && /Mac/.test(navigator.platform),
  })
}

it('saves an unnamed Code buffer using the contributed shortcut and actual command system', async () => {
  const editors = registry.required(editorsService)
  const editor = requireSuccess(editors.createEditor('draft'))
  editors.createView(editor)
  pane()
  act(() => {
    codeSurface(editors, editor).focus()
  })
  press(codeSurface(editors, editor).contentDOM, 's', true)
  const input = await screen.findByRole('textbox', {
    name: 'Project-relative file path',
  })
  fireEvent.change(input, { target: { value: 'draft.txt' } })
  press(input, 'Enter')
  await vi.waitFor(() =>
    expect(writeFile).toHaveBeenCalledWith('/project/draft.txt', 'draft')
  )
  expect(registry.required(editorSaveService).state(editor).peek().dirty).toBe(
    false
  )
})

it.each(['modeling', 'form'])(
  'saves a focused %s view without enabling Code-only commands',
  async (mode) => {
    await registry.replace(extraViews, [
      contribute(editorViewsFacet, () =>
        defineEditorView({
          id: mode,
          label: mode,
          matches: '*',
          priority: 1000,
          Component: () =>
            mode === 'form' ? (
              <textarea aria-label="Form contents" />
            ) : (
              <button type="button">Scene control</button>
            ),
        })
      ),
    ])
    const editors = registry.required(editorsService)
    const editor = requireSuccess(
      editors.openEditor('/project/existing.txt', 'contents')
    )
    editors.createView(editor)
    pane()
    const target =
      mode === 'form'
        ? screen.getByRole('textbox', { name: 'Form contents' })
        : screen.getByRole('button', { name: 'Scene control' })
    act(() => {
      target.focus()
    })
    const scopes = registry.required(commandScopeService).getCurrentScopes()
    expect(scopes).toContain(EDITOR_FOCUSED_COMMAND_SCOPE)
    expect(scopes).not.toContain(CODE_EDITOR_FOCUSED_COMMAND_SCOPE)
    if (mode === 'form')
      expect(scopes).toContain(EDITABLE_FOCUSED_COMMAND_SCOPE)
    press(target, 's', true)
    await vi.waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith(
        '/project/existing.txt',
        'contents'
      )
    )
  }
)

it('honors Save remapping and unbinding in Code and does not intercept Save outside an editor', async () => {
  const editors = registry.required(editorsService)
  const editor = requireSuccess(
    editors.openEditor('/project/existing.txt', 'contents')
  )
  editors.createView(editor)
  pane()
  const keys = registry.required(keymapService)
  await keys.addUserBinding({
    command: SAVE_EDITOR_COMMAND.id,
    keystrokes: ['mod+shift+s'],
    when: [EDITOR_FOCUSED_COMMAND_SCOPE],
  })
  act(() => {
    codeSurface(editors, editor).focus()
  })
  press(codeSurface(editors, editor).contentDOM, 's', true)
  expect(writeFile).not.toHaveBeenCalled()
  fireEvent.keyDown(codeSurface(editors, editor).contentDOM, {
    key: 's',
    code: 'KeyS',
    ctrlKey: !/Mac/.test(navigator.platform),
    metaKey: /Mac/.test(navigator.platform),
    shiftKey: true,
  })
  await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1))
  const binding = keys.keymap
    .peek()
    .items.find((item) => item.command === SAVE_EDITOR_COMMAND.id)!
  await keys.unbind(binding)
  fireEvent.keyDown(codeSurface(editors, editor).contentDOM, {
    key: 's',
    code: 'KeyS',
    ctrlKey: !/Mac/.test(navigator.platform),
    metaKey: /Mac/.test(navigator.platform),
    shiftKey: true,
  })
  const outside = document.createElement('input')
  document.body.append(outside)
  act(() => {
    outside.focus()
  })
  expect(
    registry.required(commandScopeService).getCurrentScopes()
  ).not.toContain(EDITOR_FOCUSED_COMMAND_SCOPE)
  press(outside, 's', true)
  expect(writeFile).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(unrelatedSave).toHaveBeenCalled())
  outside.remove()
})

it('contributes global F2 and honors its unbinding when a tab has focus', async () => {
  const editors = registry.required(editorsService)
  const first = requireSuccess(
    editors.openEditor('/project/first.txt', 'first')
  )
  const second = requireSuccess(
    editors.openEditor('/project/second.txt', 'second')
  )
  editors.createView(first)
  const secondView = requireSuccess(editors.createView(second))
  pane()
  const tab = screen.getByRole('tab', { name: 'second.txt' })
  act(() => {
    tab.focus()
  })
  press(tab, 'F2')
  const input = await screen.findByRole('textbox', {
    name: 'Project-relative file path',
  })
  expect(input).toHaveValue('second.txt')
  expect(
    registry.required(editorNamingService).state(second).peek()?.viewId
  ).toBe(secondView.id)
  press(input, 'Escape')
  const keys = registry.required(keymapService)
  const binding = keys.keymap
    .peek()
    .items.find((item) => item.command === RENAME_EDITOR_COMMAND.id)!
  expect(binding.when ?? []).toEqual([])
  await keys.unbind(binding)
  act(() => {
    tab.focus()
  })
  press(tab, 'F2')
  expect(
    screen.queryByRole('textbox', { name: 'Project-relative file path' })
  ).toBeNull()
})

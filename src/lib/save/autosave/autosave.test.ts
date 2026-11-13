import '@src/lib/projectSession/next/testFeature'
import {
  Registry,
  Slot,
  defineRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { EditorState } from '@codemirror/state'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorReadOnlyPoliciesValueSpec,
  type Editor,
} from '@src/lib/editors/registry/contract'
import { codeSurface, requireSuccess } from '@src/lib/editors/testViews'
import savingExtension from '@src/lib/save/registry'
import {
  editorAutosavePoliciesValueSpec,
  editorSaveService,
} from '@src/lib/save/registry/contract'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'

import type { Setting } from '@src/lib/settings/Setting'
import { hiddenOnPlatform } from '@src/lib/settings/settingsUtils'
import { PROJECT_SHELL_FEATURE } from '@src/lib/projectSession/next/feature'
import { createSettings } from '@src/lib/settings/initialSettings'
import {
  settingsService,
  settingsValueSpec,
  type SettingsRegistryService,
} from '@src/registry/contracts/settings'

const extra = new Slot()
const policies = new Slot()
let registry: Registry
let settings: ReturnType<typeof createSettings>
const required = signal(false)
const readOnly = signal(false)
const writeFile = vi.fn<typeof testFileOperations.writeFile>()
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
beforeEach(async () => {
  vi.useFakeTimers()
  required.value = false
  readOnly.value = false
  writeFile.mockReset().mockResolvedValue(undefined)
  registry = new Registry()
  registry.configure([
    editorsExtension,
    savingExtension,
    extra.of(),
    policies.of(),
    defineRegistryItem({
      providesServices: [
        provideService(fileOperationsService, {
          ...testFileOperations,
          writeFile,
        }),
      ],
      provides: [
        provide(editorAutosavePoliciesValueSpec, {
          id: 'test.autosave',
          matches: '*',
          required,
        }),
        provide(editorReadOnlyPoliciesValueSpec, {
          id: 'test.read-only',
          matches: '*',
          readOnly,
        }),
      ],
    }),
  ])
  settings = createSettings(registry.get(settingsValueSpec))
  settings.textEditor.autosave.user = false
  await registry.reconfigureAsync(extra, [
    defineRegistryItem({
      providesServices: [
        provideService(settingsService, {
          current: signal(settings),
        } as unknown as SettingsRegistryService),
      ],
    }),
  ])
})
afterEach(() => {
  registry[Symbol.dispose]()
  vi.useRealTimers()
})
const open = (src: string | undefined = '/project/main.kcl') =>
  requireSuccess(registry.get(editorsService).openEditor(src, 'original'))
const change = (editor: Editor, contents: string) =>
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: contents },
  })

it('lets a required autosave policy override the disabled user preference after inactivity', async () => {
  const editor = open()
  change(editor, 'local edit')
  await vi.advanceTimersByTimeAsync(2000)
  expect(writeFile).not.toHaveBeenCalled()
  required.value = true
  await vi.advanceTimersByTimeAsync(1499)
  expect(writeFile).not.toHaveBeenCalled()
  change(editor, 'latest edit')
  await vi.advanceTimersByTimeAsync(1499)
  expect(writeFile).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(writeFile).toHaveBeenCalledExactlyOnceWith(
    '/project/main.kcl',
    'latest edit'
  )
  expect(registry.get(editorSaveService).state(editor).peek().dirty).toBe(false)
})

it('shares one autosave across views and cancels it when the document closes', async () => {
  required.value = true
  const editors = registry.get(editorsService)
  const editor = open()
  requireSuccess(editors.createView(editor))
  requireSuccess(editors.createView(editor))
  change(editor, 'shared edit')
  await vi.advanceTimersByTimeAsync(1500)
  expect(writeFile).toHaveBeenCalledTimes(1)
  change(editor, 'closed edit')
  editors.closeEditor(editor.id)
  await vi.advanceTimersByTimeAsync(1500)
  expect(writeFile).toHaveBeenCalledTimes(1)
})

it('blocks document and Code edits while read-only, then saves the pending edit when the restriction is lifted', async () => {
  required.value = true
  const editor = open()
  const code = codeSurface(registry.get(editorsService), editor)
  change(editor, 'pending edit')
  readOnly.value = true
  await vi.advanceTimersByTimeAsync(2000)
  expect(code.state.facet(EditorState.readOnly)).toBe(true)
  change(editor, 'blocked document edit')
  code.dispatch({ changes: { from: 0, insert: 'blocked Code edit' } })
  expect(editor.undo()).toBe(false)
  expect(editor.contents.peek()).toBe('pending edit')
  expect(code.state.doc.toString()).toBe('pending edit')
  expect(writeFile).not.toHaveBeenCalled()
  readOnly.value = false
  await vi.advanceTimersByTimeAsync(1500)
  expect(code.state.facet(EditorState.readOnly)).toBe(false)
  expect(writeFile).toHaveBeenCalledExactlyOnceWith(
    '/project/main.kcl',
    'pending edit'
  )
  change(editor, 'editable again')
  expect(editor.contents.peek()).toBe('editable again')
})

it('requires autosave while any matching policy requires it', async () => {
  const anotherRequired = signal(true)
  await registry.reconfigureAsync(policies, [
    defineRegistryItem({
      provides: [
        provide(editorAutosavePoliciesValueSpec, {
          id: 'test.another-autosave',
          matches: '.kcl',
          required: anotherRequired,
        }),
        provide(editorAutosavePoliciesValueSpec, {
          id: 'test.markdown-autosave',
          matches: '.md',
          required: signal(true),
        }),
      ],
    }),
  ])
  const editor = open()
  required.value = true
  change(editor, 'required by both')
  await vi.advanceTimersByTimeAsync(1500)
  expect(writeFile).toHaveBeenLastCalledWith(
    editor.src.peek(),
    'required by both'
  )

  required.value = false
  change(editor, 'still required')
  await vi.advanceTimersByTimeAsync(1500)
  expect(writeFile).toHaveBeenLastCalledWith(
    editor.src.peek(),
    'still required'
  )

  anotherRequired.value = false
  change(editor, 'autosave disabled')
  await vi.advanceTimersByTimeAsync(1500)
  expect(writeFile).toHaveBeenCalledTimes(2)
  expect(registry.get(editorSaveService).state(editor).peek().dirty).toBe(true)
})

it('allows editing only after every matching read-only policy is lifted', async () => {
  const anotherReadOnly = signal(true)
  await registry.reconfigureAsync(policies, [
    defineRegistryItem({
      provides: [
        provide(editorReadOnlyPoliciesValueSpec, {
          id: 'test.another-read-only',
          matches: '.kcl',
          readOnly: anotherReadOnly,
        }),
        provide(editorReadOnlyPoliciesValueSpec, {
          id: 'test.markdown-read-only',
          matches: '.md',
          readOnly: signal(true),
        }),
      ],
    }),
  ])
  const editor = open()
  readOnly.value = true
  change(editor, 'blocked by both')
  expect(editor.contents.peek()).toBe('original')

  readOnly.value = false
  change(editor, 'still blocked')
  expect(editor.readOnly.peek()).toBe(true)
  expect(editor.contents.peek()).toBe('original')

  anotherReadOnly.value = false
  change(editor, 'editable again')
  expect(editor.readOnly.peek()).toBe(false)
  expect(editor.contents.peek()).toBe('editable again')
})

it('does not autosave unnamed buffers', async () => {
  required.value = true
  const editor = requireSuccess(
    registry.get(editorsService).openEditor(undefined, 'draft')
  )
  change(editor, 'unfinished draft')
  await vi.advanceTimersByTimeAsync(1500)
  expect(writeFile).not.toHaveBeenCalled()
})

it('reacts to the user Autosave setting without reopening the buffer', async () => {
  const editor = open()
  change(editor, 'local work')
  settings.textEditor.autosave.user = true
  await vi.advanceTimersByTimeAsync(1500)
  expect(writeFile).toHaveBeenCalledExactlyOnceWith(
    '/project/main.kcl',
    'local work'
  )
  change(editor, 'manual work')
  settings.textEditor.autosave.user = false
  await vi.advanceTimersByTimeAsync(1500)
  expect(writeFile).toHaveBeenCalledTimes(1)
})

it('automatically saves local documents by default', async () => {
  settings.textEditor.autosave.user = undefined
  const editor = open()
  change(editor, 'default autosave')
  await vi.advanceTimersByTimeAsync(1500)
  expect(writeFile).toHaveBeenCalledExactlyOnceWith(
    '/project/main.kcl',
    'default autosave'
  )
})

it('hides the Autosave preference without the project shell feature flag', () => {
  const autosave = settings.textEditor.autosave as Setting<unknown>
  expect(hiddenOnPlatform(autosave, false, () => false)).toBe(true)
  expect(
    hiddenOnPlatform(
      autosave,
      false,
      (feature) => feature === PROJECT_SHELL_FEATURE
    )
  ).toBe(false)
})

import '@src/lib/projectSession/next/testFeature'
import { signal } from '@preact/signals-core'
import { Registry, contribute, provide } from 'plankton'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorLanguagesFacet,
  editorsService,
  type Editor,
} from '@src/lib/editors/registry/contract'
import { loadProjectEditor } from '@src/lib/editors/loadProjectEditor'
import { requireSuccess } from '@src/lib/editors/testViews'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import savingExtension from '@src/lib/save/registry'
import {
  editorAutosavePoliciesFacet,
  editorOnSaveFacet,
  editorSaveService,
} from '@src/lib/save/registry/contract'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

let registry: Registry
let open: (path: string) => Promise<Editor>
let stored: Map<string, Uint8Array>
const writeFile = vi.fn<typeof testFileOperations.writeFile>()
const onSave = vi.fn(async () => undefined)
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
beforeEach(async () => {
  vi.useFakeTimers()
  stored = new Map([
    ['/project/opaque.bin', new Uint8Array([0, 255, 128, 13, 10])],
    ['/project/utf8.unknown', new TextEncoder().encode('looks like text\r\n')],
    ['/project/broken.txt', new Uint8Array([0xff, 0xfe, 65])],
    ['/project/notes.txt', new TextEncoder().encode('original')],
  ])
  writeFile.mockReset().mockImplementation(async (path, contents) => {
    stored.set(
      path,
      typeof contents === 'string'
        ? new TextEncoder().encode(contents)
        : contents.slice()
    )
  })
  onSave.mockClear()
  const operations = {
    ...testFileOperations,
    readFile: async (path: string) => stored.get(path)!.slice(),
    writeFile,
  }
  const projects = createProjectSessionService(operations)
  projects.openProject({
    contents: {
      name: 'project',
      path: '/project',
      children: [...stored.keys()].map((path) => ({
        name: path,
        path,
        children: null,
      })),
    },
    metadata: { title: 'Project', readWriteAccess: true },
  })
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    savingExtension,
    provide(projectSessionService, projects),
    provide(fileOperationsService, operations),
    contribute(editorAutosavePoliciesFacet, () => ({
      id: 'required',
      matches: '*' as const,
      required: signal(true),
    })),
    contribute(editorLanguagesFacet, () => ({
      id: 'test-text',
      matches: '.txt' as const,
    })),
    contribute(editorOnSaveFacet, () => ({
      id: 'spy',
      order: -200,
      matches: '*' as const,
      onSave,
    })),
  ])
  open = async (path) =>
    requireSuccess(
      await loadProjectEditor(
        path,
        registry.required(editorsService),
        () => projects,
        () => operations
      )
    )
})
afterEach(async () => {
  await registry.dispose()
  vi.useRealTimers()
})
function change(editor: Editor) {
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: 'edited' },
  })
}
it.each([
  '/project/opaque.bin',
  '/project/utf8.unknown',
  '/project/broken.txt',
])(
  'preserves %s through opening, attempted edits, required autosave, and explicit save',
  async (path) => {
    const original = stored.get(path)!.slice()
    const editor = await open(path)
    expect(editor.backing.type).toBe('binary')
    expect(editor.readOnly.peek()).toBe(true)
    const service = registry.required(editorsService)
    const view = requireSuccess(service.createView(editor))
    await Promise.resolve()
    expect(service.viewState(view).peek().selected?.id).toBe('editors.binary')
    expect(
      service
        .viewState(view)
        .peek()
        .available.some(({ id }) => id === 'editors.code')
    ).toBe(false)
    change(editor)
    await vi.advanceTimersByTimeAsync(3000)
    expect(editor.contents.peek()).toBe('')
    expect(
      await registry.required(editorSaveService).save(editor)
    ).toBeInstanceOf(Error)
    expect(writeFile).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    expect(stored.get(path)).toEqual(original)
    if (editor.backing.type !== 'binary')
      return expect.fail('Expected an opaque backing')
    expect(editor.backing.readBytes()).toEqual(original)
  }
)
it('keeps binary files locked after language selection, renaming, and text adoption', async () => {
  const editor = await open('/project/opaque.bin')
  const service = registry.required(editorsService)
  requireSuccess(service.setLanguage(editor.id, 'test-text'))
  requireSuccess(service.setSource(editor.id, '/project/now-text.txt'))
  expect(editor.readOnly.peek()).toBe(true)
  change(editor)
  const saving = registry.required(editorSaveService)
  expect(saving.adopt(editor, 'remote text')).toBeInstanceOf(Error)
  expect(await saving.save(editor)).toBeInstanceOf(Error)
  await vi.advanceTimersByTimeAsync(3000)
  expect(writeFile).not.toHaveBeenCalled()
  expect(onSave).not.toHaveBeenCalled()
  expect(editor.contents.peek()).toBe('')
})
it('keeps registered text editable and persists both autosave and explicit save', async () => {
  const editor = await open('/project/notes.txt')
  expect(editor.backing.type).toBe('text')
  expect(editor.readOnly.peek()).toBe(false)
  change(editor)
  await vi.advanceTimersByTimeAsync(1500)
  expect(new TextDecoder().decode(stored.get('/project/notes.txt'))).toBe(
    'edited'
  )
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: 'explicit save' },
  })
  expect(
    await registry.required(editorSaveService).save(editor)
  ).toBeUndefined()
  expect(new TextDecoder().decode(stored.get('/project/notes.txt'))).toBe(
    'explicit save'
  )
  expect(writeFile).toHaveBeenCalledTimes(2)
})

it('blocks explicit save of an unknown file without edits', async () => {
  const original = stored.get('/project/opaque.bin')!.slice()
  const editor = await open('/project/opaque.bin')
  const result = await registry.required(editorSaveService).save(editor)
  expect(stored.get('/project/opaque.bin')).toEqual(original)
  expect(writeFile).not.toHaveBeenCalled()
  expect(result).toBeInstanceOf(Error)
})
it('blocks autosave after attempted edits to an unknown file', async () => {
  const original = stored.get('/project/opaque.bin')!.slice()
  const editor = await open('/project/opaque.bin')
  change(editor)
  await vi.advanceTimersByTimeAsync(3000)
  expect(stored.get('/project/opaque.bin')).toEqual(original)
  expect(writeFile).not.toHaveBeenCalled()
})

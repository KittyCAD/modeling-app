import { isolateHistory } from '@codemirror/commands'
import '@src/lib/projectSession/next/testFeature'
import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { beforeAll, afterEach, expect, it, vi } from 'vitest'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import savingExtension from '@src/lib/save/registry'
import { editorSaveService } from '@src/lib/save/registry/contract'
import collaborationExtension from '@src/lib/collaboration/registry'
import { collaborationService } from '@src/lib/collaboration/registry/contract'
import projectExtension from '@src/lib/projectSession/registry'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import {
  FileNotFound,
  FileAlreadyExists,
} from '@src/lib/fileSystem/fileOperations'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import * as A from '@automerge/automerge'

vi.mock('@src/lib/paths', () => ({ PATHS: { INDEX: '/' } }))
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
const registries: Registry[] = []
afterEach(async () => {
  for (const registry of registries) {
    await registry
      .get(collaborationService)
      .flush()
      .catch(() => {})
    registry[Symbol.dispose]()
  }
  registries.length = 0
})
function disk() {
  const files = new Map<string, Uint8Array>()
  const directories = new Set<string>()
  const missing = (path: string) =>
    new FileNotFound({
      operation: 'read-file',
      path,
      cause: undefined,
      message: 'Missing file',
    })
  const collision = (path: string) =>
    new FileAlreadyExists({
      operation: 'create-directory',
      path,
      cause: undefined,
      message: 'Already exists',
    })
  const writeFile = vi.fn(
    async (path: string, contents: string | Uint8Array) => {
      files.set(
        path,
        typeof contents === 'string'
          ? new TextEncoder().encode(contents)
          : contents.slice()
      )
    }
  )
  return {
    files,
    operations: {
      ...testFileOperations,
      readFile: vi.fn(async (path: string) => {
        const value = files.get(path)
        if (!value) throw missing(path)
        return value.slice()
      }),
      writeFile,
      createFile: vi.fn(async (path: string, contents: string | Uint8Array) => {
        if (files.has(path)) throw collision(path)
        await writeFile(path, contents)
      }),
      createDirectory: vi.fn(async (path: string) => {
        if (directories.has(path)) throw collision(path)
        directories.add(path)
      }),
      stat: vi.fn(async () => ({
        kind: 'directory' as const,
        device: 0,
        inode: 0,
        size: 0,
        accessedAt: 0,
        modifiedAt: 0,
        changedAt: 0,
        createdAt: 0,
      })),
    },
  }
}
function setup(storage = disk(), path?: string, writable = true) {
  const registry = new Registry()
  registries.push(registry)
  registry.configure([
    editorsExtension,
    projectExtension,
    collaborationExtension,
    savingExtension,
    defineRegistryItem({
      providesServices: [
        provideService(fileOperationsService, storage.operations),
      ],
    }),
  ])
  const projects = registry.get(projectSessionService)
  if (path)
    projects.openProject({
      contents: { name: 'project', path, children: [] },
      metadata: { title: 'Project', readWriteAccess: writable },
    })
  return {
    registry,
    projects,
    editors: registry.get(editorsService),
    collaboration: registry.get(collaborationService),
    storage,
  }
}

it('owns one history document across multiple views and keeps independent buffers separate', async () => {
  const { editors, collaboration } = setup()
  const editor = editors.openEditor('/file.md', 'Hello 🌎')
  const handle = await collaboration.ready(editor)
  const first = editors.createView(editor)
  const second = editors.createView(editor)
  first.codeView
    .peek()!
    .dispatch({ changes: { from: editor.state.doc.length, insert: ' A' } })
  expect(second.codeView.peek()!.state.doc.toString()).toBe('Hello 🌎 A')
  expect(handle.doc()!.text).toBe('Hello 🌎 A')
  editors.closeView(first.id)
  editor.dispatch({
    changes: { from: editor.state.doc.length, insert: ' B' },
    annotations: isolateHistory.of('full'),
  })
  expect((await collaboration.ready(editor)).documentId).toBe(handle.documentId)
  expect(handle.doc()!.text).toBe('Hello 🌎 A B')
  const independent = editors.openEditor('/file.md', 'independent')
  expect((await collaboration.ready(independent)).documentId).not.toBe(
    handle.documentId
  )
  expect(editor.undo()).toBe(true)
  expect(handle.doc()!.text).toBe('Hello 🌎 A')
})

it('recovers unsaved CRDT history across reopening and renames, without writing the source file', async () => {
  const storage = disk()
  const first = setup(storage, '/project')
  const editor = first.editors.openEditor('/project/file.md', 'disk text')
  const handle = await first.collaboration.ready(editor)
  editor.dispatch({ changes: { from: 0, insert: 'unsaved ' } })
  first.editors.setSource(editor.id, '/project/renamed.md')
  await first.collaboration.flush()
  expect(storage.files.has('/project/file.md')).toBe(false)
  expect(
    new TextDecoder().decode(storage.files.get('/project/.zoo/.gitignore'))
  ).toBe('*\n')
  const bytes = storage.files.get(
    `/project/.zoo/automerge/${handle.documentId}.automerge`
  )!
  expect(A.getHistory(A.load(bytes)).length).toBeGreaterThan(1)
  editor.dispatch({ changes: { from: 0, insert: 'latest ' } })
  first.projects.closeProject()
  const reopened = setup(storage, '/project')
  const recovered = reopened.editors.openEditor(
    '/project/renamed.md',
    'disk text'
  )
  const restored = await reopened.collaboration.ready(recovered)
  expect(restored.documentId).toBe(handle.documentId)
  expect(recovered.contents.value).toBe('latest unsaved disk text')
  const original = recovered.id
  reopened.editors.closeEditor(recovered.id)
  const again = reopened.editors.openEditor('/project/renamed.md', 'disk text')
  expect((await reopened.collaboration.ready(again)).documentId).toBe(
    handle.documentId
  )
  expect(again.id).not.toBe(original)
})

it('honors external disk edits and read-only projects, and reports corrupt history without replacing it', async () => {
  const storage = disk()
  const first = setup(storage, '/project')
  const editor = first.editors.openEditor('/project/file.md', 'original')
  await first.collaboration.ready(editor)
  editor.dispatch({ changes: { from: 0, insert: 'draft ' } })
  await first.collaboration.flush()
  first.projects.closeProject()
  await first.collaboration.flush()
  const reopened = setup(storage, '/project', false)
  storage.operations.writeFile.mockClear()
  const updated = reopened.editors.openEditor(
    '/project/file.md',
    'externally edited'
  )
  await reopened.collaboration.ready(updated)
  expect(updated.contents.value).toBe('externally edited')
  await reopened.collaboration.flush()
  expect(storage.operations.writeFile).not.toHaveBeenCalled()
  storage.files.set(
    '/broken/.zoo/automerge/index.json',
    new TextEncoder().encode('{broken')
  )
  const broken = setup(storage, '/broken')
  const intact = broken.editors.openEditor('/broken/a.md', 'keep this')
  await expect(broken.collaboration.ready(intact)).rejects.toBeInstanceOf(Error)
  expect(intact.contents.value).toBe('keep this')
  expect(broken.collaboration.state(intact).value.status).toBe('error')
  expect(
    new TextDecoder().decode(
      storage.files.get('/broken/.zoo/automerge/index.json')
    )
  ).toBe('{broken')
})

it('surfaces failed history writes and retries after the next edit', async () => {
  const { editors, collaboration, storage } = setup(disk(), '/project')
  const editor = editors.openEditor('/project/a.md', 'text')
  await collaboration.ready(editor)
  storage.operations.writeFile.mockRejectedValueOnce(new Error('Disk full'))
  await expect(collaboration.flush()).rejects.toThrow('Disk full')
  expect(collaboration.state(editor).value).toMatchObject({
    status: 'ready',
    durable: false,
    error: new Error('Disk full'),
  })
  editor.dispatch({ changes: { from: 0, insert: 'retry ' } })
  await collaboration.flush()
  expect(collaboration.state(editor).value).toMatchObject({
    status: 'ready',
    durable: true,
  })
})

it('keeps document identity through first save and restores edits made after the saved checkpoint', async () => {
  const storage = disk()
  const first = setup(storage, '/project')
  const editor = first.editors.createEditor('first save')
  const original = await first.collaboration.ready(editor)
  first.editors.setSource(editor.id, '/project/new.md')
  expect(
    await first.registry.get(editorSaveService).save(editor)
  ).toBeUndefined()
  expect(editor.src.value).toBe('/project/new.md')
  expect((await first.collaboration.ready(editor)).documentId).toBe(
    original.documentId
  )
  editor.dispatch({ changes: { from: 0, insert: 'unsaved ' } })
  await first.collaboration.flush()
  first.projects.closeProject()
  const reopened = setup(storage, '/project')
  const contents = new TextDecoder().decode(
    storage.files.get('/project/new.md')
  )
  const recovered = reopened.editors.openEditor('/project/new.md', contents)
  await reopened.collaboration.ready(recovered)
  expect(recovered.contents.value).toBe('unsaved first save')
})

it('retains edits made while collaboration history is loading', async () => {
  const storage = disk()
  const first = setup(storage, '/project')
  const editor = first.editors.openEditor('/project/file.md', 'disk')
  editor.dispatch({ changes: { from: 0, insert: 'typed ' } })
  await first.collaboration.ready(editor)
  await first.collaboration.flush()
  first.projects.closeProject()
  const reopened = setup(storage, '/project')
  const restored = reopened.editors.openEditor('/project/file.md', 'disk')
  await reopened.collaboration.ready(restored)
  expect(restored.contents.peek()).toBe('typed disk')
})

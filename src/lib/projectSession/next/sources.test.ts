import { signal } from '@preact/signals-core'
import type { Editor } from '@src/lib/editors/registry/contract'
import { createProjectSources } from '@src/lib/projectSession/next/sources'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import type { Project } from '@src/lib/projectSession/next/types'
import { expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('node:path')).posix,
}))
const bytes = (value: string) => new TextEncoder().encode(value)
function project(root: string): Project {
  return {
    contents: {
      name: 'model',
      path: root,
      children: ['main.kcl', 'module.kcl', 'body.glb', 'large.mp4'].map(
        (name) => ({ name, path: `${root}/${name}`, children: null })
      ),
    },
    metadata: { title: 'Model', readWriteAccess: true },
  }
}
function setup() {
  const storage = {
    readFile: vi.fn(
      async (_path: string): Promise<Uint8Array> => bytes('stored')
    ),
    writeFile: vi.fn(async () => {}),
  }
  const projects = createProjectSessionService(storage)
  projects.openProject(project('/model'))
  const documents = signal<readonly Pick<Editor, 'src' | 'contents'>[]>([])
  const sources = createProjectSources(
    () => projects,
    () => documents.value
  )
  const cancellation = new AbortController()
  const request = {
    document: { src: '/model/main.kcl', contents: 'captured main' },
    unnamedPath: 'draft.txt',
    signal: cancellation.signal,
    include: (path: string) => !path.endsWith('.mp4'),
  }
  return { storage, projects, documents, sources, cancellation, request }
}
it('captures working documents before storage reads and preserves binary imports', async () => {
  const { storage, documents, sources, request } = setup()
  const imported = new Uint8Array([0, 255, 128, 42])
  storage.readFile.mockResolvedValue(imported)
  const text = signal('unsaved module')
  documents.value = [{ src: signal('/model/module.kcl'), contents: text }]
  const pending = sources.capture(request)
  text.value = 'later edit'
  const result = await pending
  if (result instanceof Error) return expect.fail(result.message)
  expect(new TextDecoder().decode(result.files.get('/model/main.kcl'))).toBe(
    'captured main'
  )
  expect(new TextDecoder().decode(result.files.get('/model/module.kcl'))).toBe(
    'unsaved module'
  )
  expect(result.files.get('/model/body.glb')).toEqual(
    new Uint8Array([0, 255, 128, 42])
  )
  imported.fill(0)
  expect(result.files.get('/model/body.glb')).toEqual(
    new Uint8Array([0, 255, 128, 42])
  )
  expect(storage.readFile).toHaveBeenCalledExactlyOnceWith('/model/body.glb')
})
it.each(['replace', 'close', 'abort', 'change membership'] as const)(
  'rejects an in-flight snapshot after %s without reading more files',
  async (action) => {
    const { storage, projects, sources, request, cancellation } = setup()
    const read = Promise.withResolvers<Uint8Array>()
    storage.readFile.mockReturnValue(read.promise)
    const pending = sources.capture(request)
    if (action === 'replace') projects.openProject(project('/other'))
    if (action === 'close') projects.closeProject()
    if (action === 'abort') cancellation.abort()
    if (action === 'change membership') {
      const owner = projects.currentSession.peek()!
      const next = project('/model')
      next.contents.children = []
      projects.updateProject(owner, next)
    }
    read.resolve(bytes('old module'))
    expect(await pending).toBeInstanceOf(Error)
    expect(storage.readFile).toHaveBeenCalledExactlyOnceWith(
      '/model/module.kcl'
    )
  }
)
it('returns storage failures without publishing an incomplete snapshot', async () => {
  const { storage, sources, request } = setup()
  const error = new Error('Permission denied')
  storage.readFile.mockRejectedValue(error)
  expect(await sources.capture(request)).toBe(error)
})
it('supports unnamed documents and rejects cancelled captures without storage', async () => {
  const { projects, sources, request, cancellation, storage } = setup()
  projects.closeProject()
  const scratch = { ...request, document: { contents: 'unsaved draft' } }
  const result = await sources.capture(scratch)
  if (result instanceof Error) return expect.fail(result.message)
  expect(result.src).toBe('draft.txt')
  expect(result.files.get('draft.txt')).toEqual(bytes('unsaved draft'))
  cancellation.abort()
  expect(await sources.capture(scratch)).toBeInstanceOf(Error)
  expect(storage.readFile).not.toHaveBeenCalled()
})
it('rejects a named entrypoint removed from its captured project before reading', async () => {
  const { sources, request, storage } = setup()
  expect(
    await sources.capture({
      ...request,
      document: { src: '/model/deleted.kcl', contents: 'deleted' },
    })
  ).toBeInstanceOf(Error)
  expect(storage.readFile).not.toHaveBeenCalled()
})
it('invalidates readers for source changes while ignoring metadata-only updates', () => {
  const { projects, documents, sources } = setup()
  const contents = signal('original'),
    src = signal('/model/module.kcl')
  documents.value = [{ src, contents }]
  const original = sources.revision.value
  contents.value = 'unsaved edit'
  const edited = sources.revision.value
  expect(edited).not.toBe(original)
  src.value = '/model/renamed.kcl'
  const renamed = sources.revision.value
  expect(renamed).not.toBe(edited)
  projects.updateMetadata(projects.currentSession.peek()!, {
    title: 'New title',
  })
  expect(sources.revision.value).toBe(renamed)
  projects.openProject(project('/other'))
  expect(sources.revision.value).not.toBe(renamed)
})

import { signal } from '@preact/signals-core'
import type { Editor } from '@src/lib/editors/registry/contract'
import type { ExecutorRunContext } from '@src/lib/executors/registry/contract'
import { loadKclSources } from '@src/lib/kcl/sources'
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
  const projects = createProjectSessionService(() => storage)
  projects.openProject(project('/model'))
  const context = {
    src: '/model/main.kcl',
    signal: new AbortController().signal,
  } as ExecutorRunContext
  return { storage, projects, context }
}
it('captures unsaved modules and entrypoint contents while preserving binary imports', async () => {
  const { storage, projects, context } = setup()
  const imported = new Uint8Array([0, 255, 128, 42])
  storage.readFile.mockResolvedValue(imported)
  const text = signal('unsaved module')
  const editor = {
    src: signal('/model/module.kcl'),
    contents: text,
  } as unknown as Editor
  const pending = loadKclSources(
    'captured main',
    context,
    projects,
    [editor],
    storage,
    (path) => !path.endsWith('.mp4')
  )
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
it('rejects a snapshot if its project is replaced while reading', async () => {
  const { storage, projects, context } = setup()
  const read = Promise.withResolvers<Uint8Array>()
  storage.readFile.mockReturnValue(read.promise)
  const pending = loadKclSources('main', context, projects, [], storage)
  projects.openProject(project('/other'))
  read.resolve(bytes('old module'))
  expect(await pending).toBeInstanceOf(Error)
  expect(storage.readFile).toHaveBeenCalledExactlyOnceWith('/model/module.kcl')
})
it('returns read failures without executing an incomplete project', async () => {
  const { storage, projects, context } = setup()
  const error = new Error('Permission denied')
  storage.readFile.mockRejectedValue(error)
  expect(await loadKclSources('main', context, projects, [], storage)).toBe(
    error
  )
})
it('supports an unnamed KCL buffer independently of a selected project', async () => {
  const { storage, projects, context } = setup()
  const result = await loadKclSources(
    'answer = 42',
    { ...context, src: '' },
    projects,
    [],
    storage
  )
  if (result instanceof Error) return expect.fail(result.message)
  expect(result.src).toBe('main.kcl')
  expect(new TextDecoder().decode(result.files.get('main.kcl'))).toBe(
    'answer = 42'
  )
})

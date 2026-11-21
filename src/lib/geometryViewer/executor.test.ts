import { signal } from '@preact/signals-core'
import { createGeometryExecution } from '@src/lib/geometryViewer/executor'
import { isGeometryFile } from '@src/lib/geometryViewer/formats'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import type { Project } from '@src/lib/projectSession/next/types'
import type { ExecutorRunContext } from '@src/lib/executors/registry/contract'
import { expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('node:path')).posix,
}))
function setup(path = '/model/parts/body.glb') {
  const original = new Uint8Array([0, 255, 128, 42])
  const storage = {
    readFile: vi.fn(async (): Promise<Uint8Array> => original),
    writeFile: vi.fn(async () => {}),
  }
  const projects = createProjectSessionService(storage)
  const project: Project = {
    contents: {
      name: 'model',
      path: '/model',
      children: [
        path,
        '/model/buffers/body.bin',
        '/model/other.step',
        `${path}.viewer.kcl`,
      ].map((path) => ({ name: path, path, children: null })),
    },
    metadata: { title: 'Model', readWriteAccess: true },
  }
  projects.openProject(project)
  const capability = createGeometryExecution(() => projects, signal(0))
  const cancellation = new AbortController()
  const context = {
    src: path,
    signal: cancellation.signal,
  } as ExecutorRunContext
  return {
    capability,
    context,
    original,
    projects,
    project,
    storage,
    cancellation,
  }
}
it('preserves original binary bytes and gives the virtual program an unused path', async () => {
  const { capability, context, original, storage } = setup()
  const result = await capability.execute('lossy decoded text', context)
  if (result instanceof Error) return expect.fail(result.message)
  expect(result.sources.files.get('/model/parts/body.glb')).toEqual(
    new Uint8Array([0, 255, 128, 42])
  )
  original.fill(0)
  expect(result.sources.files.get('/model/parts/body.glb')).toEqual(
    new Uint8Array([0, 255, 128, 42])
  )
  expect(result.sources.src).toBe('/model/parts/body.glb.viewer.kcl.kcl')
  expect(
    new TextDecoder().decode(result.sources.files.get(result.sources.src))
  ).toBe('@settings(kclVersion = 3.0)\nimport "body.glb" as previewModel\n')
  expect(storage.readFile).toHaveBeenCalledExactlyOnceWith(
    '/model/parts/body.glb'
  )
  expect(storage.writeFile).not.toHaveBeenCalled()
})
it('captures glTF external buffers without decoding them', async () => {
  const { capability, context } = setup('/model/parts/body.gltf')
  const result = await capability.execute('', context)
  if (result instanceof Error) return expect.fail(result.message)
  expect([...result.sources.files.keys()]).toEqual([
    '/model/parts/body.gltf',
    '/model/buffers/body.bin',
    '/model/parts/body.gltf.viewer.kcl.kcl',
  ])
})
it.each(['abort', 'switch project', 'remove file'])(
  'rejects a pending capture after %s',
  async (change) => {
    const { capability, context, storage, cancellation, projects, project } =
      setup()
    const pending = Promise.withResolvers<Uint8Array>()
    storage.readFile.mockReturnValue(pending.promise)
    const result = capability.execute('', context)
    if (change === 'abort') cancellation.abort()
    if (change === 'switch project') projects.openProject(project)
    if (change === 'remove file')
      projects.updateProject(projects.currentSession.peek()!, {
        ...project,
        contents: { ...project.contents, children: [] },
      })
    pending.resolve(new Uint8Array([255]))
    expect(await result).toBeInstanceOf(Error)
  }
)
it.each([
  'part.STEP',
  'part.stp',
  'part.glb',
  'part.fbxb',
  'part.3dm',
  'part.x_t',
  'part.CATPart',
  'part.prt.23',
])('recognizes native import filename %s', (path) => {
  expect(isGeometryFile(path)).toBe(true)
})
it.each([
  'part.kcl',
  'part.dxf',
  'part.png',
  'part.prt.0',
  '.prt.1',
  'part.prt.1.bak',
])('leaves unsupported filename %s to other views', (path) => {
  expect(isGeometryFile(path)).toBe(false)
})

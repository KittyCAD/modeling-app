import type { FileContents } from '@src/lib/fileSystem/fileOperations'
import type { Project } from '@src/lib/projectSession/next/types'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted((): { value: 'posix' | 'win32' } => ({
  value: 'posix',
}))
vi.mock('@src/lib/fs-zds', async () => {
  const paths = await import('node:path')
  return {
    default: {
      resolve: (...parts: string[]) => paths[platform.value].resolve(...parts),
      relative: (root: string, path: string) =>
        paths[platform.value].relative(root, path),
      get sep() {
        return paths[platform.value].sep
      },
    },
  }
})

function project(path: string, canWrite = true): Project {
  return {
    contents: { name: 'project', path, children: [] },
    metadata: { title: 'Project', readWriteAccess: canWrite },
  }
}

function setup() {
  const storage = {
    readFile: vi.fn(
      async (_path: string): Promise<Uint8Array> =>
        new TextEncoder().encode('contents')
    ),
    writeFile: vi.fn(async (_path: string, _contents: FileContents) => {}),
  }
  const service = createProjectSessionService(() => storage)
  return { storage, service }
}

describe('project sessions', () => {
  beforeEach(() => {
    platform.value = 'posix'
  })

  it('lists all nested files without filtering formats or accessing storage', () => {
    const { storage, service } = setup()
    const main = { name: 'main.kcl', path: '/project/main.kcl', children: null }
    const image = {
      name: 'image.png',
      path: '/project/assets/image.png',
      children: null,
    }
    const unknown = {
      name: 'file.unknown',
      path: '/project/assets/file.unknown',
      children: null,
    }
    const current = project('/project')
    current.contents.children = [
      main,
      { name: 'assets', path: '/project/assets', children: [image, unknown] },
      { name: 'empty.txt', path: '/project/empty.txt', children: [] },
    ]
    service.openProject(current)
    expect(service.listFiles()).toEqual([main, image, unknown])
    expect(service.listFiles()[0]).toBe(main)
    expect(current.contents.children).toHaveLength(3)
    expect(storage.readFile).not.toHaveBeenCalled()
    expect(storage.writeFile).not.toHaveBeenCalled()
  })

  it('lists only the currently selected project and returns no files when closed', () => {
    const { service } = setup()
    expect(service.listFiles()).toEqual([])
    const first = project('/first')
    first.contents.children = [
      { name: 'main.kcl', path: '/first/main.kcl', children: null },
    ]
    service.openProject(first)
    const firstFiles = service.listFiles()
    service.openProject(project('/second'))
    expect(service.listFiles()).toEqual([])
    expect(firstFiles).toEqual(first.contents.children)
    service.openProject(first)
    service.closeProject()
    expect(service.listFiles()).toEqual([])
  })

  it('binds reads and writes to the captured project root', async () => {
    const { storage, service } = setup()
    const first = service.openProject(project('/first'))
    expect(service.currentSession.value).toBe(first)
    expect(service.currentProject.value).toBe(first.project.value)
    await expect(first.files.read('nested/main.kcl')).resolves.toBe('contents')
    await first.files.write('nested/main.kcl', 'first edit')
    expect(storage.readFile).toHaveBeenCalledWith('/first/nested/main.kcl')
    expect(storage.writeFile).toHaveBeenCalledWith(
      '/first/nested/main.kcl',
      'first edit'
    )
    const second = service.openProject(project('/second'))
    await second.files.write('main.kcl', 'second edit')
    await first.files.write('main.kcl', 'first project edit')
    service.closeProject()
    expect(service.currentSession.value).toBeUndefined()
    expect(service.currentProject.value).toBeUndefined()
    await second.files.write('main.kcl', 'second project edit')
    expect(storage.writeFile.mock.calls).toEqual([
      ['/first/nested/main.kcl', 'first edit'],
      ['/second/main.kcl', 'second edit'],
      ['/first/main.kcl', 'first project edit'],
      ['/second/main.kcl', 'second project edit'],
    ])
  })

  it('prevents writes through a read-only opening', async () => {
    const { storage, service } = setup()
    const owner = service.openProject(project('/first', false))
    await expect(owner.files.read('main.kcl')).resolves.toBe('contents')
    await expect(owner.files.write('main.kcl', 'edit')).rejects.toThrow(
      'read-only'
    )
    expect(storage.writeFile).not.toHaveBeenCalled()
  })

  it.each([
    '',
    '..',
    '../other/main.kcl',
    'nested/../../other.kcl',
    '/other/main.kcl',
    'C:\\other\\main.kcl',
    '\\\\server\\share\\main.kcl',
  ])('rejects paths outside the scoped project: %s', async (path) => {
    const { storage, service } = setup()
    const owner = service.openProject(project('/first'))
    await expect(owner.files.read(path)).rejects.toBeInstanceOf(Error)
    await expect(owner.files.write(path, 'edit')).rejects.toBeInstanceOf(Error)
    expect(storage.readFile).not.toHaveBeenCalled()
    expect(storage.writeFile).not.toHaveBeenCalled()
  })

  it('resolves scoped paths and rejects traversal on Windows', async () => {
    platform.value = 'win32'
    const { storage, service } = setup()
    const owner = service.openProject(project('C:\\projects\\first'))
    await owner.files.read('nested/main.kcl')
    expect(storage.readFile).toHaveBeenCalledExactlyOnceWith(
      'C:\\projects\\first\\nested\\main.kcl'
    )
    await expect(
      owner.files.write('..\\second\\main.kcl', 'edit')
    ).rejects.toBeInstanceOf(Error)
    expect(storage.writeFile).not.toHaveBeenCalled()
  })
})

it('gives each opening a lifetime that aborts once on replacement or close', () => {
  const { service } = setup()
  const first = service.openProject(project('/first'))
  const firstClosed = vi.fn()
  first.signal.addEventListener('abort', firstClosed)
  const second = service.openProject(project('/second'))
  expect(first.signal.aborted).toBe(true)
  expect(firstClosed).toHaveBeenCalledOnce()
  expect(second.signal.aborted).toBe(false)
  const secondClosed = vi.fn()
  second.signal.addEventListener('abort', secondClosed)
  service.closeProject()
  service.closeProject()
  expect(second.signal.aborted).toBe(true)
  expect(secondClosed).toHaveBeenCalledOnce()
  expect(firstClosed).toHaveBeenCalledOnce()
})

it('publishes metadata updates only to the captured current opening and preserves storage metadata', () => {
  const { service } = setup()
  const data = project('/project', false)
  data.metadata.defaultFile = 'old.kcl'
  const first = service.openProject(data)
  service.updateMetadata(first, { title: 'Updated', defaultFile: undefined })
  expect(service.currentProject.value?.metadata).toEqual({
    title: 'Updated',
    defaultFile: undefined,
    readWriteAccess: false,
  })
  const second = service.openProject(project('/project'))
  service.updateMetadata(first, { title: 'Stale update' })
  expect(second.project.value.metadata.title).toBe('Project')
  service.closeProject()
  service.updateMetadata(second, { title: 'Closed update' })
  expect(second.project.value.metadata.title).toBe('Project')
})

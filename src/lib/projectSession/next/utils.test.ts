import { readProject } from '@src/lib/projectSession/next/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', async () => {
  const { posix } = await import('node:path')
  return {
    default: {
      join: (...parts: string[]) => posix.join(...parts),
      basename: (path: string) => posix.basename(path),
    },
  }
})

vi.mock('@src/lib/desktop', () => ({
  isPathNotFoundError: (error: unknown) =>
    error instanceof Error && error.message === 'ENOENT',
}))

const root = { name: 'bracket', path: '/projects/bracket', children: [] }
const operations = {
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
  readDirectory: vi.fn(async (): Promise<string[]> => []),
  readFile: vi.fn(async () => new TextEncoder().encode('title = "Bracket"')),
  canReadWrite: vi.fn(async () => true),
  writeFile: vi.fn(),
  createFile: vi.fn(),
  createDirectory: vi.fn(),
}

describe('readProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    operations.readFile.mockResolvedValue(
      new TextEncoder().encode('title = "Bracket"')
    )
    operations.canReadWrite.mockResolvedValue(true)
  })

  it('reads root configuration and retains library/access metadata without writes', async () => {
    const library = { libraryPath: '/projects', libraryType: 'directory' }
    const project = await readProject(operations, root.path, { library })
    expect(project).toMatchObject({
      contents: root,
      metadata: { title: 'Bracket', library, readWriteAccess: true },
    })
    expect(operations.readFile).toHaveBeenCalledExactlyOnceWith(
      '/projects/bracket/project.toml'
    )
    expect(operations.writeFile).not.toHaveBeenCalled()
    expect(operations.createFile).not.toHaveBeenCalled()
    expect(operations.createDirectory).not.toHaveBeenCalled()
  })

  it('opens an empty read-only folder without configuration or generated files', async () => {
    operations.readFile.mockRejectedValueOnce(new Error('ENOENT'))
    operations.canReadWrite.mockResolvedValueOnce(false)
    const project = await readProject(operations, root.path)
    expect(project.contents.children).toEqual([])
    expect(project.metadata).toEqual({
      title: 'bracket',
      readWriteAccess: false,
    })
    expect(operations.writeFile).not.toHaveBeenCalled()
    expect(operations.createFile).not.toHaveBeenCalled()
  })

  it('retains the configured project-relative default file for initial editor selection', async () => {
    operations.readFile.mockResolvedValueOnce(
      new TextEncoder().encode(
        'title = "Bracket"\ndefault_file = "./nested/part.kcl"'
      )
    )
    const project = await readProject(operations, root.path)
    expect(project.metadata.defaultFile).toBe('nested/part.kcl')
    expect(operations.readFile).toHaveBeenCalledTimes(1)
  })

  it.each(['title = [', 'title = 123'])(
    'rejects malformed configuration: %s',
    async (toml) => {
      operations.readFile.mockResolvedValueOnce(new TextEncoder().encode(toml))
      await expect(readProject(operations, root.path)).rejects.toBeInstanceOf(
        Error
      )
    }
  )

  it('propagates permission failures rather than treating them as missing config', async () => {
    const failure = new Error('EACCES')
    operations.readFile.mockRejectedValueOnce(failure)
    await expect(readProject(operations, root.path)).rejects.toBe(failure)
  })

  it('does not return project data when navigation aborts during a read', async () => {
    const controller = new AbortController()
    operations.readFile.mockImplementationOnce(async () => {
      controller.abort()
      return new TextEncoder().encode('title = "Abandoned"')
    })
    await expect(
      readProject(operations, root.path, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

it('records directory, cyclic, and dangling links as leaves without traversing their targets', async () => {
  const fs = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { default: nodeFileSystem } = await import('@src/lib/fs-zds/nodefs')
  const { createFileOperationsRuntime } = await import(
    '@src/lib/fileSystem/runtime'
  )
  const { getProjectContents } = await import(
    '@src/lib/projectSession/next/utils'
  )
  const temporary = await fs.mkdtemp(path.join(tmpdir(), 'zds-project-links-'))
  const runtime = createFileOperationsRuntime(nodeFileSystem.impl)
  try {
    const project = path.join(temporary, 'project')
    const outside = path.join(temporary, 'outside')
    await fs.mkdir(project)
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'private.kcl'), 'outside contents')
    await fs.writeFile(path.join(project, 'main.kcl'), 'project contents')
    await fs.symlink(outside, path.join(project, 'external'), 'junction')
    await fs.symlink(project, path.join(project, 'self'), 'junction')
    await fs.symlink(
      path.join(temporary, 'missing'),
      path.join(project, 'dangling'),
      'junction'
    )
    const readDirectory = vi.spyOn(runtime.operations, 'readDirectory')
    const contents = await getProjectContents(runtime.operations, project)
    expect(
      contents.children
        .map(({ name, children }) => ({ name, children }))
        .sort((a, b) => a.name.localeCompare(b.name))
    ).toEqual([
      { name: 'dangling', children: null },
      { name: 'external', children: null },
      { name: 'main.kcl', children: null },
      { name: 'self', children: null },
    ])
    expect(readDirectory).toHaveBeenCalledExactlyOnceWith(project)
    // Ordinary stat callers retain their existing target-following behavior.
    expect(
      (await runtime.operations.stat(path.join(project, 'external'))).kind
    ).toBe('directory')
  } finally {
    await runtime.dispose()
    await fs.rm(temporary, { recursive: true, force: true })
  }
})

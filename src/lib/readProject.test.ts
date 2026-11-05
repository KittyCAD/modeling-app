import { readProject } from '@src/lib/readProject'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', async () => {
  const { posix } = await import('node:path')
  return { default: { join: (...parts: string[]) => posix.join(...parts) } }
})

const { getProjectContents } = vi.hoisted(() => ({
  getProjectContents: vi.fn(),
}))
vi.mock('@src/lib/desktop', () => ({
  getProjectContents,
  isPathNotFoundError: (error: unknown) =>
    error instanceof Error && error.message === 'ENOENT',
}))

const root = { name: 'bracket', path: '/projects/bracket', children: [] }
const operations = {
  stat: vi.fn(),
  readDirectory: vi.fn(),
  readFile: vi.fn(async () => new TextEncoder().encode('title = "Bracket"')),
  canReadWrite: vi.fn(async () => true),
  writeFile: vi.fn(),
  createFile: vi.fn(),
  createDirectory: vi.fn(),
}

describe('readProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProjectContents.mockResolvedValue(root)
    operations.readFile.mockResolvedValue(
      new TextEncoder().encode('title = "Bracket"')
    )
    operations.canReadWrite.mockResolvedValue(true)
  })

  it('reads root configuration and retains library/access metadata without writes', async () => {
    const library = { libraryPath: '/projects', libraryType: 'directory' }
    const project = await readProject(operations, root.path, { library })
    expect(project).toEqual({
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

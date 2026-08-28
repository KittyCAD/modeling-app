import { describe, expect, it } from 'vitest'
import { createFilesystemResponder } from '@src/features/kclLsp/filesystemRequests'
import { createFakeFileSystem } from '@src/test/fakeFileSystem'

function setup(projectPath: string | null = '/projects/bracket') {
  const fileSystem = createFakeFileSystem({
    '/projects/bracket/main.kcl': 'thickness = 4',
    '/projects/bracket/parts/lid.kcl': '// lid',
    '/projects/secrets.kcl': 'nobody asked for this',
  })

  return {
    fileSystem,
    respond: createFilesystemResponder({
      fileSystem: () => fileSystem,
      projectPath: () => projectPath,
    }),
  }
}

describe('filesystem requests', () => {
  it('reads a project-relative path as text', async () => {
    const { respond } = setup()
    await expect(respond('readTextFile', 'main.kcl')).resolves.toBe(
      'thickness = 4'
    )
  })

  it('accepts an absolute path inside the project', async () => {
    const { respond } = setup()
    await expect(
      respond('readTextFile', '/projects/bracket/parts/lid.kcl')
    ).resolves.toBe('// lid')
  })

  /**
   * The server is a WASM blob that talks to an API. "Read this absolute path" is
   * not a question it gets to ask, and `..` is the way it would ask it.
   */
  it('refuses to read outside the project', async () => {
    const { respond } = setup()

    await expect(respond('readTextFile', '../secrets.kcl')).rejects.toThrow(
      /outside the project/
    )
    await expect(
      respond('readTextFile', '/projects/secrets.kcl')
    ).rejects.toThrow(/outside the project/)
  })

  it('refuses everything when no project is open', async () => {
    const { respond } = setup(null)
    await expect(respond('exists', 'main.kcl')).rejects.toThrow(
      /No project is open/
    )
  })

  it('answers existence', async () => {
    const { respond } = setup()
    await expect(respond('exists', 'main.kcl')).resolves.toBe(true)
    await expect(respond('exists', 'nope.kcl')).resolves.toBe(false)
  })

  it('lists every file underneath, at any depth', async () => {
    const { respond } = setup()
    // Directory order, depth first: the fake lists entries alphabetically, so
    // `main.kcl` comes before the `parts` it descends into.
    await expect(respond('getAllFiles', '')).resolves.toEqual([
      '/projects/bracket/main.kcl',
      '/projects/bracket/parts/lid.kcl',
    ])
  })

  it('reads bytes as a transferable buffer', async () => {
    const { respond } = setup()
    const result = await respond('readFile', 'main.kcl')

    expect(result).toBeInstanceOf(ArrayBuffer)
    expect(new TextDecoder().decode(result as ArrayBuffer)).toBe(
      'thickness = 4'
    )
  })
})

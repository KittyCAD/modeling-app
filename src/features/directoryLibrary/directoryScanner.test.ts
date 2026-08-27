import { describe, expect, it } from 'vitest'
import {
  parseProjectTitle,
  pickDefaultFile,
  readDirectoryLibraryRealizations,
} from '@src/features/directoryLibrary/directoryScanner'
import { createFakeFileSystem } from '@src/test/fakeFileSystem'

const scan = (
  files: Record<string, string>,
  libraryPath = '/projects',
  modifiedTimes?: Record<string, number>
) =>
  readDirectoryLibraryRealizations({
    fileSystem: createFakeFileSystem(files, { modifiedTimes }),
    libraryPath,
    signal: new AbortController().signal,
  })

describe('parseProjectTitle', () => {
  it('reads a top-level title', () => {
    expect(parseProjectTitle('title = "Mounting Bracket"')).toBe(
      'Mounting Bracket'
    )
  })

  it('accepts single quotes and stray whitespace', () => {
    expect(parseProjectTitle("  title   =  'Bracket'  ")).toBe('Bracket')
  })

  it('ignores a title inside a table', () => {
    // Only the top-level key is the project title.
    expect(
      parseProjectTitle('[settings]\ntitle = "Not the project title"')
    ).toBeUndefined()
  })

  it('returns nothing for an empty or absent title', () => {
    expect(parseProjectTitle('title = ""')).toBeUndefined()
    expect(parseProjectTitle('other = 1')).toBeUndefined()
  })
})

describe('pickDefaultFile', () => {
  it('prefers main.kcl at the root', () => {
    expect(pickDefaultFile(['parts/a.kcl', 'main.kcl', 'b.kcl'])).toBe(
      'main.kcl'
    )
  })

  it('falls back to the first root-level file', () => {
    expect(pickDefaultFile(['parts/a.kcl', 'b.kcl'])).toBe('b.kcl')
  })

  it('prefers the shallowest file when none are at the root', () => {
    // Depth beats alphabetical, so a nested file is not chosen over a closer one.
    expect(pickDefaultFile(['a/b/c/deep.kcl', 'z/near.kcl'])).toBe('z/near.kcl')
  })

  it('returns nothing when there is no KCL at all', () => {
    expect(pickDefaultFile([])).toBeUndefined()
  })
})

describe('readDirectoryLibraryRealizations', () => {
  it('finds each immediate subdirectory holding KCL', async () => {
    const found = await scan({
      '/projects/bracket/main.kcl': '',
      '/projects/enclosure/main.kcl': '',
    })

    expect(found.map((r) => r.name).toSorted()).toEqual([
      'bracket',
      'enclosure',
    ])
  })

  it('skips folders with no KCL in them', async () => {
    // An unrelated folder the user keeps alongside their projects must not
    // appear as an empty project card.
    const found = await scan({
      '/projects/bracket/main.kcl': '',
      '/projects/notes/todo.txt': '',
    })

    expect(found.map((r) => r.name)).toEqual(['bracket'])
  })

  it('skips dotfolders', async () => {
    const found = await scan({
      '/projects/.trash/main.kcl': '',
      '/projects/bracket/main.kcl': '',
    })
    expect(found.map((r) => r.name)).toEqual(['bracket'])
  })

  it('counts files, KCL files, and directories recursively', async () => {
    const [found] = await scan({
      '/projects/bracket/main.kcl': '',
      '/projects/bracket/README.md': '',
      '/projects/bracket/parts/lid.kcl': '',
      '/projects/bracket/parts/body.kcl': '',
    })

    expect(found.fileCount).toBe(4)
    expect(found.kclFileCount).toBe(3)
    expect(found.directoryCount).toBe(1)
  })

  it('reads a title from project.toml, keeping the folder name too', async () => {
    const [found] = await scan({
      '/projects/bracket-v2/main.kcl': '',
      '/projects/bracket-v2/project.toml': 'title = "Mounting Bracket"',
    })

    expect(found.name).toBe('bracket-v2')
    expect(found.title).toBe('Mounting Bracket')
  })

  it('falls back to the folder name when metadata is unusable', async () => {
    const [found] = await scan({
      '/projects/bracket/main.kcl': '',
      '/projects/bracket/project.toml': 'not = valid = toml',
    })

    expect(found.title).toBeUndefined()
    expect(found.name).toBe('bracket')
  })

  it('nominates a default file to open', async () => {
    const [found] = await scan({
      '/projects/bracket/parts/lid.kcl': '',
      '/projects/bracket/main.kcl': '',
    })
    expect(found.defaultFile).toBe('main.kcl')
  })

  it('mints a path-derived id', async () => {
    const [found] = await scan({ '/projects/bracket/main.kcl': '' })
    expect(found.id).toBe('local:/projects/bracket')
    expect(found.path).toBe('/projects/bracket')
  })

  it('carries the folder modified time', async () => {
    const [found] = await scan(
      { '/projects/bracket/main.kcl': '' },
      '/projects',
      { '/projects/bracket': 42 }
    )
    expect(found.modifiedAt).toBe(42)
  })

  it('skips excluded paths, which are nested library roots', async () => {
    const found = await readDirectoryLibraryRealizations({
      fileSystem: createFakeFileSystem({
        '/projects/bracket/main.kcl': '',
        '/projects/client/widget/main.kcl': '',
      }),
      libraryPath: '/projects',
      signal: new AbortController().signal,
      excludePaths: ['/projects/client'],
    })

    expect(found.map((r) => r.name)).toEqual(['bracket'])
  })

  it('returns nothing for an empty library rather than failing', async () => {
    expect(await scan({}, '/empty')).toEqual([])
  })

  it('stops early when the scan is aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const found = await readDirectoryLibraryRealizations({
      fileSystem: createFakeFileSystem({
        '/projects/bracket/main.kcl': '',
      }),
      libraryPath: '/projects',
      signal: controller.signal,
    })

    expect(found).toEqual([])
  })
})

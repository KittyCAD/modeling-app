import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIBRARY_ID,
  DIRECTORY_LIBRARY_TYPE,
  type ProjectLibrarySetting,
  combineRealizations,
  containingLibrary,
  librariesFromSettings,
  libraryIdFromSetting,
  mergeProjectLibrarySettings,
  moveProjectLibrarySetting,
  parseProjectLibrarySettings,
  realizationsForLibrary,
} from '@src/lib/projectLibraries'

const directory = (
  title: string,
  path: string,
  extra: Partial<ProjectLibrarySetting> = {}
): ProjectLibrarySetting => ({
  title,
  path,
  type: DIRECTORY_LIBRARY_TYPE,
  ...extra,
})

describe('library identity', () => {
  it('derives a stable id from type, path, and source', () => {
    const setting = directory('Work', '/work')
    expect(libraryIdFromSetting(setting)).toBe(libraryIdFromSetting(setting))
    expect(libraryIdFromSetting(setting)).toMatch(/^directory-/)
  })

  it('separates libraries that differ only by source', () => {
    expect(libraryIdFromSetting(directory('A', '/p'))).not.toBe(
      libraryIdFromSetting(directory('A', '/p', { source: 'remote' }))
    )
  })

  it('ignores path spelling differences', () => {
    // A trailing slash or a backslash must not create a second library.
    expect(libraryIdFromSetting(directory('A', '/p/'))).toBe(
      libraryIdFromSetting(directory('A', '/p'))
    )
  })

  it('ignores the title, which the user can rename freely', () => {
    expect(libraryIdFromSetting(directory('Before', '/p'))).toBe(
      libraryIdFromSetting(directory('After', '/p'))
    )
  })

  it('gives the library at the default root a fixed id', () => {
    const libraries = librariesFromSettings(
      [directory('Local', '/home/projects'), directory('Work', '/work')],
      { defaultRoot: '/home/projects' }
    )

    // Stable, so the URL of someone's main library survives adding another.
    expect(libraries[0].id).toBe(DEFAULT_LIBRARY_ID)
    expect(libraries[1].id).not.toBe(DEFAULT_LIBRARY_ID)
  })

  it('assigns the fixed id to only one library', () => {
    const libraries = librariesFromSettings(
      [directory('A', '/root'), directory('B', '/root/')],
      { defaultRoot: '/root' }
    )
    expect(libraries.filter((l) => l.id === DEFAULT_LIBRARY_ID)).toHaveLength(1)
  })

  it('records configured order', () => {
    const libraries = librariesFromSettings([
      directory('A', '/a'),
      directory('B', '/b'),
    ])
    expect(libraries.map((library) => library.order)).toEqual([0, 1])
  })
})

describe('settings parsing', () => {
  it('keeps valid entries and drops malformed ones', () => {
    const parsed = parseProjectLibrarySettings([
      directory('Good', '/good'),
      { title: '', path: '/bad', type: 'directory' },
      { title: 'No path', type: 'directory' },
      'nonsense',
      null,
    ])

    // One bad entry from an older build costs that library, not every library.
    expect(parsed.map((library) => library.title)).toEqual(['Good'])
  })

  it('normalizes paths and trims titles on the way in', () => {
    const [parsed] = parseProjectLibrarySettings([
      { title: '  Work  ', path: 'C:\\projects\\', type: 'directory' },
    ])
    expect(parsed.title).toBe('Work')
    expect(parsed.path).toBe('C:/projects')
  })

  it('drops a blank source rather than storing it', () => {
    const [parsed] = parseProjectLibrarySettings([
      { title: 'A', path: '/a', type: 'directory', source: '   ' },
    ])
    expect(parsed.source).toBeUndefined()
  })

  it('returns nothing for a non-list', () => {
    expect(parseProjectLibrarySettings({ nope: true })).toEqual([])
  })
})

describe('merging settings', () => {
  it('lets a later entry win on the same type, path, and source', () => {
    const merged = mergeProjectLibrarySettings(
      [directory('Default', '/projects')],
      [directory('Renamed', '/projects')]
    )

    expect(merged).toHaveLength(1)
    expect(merged[0].title).toBe('Renamed')
  })

  it('keeps libraries that differ by path', () => {
    expect(
      mergeProjectLibrarySettings(
        [directory('A', '/a')],
        [directory('B', '/b')]
      )
    ).toHaveLength(2)
  })

  it('treats equivalent path spellings as the same library', () => {
    expect(
      mergeProjectLibrarySettings(
        [directory('A', '/a')],
        [directory('B', '/a/')]
      )
    ).toHaveLength(1)
  })

  it('reorders without losing entries', () => {
    const settings = [
      directory('A', '/a'),
      directory('B', '/b'),
      directory('C', '/c'),
    ]
    expect(
      moveProjectLibrarySetting(settings, 2, 0).map((l) => l.title)
    ).toEqual(['C', 'A', 'B'])
  })

  it('ignores an out-of-range reorder', () => {
    const settings = [directory('A', '/a')]
    expect(moveProjectLibrarySetting(settings, 0, 5)).toEqual(settings)
  })
})

describe('combining realizations', () => {
  const realization = (path: string, libraryId: string, extra = {}) => ({
    path,
    libraryId,
    name: path.slice(path.lastIndexOf('/') + 1),
    modifiedAt: 0,
    fileCount: 1,
    kclFileCount: 1,
    directoryCount: 0,
    readWriteAccess: true,
    ...extra,
  })

  it('identifies a project by its folder, not by its library', () => {
    const combined = combineRealizations([
      realization('/projects/bracket', 'library-a'),
    ])
    expect(combined[0].id).toBe('local:/projects/bracket')
  })

  it('merges overlapping libraries into one project with both memberships', () => {
    // Two libraries whose paths overlap see the same folder. That must be one
    // card belonging to both, not two competing entries.
    const combined = combineRealizations([
      realization('/projects/bracket', 'outer'),
      realization('/projects/bracket', 'inner'),
    ])

    expect(combined).toHaveLength(1)
    expect(combined[0].libraryIds).toEqual(['outer', 'inner'])
  })

  it('treats equivalent path spellings as the same project', () => {
    const combined = combineRealizations([
      realization('/projects/bracket', 'a'),
      realization('/projects/bracket/', 'b'),
    ])
    expect(combined).toHaveLength(1)
  })

  it('lets the later contribution win on descriptive fields', () => {
    const combined = combineRealizations([
      realization('/p/x', 'a', { kclFileCount: 1 }),
      realization('/p/x', 'b', { kclFileCount: 7, title: 'Deep scan' }),
    ])

    expect(combined[0].kclFileCount).toBe(7)
    expect(combined[0].title).toBe('Deep scan')
  })

  it('filters realizations by library', () => {
    const combined = combineRealizations([
      realization('/p/a', 'one'),
      realization('/p/b', 'two'),
      realization('/p/c', 'one'),
    ])

    expect(realizationsForLibrary(combined, 'one').map((r) => r.name)).toEqual([
      'a',
      'c',
    ])
  })
})

describe('containing library', () => {
  const libraries = librariesFromSettings([
    directory('Outer', '/projects'),
    directory('Inner', '/projects/client'),
  ])

  it('picks the most specific library for a path', () => {
    // A nested library owns its own projects rather than the outer one
    // claiming them.
    expect(
      containingLibrary(libraries, '/projects/client/bracket')?.title
    ).toBe('Inner')
    expect(containingLibrary(libraries, '/projects/bracket')?.title).toBe(
      'Outer'
    )
  })

  it('returns nothing for a path outside every library', () => {
    expect(containingLibrary(libraries, '/elsewhere/thing')).toBeUndefined()
  })
})

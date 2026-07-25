import {
  combineProjectLibrarySettingDefaultPolicies,
  combineProjectLibrarySettingDefaults,
  combineProjectLibraryTypes,
  combineProjectLibraries,
  getHomeProjectEntriesForLibrary,
  getProjectLibraryOperation,
  resolveProjectLibrarySettingDefaults,
} from '@src/registry/contracts/projectLibraries'
import {
  DEFAULT_PROJECT_LIBRARY_ID,
  DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_PATH,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  getDefaultCloudProjectLibrarySetting,
  areProjectLibrarySettingsEqual,
  getContainingDirectoryProjectLibraryPath,
  getDefaultDirectoryProjectLibrarySetting,
  getDefaultDirectoryProjectLibraryPath,
  getProjectLibraryIdFromSetting,
  moveProjectLibrarySetting,
  normalizeProjectLibrarySetting,
  projectLibraryFromSetting,
  updateDefaultDirectoryProjectLibrarySetting,
  updateProjectLibrarySettingAt,
} from '@src/lib/projectLibraries'
import { describe, expect, test } from 'vitest'

describe('project library settings', () => {
  test('keeps library ids stable when only the title changes', () => {
    expect(
      getProjectLibraryIdFromSetting({
        title: 'Client A',
        path: '/projects/client-a',
        type: 'directory',
      })
    ).toBe(
      getProjectLibraryIdFromSetting({
        title: 'Renamed Client A',
        path: '/projects/client-a',
        type: 'directory',
      })
    )
  })

  test('maps the configured project directory to the default library id', () => {
    expect(
      projectLibraryFromSetting(
        {
          title: 'My Projects',
          path: '/projects',
          type: 'directory',
        },
        0,
        { defaultProjectDirectory: '/projects' }
      )
    ).toEqual(
      expect.objectContaining({
        id: DEFAULT_PROJECT_LIBRARY_ID,
      })
    )
  })

  test('maps the default cloud library to the stable cloud library id', () => {
    expect(
      projectLibraryFromSetting(getDefaultCloudProjectLibrarySetting())
    ).toEqual(
      expect.objectContaining({
        id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
        path: DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_PATH,
        type: 'cloud',
      })
    )
  })

  test('treats the first directory library as the default local project target', () => {
    const libraries = [
      {
        title: 'External',
        path: 'external://projects',
        type: 'external',
      },
      {
        title: 'Client Projects',
        path: '/client-projects',
        type: 'directory',
      },
      {
        title: 'Archive',
        path: '/archive',
        type: 'directory',
      },
    ]

    expect(getDefaultDirectoryProjectLibraryPath(libraries)).toBe(
      '/client-projects'
    )
    expect(getDefaultDirectoryProjectLibrarySetting(libraries)).toEqual({
      title: 'Client Projects',
      path: '/client-projects',
      type: 'directory',
    })
  })

  test('allows the project libraries setting to be absent', () => {
    expect(getDefaultDirectoryProjectLibraryPath(undefined)).toBeUndefined()
    expect(getDefaultDirectoryProjectLibrarySetting(undefined)).toBeUndefined()
  })

  test('finds the most specific directory library containing a project path', () => {
    expect(
      getContainingDirectoryProjectLibraryPath(
        [
          {
            title: 'Projects',
            path: '/projects',
            type: 'directory',
          },
          {
            title: 'Client Projects',
            path: '/projects/client',
            type: 'directory',
          },
          {
            title: 'External',
            path: 'external://projects',
            type: 'external',
          },
        ],
        '/projects/client/bracket'
      )
    ).toBe('/projects/client')
  })

  test('does not treat an empty directory library path as containing every path', () => {
    expect(
      getContainingDirectoryProjectLibraryPath(
        [
          {
            title: 'Empty Projects',
            path: '',
            type: 'directory',
          },
        ],
        '/projects/client/bracket'
      )
    ).toBeUndefined()
  })

  test('updates the first directory library without changing other libraries', () => {
    expect(
      updateDefaultDirectoryProjectLibrarySetting(
        [
          {
            title: 'Default',
            path: '/projects',
            type: 'directory',
          },
          {
            title: 'External',
            path: 'external://projects',
            type: 'external',
          },
        ],
        {
          title: 'Renamed',
          path: '/renamed',
        }
      )
    ).toEqual([
      {
        title: 'Renamed',
        path: '/renamed',
        type: 'directory',
      },
      {
        title: 'External',
        path: 'external://projects',
        type: 'external',
      },
    ])
  })

  test('normalizes project library settings using the matching type fallback', () => {
    expect(
      normalizeProjectLibrarySetting(
        {
          title: '  ',
          path: '  ',
          type: 'cloud',
        },
        {
          title: 'Cloud',
          path: 'zoo-cloud',
          type: 'cloud',
        }
      )
    ).toEqual({
      title: 'Cloud',
      path: 'zoo-cloud',
      type: 'cloud',
    })
  })

  test('compares project library settings by persisted fields and order', () => {
    const libraries = [
      {
        title: 'Projects',
        path: '/projects',
        type: 'directory',
      },
      {
        title: 'Cloud',
        path: 'zoo-cloud',
        type: 'cloud',
      },
    ]

    expect(areProjectLibrarySettingsEqual(libraries, [...libraries])).toBe(true)
    expect(
      areProjectLibrarySettingsEqual(libraries, [libraries[1], libraries[0]])
    ).toBe(false)
  })

  test('updates and moves project library settings without mutating the source list', () => {
    const libraries = [
      {
        title: 'Projects',
        path: '/projects',
        type: 'directory',
      },
      {
        title: 'Cloud',
        path: 'zoo-cloud',
        type: 'cloud',
      },
    ]

    expect(
      updateProjectLibrarySettingAt(libraries, 1, (library) => ({
        ...library,
        title: 'Personal Cloud',
      }))
    ).toEqual([
      libraries[0],
      {
        title: 'Personal Cloud',
        path: 'zoo-cloud',
        type: 'cloud',
      },
    ])
    expect(moveProjectLibrarySetting(libraries, 1, 0)).toEqual([
      libraries[1],
      libraries[0],
    ])
    expect(libraries).toEqual([
      {
        title: 'Projects',
        path: '/projects',
        type: 'directory',
      },
      {
        title: 'Cloud',
        path: 'zoo-cloud',
        type: 'cloud',
      },
    ])
  })
})

describe('combineProjectLibraries', () => {
  test('merges duplicate library contributions by id and sorts by order', () => {
    expect(
      combineProjectLibraries([
        {
          id: 'external',
          title: 'External',
          path: 'external://projects',
          type: 'external',
          order: 10,
        },
        {
          id: 'default-project-directory',
          title: 'Default Projects Directory',
          path: '/projects',
          type: 'directory',
          order: 0,
        },
        {
          id: 'external',
          title: 'External Projects',
          path: 'external://projects',
          type: 'external',
          order: 10,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: 'default-project-directory',
        title: 'Default Projects Directory',
      }),
      expect.objectContaining({
        id: 'external',
        title: 'External Projects',
      }),
    ])
  })
})

describe('project library default policies', () => {
  test('resolves the highest-priority default library policy', () => {
    const directoryPolicy = {
      id: 'directory',
      priority: 0,
      getDefaultLibraries: () => [
        {
          title: 'Projects',
          path: '/projects',
          type: 'directory',
        },
      ],
    }
    const cloudPolicy = {
      id: 'cloud',
      priority: 10,
      getDefaultLibraries: () => [
        {
          title: 'Personal Cloud',
          path: '/personal',
          type: 'cloud',
        },
      ],
    }

    const policies = combineProjectLibrarySettingDefaultPolicies([
      directoryPolicy,
      cloudPolicy,
    ])

    expect(
      resolveProjectLibrarySettingDefaults(policies, {
        initialDefaultDir: '/projects',
        isDesktop: false,
      })
    ).toEqual([
      {
        title: 'Personal Cloud',
        path: '/personal',
        type: 'cloud',
      },
    ])
  })
})

describe('combineProjectLibraryTypes', () => {
  test('merges duplicate library type contributions by type', () => {
    const readEntries = async () => []
    const createProject = {
      run: async () => undefined,
    }
    const openProject = {
      run: async () => undefined,
    }
    const renameProject = {
      run: async () => undefined,
    }
    const deleteProject = {
      run: async () => undefined,
    }

    expect(
      combineProjectLibraryTypes([
        {
          type: 'directory',
          title: 'Directory',
          icon: 'folder',
          operations: {
            createProject,
            openProject,
          },
        },
        {
          type: 'directory',
          title: 'Folder',
          readEntries,
          operations: {
            renameProject,
            deleteProject,
          },
        },
      ]).get('directory')
    ).toEqual({
      type: 'directory',
      title: 'Folder',
      icon: 'folder',
      operations: {
        createProject,
        openProject,
        renameProject,
        deleteProject,
      },
      readEntries,
    })
  })

  test('omits unavailable library type operations', () => {
    const library = {
      id: 'default-project-directory',
      title: 'Default Projects Directory',
      path: '/projects',
      type: 'directory',
    }

    expect(
      getProjectLibraryOperation(
        {
          type: 'directory',
          title: 'Directory',
          operations: {
            deleteProject: {
              isAvailable: () => false,
              run: async () => undefined,
            },
          },
        },
        library,
        'deleteProject'
      )
    ).toBeUndefined()
  })
})

describe('combineProjectLibrarySettingDefaults', () => {
  test('merges duplicate default settings by type and path', () => {
    expect(
      combineProjectLibrarySettingDefaults([
        {
          title: 'Projects',
          path: '/projects',
          type: 'directory',
        },
        {
          title: 'Renamed Projects',
          path: '/projects',
          type: 'directory',
        },
      ])
    ).toEqual([
      {
        title: 'Renamed Projects',
        path: '/projects',
        type: 'directory',
      },
    ])
  })
})

describe('getHomeProjectEntriesForLibrary', () => {
  test('returns entries that belong to the requested library', () => {
    expect(
      getHomeProjectEntriesForLibrary(
        [
          {
            id: 'local:/projects/bracket',
            source: 'local',
            status: 'local',
            libraryIds: ['default-project-directory'],
            name: 'bracket',
            readWriteAccess: true,
          },
          {
            id: 'local:/projects/shared-bracket',
            source: 'both',
            status: 'synced',
            libraryIds: ['default-project-directory', 'external'],
            name: 'shared-bracket',
            readWriteAccess: true,
          },
        ],
        'external'
      )
    ).toEqual([
      expect.objectContaining({
        id: 'local:/projects/shared-bracket',
      }),
    ])
  })
})

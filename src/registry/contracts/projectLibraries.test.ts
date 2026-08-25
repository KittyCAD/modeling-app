import {
  areProjectLibrarySettingsEqual,
  DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH,
  DEFAULT_PROJECT_LIBRARY_ID,
  formatProjectLibraryPathForDisplay,
  getContainingDirectoryProjectLibraryPath,
  getDefaultCloudProjectLibrarySetting,
  getDefaultDirectoryProjectLibraryPath,
  getDefaultDirectoryProjectLibrarySetting,
  getProjectLibraryDetailsDescription,
  getProjectLibraryIdFromSetting,
  getProjectLibraryLocationLabel,
  getProjectLibrarySummaryDescription,
  getProjectLibrarySummaryTooltip,
  LEGACY_PERSONAL_CLOUD_PROJECT_LIBRARY_PATH,
  moveProjectLibrarySetting,
  normalizeProjectLibrarySetting,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  projectLibrariesFromSettings,
  projectLibraryFromSetting,
  projectLibrarySettingsFromSerialized,
  projectLibrarySettingsToSerialized,
  updateDefaultDirectoryProjectLibrarySetting,
  updateProjectLibrarySettingAt,
} from '@src/lib/projectLibraries'
import {
  combineProjectLibraryRealizationContributions,
  combineProjectLibrarySettingDefaultPolicies,
  combineProjectLibrarySettingDefaults,
  combineProjectLibraryTypes,
  getHomeProjectEntriesForLibrary,
  getProjectLibraryOperation,
  resolveProjectLibrarySettingDefaults,
} from '@src/registry/contracts/projectLibraries'
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
    const library = projectLibraryFromSetting(
      getDefaultCloudProjectLibrarySetting()
    )

    expect(library).toEqual(
      expect.objectContaining({
        id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
        path: DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH,
        type: 'cloud',
      })
    )
    expect(library.source).toBeUndefined()
  })

  test('maps the legacy personal cloud path to the stable cloud library id', () => {
    expect(
      projectLibraryFromSetting({
        ...getDefaultCloudProjectLibrarySetting(),
        path: LEGACY_PERSONAL_CLOUD_PROJECT_LIBRARY_PATH,
      })
    ).toEqual(
      expect.objectContaining({
        id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
      })
    )
  })

  test('omits the default personal cloud path when serializing project libraries', () => {
    expect(
      projectLibrarySettingsToSerialized([
        {
          title: 'Personal Cloud',
          path: LEGACY_PERSONAL_CLOUD_PROJECT_LIBRARY_PATH,
          type: 'cloud',
        },
        {
          title: 'Team Cloud',
          path: '/team-cloud',
          source: '/team',
          type: 'cloud',
        },
      ])
    ).toEqual([
      {
        title: 'Personal Cloud',
        type: 'cloud',
      },
      {
        title: 'Team Cloud',
        path: '/team-cloud',
        source: '/team',
        type: 'cloud',
      },
    ])
  })

  test('fills the default personal cloud path when parsing serialized project libraries', () => {
    expect(
      projectLibrarySettingsFromSerialized([
        {
          title: 'Personal Cloud',
          type: 'cloud',
        },
        {
          title: 'Team Cloud',
          path: '/team-cloud',
          source: '/team',
          type: 'cloud',
        },
      ])
    ).toEqual([
      getDefaultCloudProjectLibrarySetting(),
      {
        title: 'Team Cloud',
        path: '/team-cloud',
        source: '/team',
        type: 'cloud',
      },
    ])
  })

  test('requires a local path when parsing a non-default cloud source', () => {
    expect(
      projectLibrarySettingsFromSerialized([
        {
          title: 'Team Cloud',
          source: '/team',
          type: 'cloud',
        },
      ])
    ).toBeUndefined()
  })

  test('formats cloud library paths with a zoo:// display prefix', () => {
    expect(
      formatProjectLibraryPathForDisplay({
        path: DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH,
        type: 'cloud',
      })
    ).toBe('zoo://personal')
    expect(
      formatProjectLibraryPathForDisplay({
        path: '/cloud/team',
        source: '/team',
        type: 'cloud',
      })
    ).toBe('zoo://team')
    expect(
      formatProjectLibraryPathForDisplay({
        path: '/projects',
        type: 'directory',
      })
    ).toBe('/projects')
  })

  test('summarizes project library storage in plain language', () => {
    const cloudLibrary = {
      path: DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH,
      type: 'cloud',
    }
    const directoryLibrary = {
      path: '/projects',
      type: 'directory',
    }

    expect(getProjectLibrarySummaryDescription(cloudLibrary)).toBe(
      'Projects in this library sync to your Zoo account'
    )
    expect(getProjectLibrarySummaryTooltip(cloudLibrary)).toContain(
      'Technical source: zoo://personal'
    )
    expect(getProjectLibraryDetailsDescription(cloudLibrary)).toBe(
      'Projects in this library sync to your Zoo account. Storage type and model-training controls depend on your plan.'
    )
    expect(getProjectLibraryLocationLabel(cloudLibrary)).toBe(
      'Technical source'
    )
    expect(getProjectLibrarySummaryDescription(directoryLibrary)).toBe(
      'Projects in this library are saved only on this computer'
    )
    expect(getProjectLibrarySummaryTooltip(directoryLibrary)).toContain(
      'Folder: /projects'
    )
    expect(getProjectLibraryDetailsDescription(directoryLibrary)).toBe(
      'Projects in this library are saved only on this computer.'
    )
    expect(getProjectLibraryLocationLabel(directoryLibrary)).toBe('Folder')
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
          source: '/team',
          type: 'cloud',
        }
      )
    ).toEqual({
      title: 'Cloud',
      path: 'zoo-cloud',
      source: '/team',
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
        source: '/team',
        type: 'cloud',
      },
    ]

    expect(areProjectLibrarySettingsEqual(libraries, [...libraries])).toBe(true)
    expect(
      areProjectLibrarySettingsEqual(libraries, [libraries[1], libraries[0]])
    ).toBe(false)
    expect(
      areProjectLibrarySettingsEqual(libraries, [
        libraries[0],
        {
          ...libraries[1],
          source: '/other-team',
        },
      ])
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

describe('projectLibrariesFromSettings', () => {
  test('derives visible library instances from settings order', () => {
    expect(
      projectLibrariesFromSettings([
        {
          title: 'External',
          path: 'external://projects',
          type: 'external',
        },
        {
          title: 'Default Projects Directory',
          path: '/projects',
          type: 'directory',
        },
        {
          title: 'Personal Cloud',
          path: DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH,
          type: 'cloud',
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: getProjectLibraryIdFromSetting({
          title: 'External',
          path: 'external://projects',
          type: 'external',
        }),
        title: 'External',
        order: 0,
      }),
      expect.objectContaining({
        id: DEFAULT_PROJECT_LIBRARY_ID,
        title: 'Default Projects Directory',
        order: 1,
      }),
      expect.objectContaining({
        id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
        title: 'Personal Cloud',
        order: 2,
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
          path: '/cloud/personal',
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
        path: '/cloud/personal',
        type: 'cloud',
      },
    ])
  })
})

describe('combineProjectLibraryTypes', () => {
  test('merges duplicate library type contributions by type', () => {
    const readRealizations = async () => []
    const createProject = {
      run: async () => undefined,
    }
    const openProject = {
      run: async () => undefined,
    }
    const duplicateProject = {
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
            duplicateProject,
          },
        },
        {
          type: 'directory',
          title: 'Folder',
          readRealizations,
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
        duplicateProject,
        renameProject,
        deleteProject,
      },
      readRealizations,
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
            source: 'local',
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

describe('combineProjectLibraryRealizationContributions', () => {
  test('combines realizations by normalized local path and preserves library membership', () => {
    expect(
      combineProjectLibraryRealizationContributions([
        {
          library: {
            id: 'parent-library',
            title: 'Parent',
            path: '/projects',
            type: 'directory',
          },
          name: 'bracket',
          localProjectPath: '/projects/bracket/',
          localProjectName: 'bracket',
          readWriteAccess: true,
        },
        {
          library: {
            id: 'child-library',
            title: 'Child',
            path: '/projects/bracket',
            type: 'directory',
          },
          name: 'bracket',
          localProjectPath: '/projects/bracket',
          localProjectName: 'bracket',
          readWriteAccess: true,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: 'local:/projects/bracket',
        localProjectPath: '/projects/bracket',
        libraryIds: ['parent-library', 'child-library'],
        libraryRefs: [
          expect.objectContaining({ id: 'parent-library' }),
          expect.objectContaining({ id: 'child-library' }),
        ],
      }),
    ])
  })

  test('does not combine different local paths with the same cloud project id', () => {
    expect(
      combineProjectLibraryRealizationContributions([
        {
          libraryId: 'directory-library',
          name: 'directory-copy',
          localProjectPath: '/projects/directory-copy',
          localProjectName: 'directory-copy',
          cloudProjectId: 'remote-123',
          readWriteAccess: true,
        },
        {
          libraryId: 'cloud-library',
          name: 'cloud-copy',
          localProjectPath: '/cloud/cloud-copy',
          localProjectName: 'cloud-copy',
          cloudProjectId: 'remote-123',
          readWriteAccess: true,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: 'local:/projects/directory-copy',
        libraryIds: ['directory-library'],
        cloudProjectId: 'remote-123',
      }),
      expect.objectContaining({
        id: 'local:/cloud/cloud-copy',
        libraryIds: ['cloud-library'],
        cloudProjectId: 'remote-123',
      }),
    ])
  })
})

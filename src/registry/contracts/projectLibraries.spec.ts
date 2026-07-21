import {
  combineProjectLibrarySettingDefaults,
  combineProjectLibraryTypes,
  combineProjectLibraries,
  getHomeProjectEntriesForLibrary,
} from '@src/registry/contracts/projectLibraries'
import {
  DEFAULT_PROJECT_LIBRARY_ID,
  getContainingDirectoryProjectLibraryPath,
  getDefaultDirectoryProjectLibrarySetting,
  getDefaultDirectoryProjectLibraryPath,
  getProjectLibraryIdFromSetting,
  projectLibraryFromSetting,
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

describe('combineProjectLibraryTypes', () => {
  test('merges duplicate library type contributions by type', () => {
    const readEntries = async () => []
    const createProject = {
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
          },
        },
        {
          type: 'directory',
          title: 'Folder',
          readEntries,
        },
      ]).get('directory')
    ).toEqual({
      type: 'directory',
      title: 'Folder',
      icon: 'folder',
      operations: {
        createProject,
      },
      readEntries,
    })
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

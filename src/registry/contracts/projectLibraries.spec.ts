import {
  combineProjectLibrarySettingDefaults,
  combineProjectLibraryTypes,
  combineProjectLibraries,
  getHomeProjectEntriesForLibrary,
} from '@src/registry/contracts/projectLibraries'
import {
  CLOUD_PROJECT_LIBRARY_ID,
  DEFAULT_PROJECT_LIBRARY_ID,
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

  test('maps cloud settings to the stable cloud library id', () => {
    expect(
      projectLibraryFromSetting({
        title: 'Cloud',
        path: 'zoo://user/projects',
        type: 'cloud',
      })
    ).toEqual(
      expect.objectContaining({
        id: CLOUD_PROJECT_LIBRARY_ID,
      })
    )
  })
})

describe('combineProjectLibraries', () => {
  test('merges duplicate library contributions by id and sorts by order', () => {
    expect(
      combineProjectLibraries([
        {
          id: 'cloud',
          title: 'Cloud',
          path: 'zoo://user/projects',
          type: 'cloud',
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
          id: 'cloud',
          title: 'Personal Cloud',
          path: 'zoo://user/projects',
          type: 'cloud',
          order: 10,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: 'default-project-directory',
        title: 'Default Projects Directory',
      }),
      expect.objectContaining({
        id: 'cloud',
        title: 'Personal Cloud',
      }),
    ])
  })
})

describe('combineProjectLibraryTypes', () => {
  test('merges duplicate library type contributions by type', () => {
    const readEntries = async () => []

    expect(
      combineProjectLibraryTypes([
        {
          type: 'directory',
          title: 'Directory',
          icon: 'folder',
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
      readEntries,
    })
  })
})

describe('combineProjectLibrarySettingDefaults', () => {
  test('merges duplicate default settings by type and path', () => {
    expect(
      combineProjectLibrarySettingDefaults([
        {
          title: 'Cloud',
          path: 'zoo://user/projects',
          type: 'cloud',
        },
        {
          title: 'Personal Cloud',
          path: 'zoo://user/projects',
          type: 'cloud',
        },
      ])
    ).toEqual([
      {
        title: 'Personal Cloud',
        path: 'zoo://user/projects',
        type: 'cloud',
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
            id: 'local:/projects/cloud-bracket',
            source: 'both',
            status: 'synced',
            libraryIds: ['default-project-directory', 'cloud'],
            name: 'cloud-bracket',
            readWriteAccess: true,
          },
        ],
        'cloud'
      )
    ).toEqual([
      expect.objectContaining({
        id: 'local:/projects/cloud-bracket',
      }),
    ])
  })
})

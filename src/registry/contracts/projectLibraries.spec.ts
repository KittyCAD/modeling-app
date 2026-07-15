import {
  combineProjectLibraries,
  getHomeProjectEntriesForLibrary,
} from '@src/registry/contracts/projectLibraries'
import { describe, expect, test } from 'vitest'

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

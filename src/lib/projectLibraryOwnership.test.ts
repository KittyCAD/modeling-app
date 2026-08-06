import {
  getProjectLibraryOwnership,
  projectWithLibraryOwnership,
} from '@src/lib/projectLibraryOwnership'
import type { Project } from '@src/lib/project'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import { describe, expect, it } from 'vitest'

function directoryLibrary(path: string): ProjectLibrarySetting {
  return { title: 'Projects', path, type: DIRECTORY_PROJECT_LIBRARY_TYPE }
}

function cloudLibrary(path: string): ProjectLibrarySetting {
  return {
    title: 'Team Cloud',
    path,
    source: '/team',
    type: CLOUD_PROJECT_LIBRARY_TYPE,
  }
}

const baseProject: Project = {
  name: 'bracket',
  default_file: '/projects/bracket/main.kcl',
  directory_count: 0,
  kcl_file_count: 1,
  metadata: null,
  path: '/projects/bracket',
  readWriteAccess: true,
  children: [],
}

describe('project library ownership', () => {
  it('uses the most specific normalized containing library path', async () => {
    await expect(
      getProjectLibraryOwnership(
        [directoryLibrary('/projects'), directoryLibrary('/projects/client/')],
        '/projects/client/bracket'
      )
    ).resolves.toEqual({
      libraryPath: '/projects/client',
      libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
    })

    await expect(
      getProjectLibraryOwnership(
        [cloudLibrary('/cloud/team/')],
        '/cloud/team/bracket'
      )
    ).resolves.toEqual({
      libraryPath: '/cloud/team',
      libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
    })
  })

  it('does not treat a library root itself as an opened project', async () => {
    await expect(
      getProjectLibraryOwnership([directoryLibrary('/projects')], '/projects')
    ).resolves.toBeUndefined()
  })

  it('removes stale ownership from projects outside configured libraries', async () => {
    await expect(
      projectWithLibraryOwnership(
        {
          ...baseProject,
          path: '/external/bracket',
          libraryPath: '/projects',
          libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
        },
        [directoryLibrary('/projects')]
      )
    ).resolves.toEqual({
      ...baseProject,
      path: '/external/bracket',
    })
  })
})

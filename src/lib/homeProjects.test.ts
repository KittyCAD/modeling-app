import {
  homeProjectEntryFromProject,
  shouldDeleteRemoteOnHomeProjectDelete,
  shouldPreserveRemoteOnHomeProjectDelete,
} from '@src/lib/homeProjects'
import type { FileMetadata, Project } from '@src/lib/project'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
} from '@src/lib/projectLibraries'
import { describe, expect, test } from 'vitest'

function metadata(modified: number): FileMetadata {
  return {
    accessed: null,
    created: null,
    modified,
    permission: null,
    size: 0,
    type: null,
  }
}

describe('homeProjectEntryFromProject', () => {
  test('uses the newest child modified time for local project cards', () => {
    const project = {
      name: 'project',
      path: '/projects/project',
      title: 'Project',
      default_file: '/projects/project/main.kcl',
      readWriteAccess: true,
      metadata: metadata(10),
      kcl_file_count: 1,
      directory_count: 0,
      children: [
        {
          name: 'main.kcl',
          path: '/projects/project/main.kcl',
          metadata: metadata(50),
          children: null,
        },
      ],
    } satisfies Project

    expect(homeProjectEntryFromProject(project).modified).toBe(50)
  })
})

describe('Home project deletion policy', () => {
  test('deletes the remote version only for projects in cloud-type libraries', () => {
    expect(
      shouldDeleteRemoteOnHomeProjectDelete({
        libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
        remoteProjectId: 'remote-123',
      })
    ).toBe(true)
    expect(
      shouldDeleteRemoteOnHomeProjectDelete({
        libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
        remoteProjectId: 'remote-123',
      })
    ).toBe(false)
    expect(
      shouldDeleteRemoteOnHomeProjectDelete({
        libraryType: 'custom-library',
        remoteProjectId: 'remote-123',
      })
    ).toBe(false)
    expect(
      shouldDeleteRemoteOnHomeProjectDelete({
        remoteProjectId: 'remote-123',
      })
    ).toBe(false)
  })

  test('preserves the remote version when deleting a local copy outside a cloud-type library', () => {
    expect(
      shouldPreserveRemoteOnHomeProjectDelete({
        libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
        localProjectPath: '/projects/bracket',
        remoteProjectId: 'remote-123',
      })
    ).toBe(true)
    expect(
      shouldPreserveRemoteOnHomeProjectDelete({
        libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
        localProjectPath: '/cloud/bracket',
        remoteProjectId: 'remote-123',
      })
    ).toBe(false)
  })
})

import { createProjectForTest } from '@src/lib/projectTestUtils'
import {
  findHomeProjectByPath,
  homeProjectEntryFromProject,
  shouldDeleteRemoteOnHomeProjectDelete,
  shouldPreserveRemoteOnHomeProjectDelete,
} from '@src/lib/homeProjects'
import type { FileMetadata, Project } from '@src/lib/project'
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'
import { describe, expect, test } from 'vitest'

test('resolves local and cloud Home entries without matching a different project', () => {
  const local: HomeProjectEntry = {
    id: 'local',
    source: 'local',
    status: 'local',
    name: 'local',
    localProjectPath: '/projects/local',
    readWriteAccess: true,
  }
  const remote: HomeProjectEntry = {
    id: 'cloud:one',
    source: 'remote',
    status: 'cloud-only',
    name: 'one',
    remoteProjectId: 'one',
    projectPath: '/provider-projects/one',
    readWriteAccess: true,
  }
  const entries = [local, remote]
  expect(findHomeProjectByPath(entries, local.localProjectPath!)).toBe(local)
  expect(findHomeProjectByPath(entries, '/provider-projects/one')).toBe(remote)
  expect(
    findHomeProjectByPath(entries, '/provider-projects/two')
  ).toBeUndefined()
  expect(
    findHomeProjectByPath(entries, '/projects/local/nested')
  ).toBeUndefined()
})

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
    const project = createProjectForTest('/projects/project', {
      name: 'project',
      title: 'Project',
      default_file: '/projects/project/main.kcl',
      metadata: metadata(10),
      kcl_file_count: 1,
      children: [
        {
          name: 'main.kcl',
          path: '/projects/project/main.kcl',
          metadata: metadata(50),
          children: null,
        },
      ],
    }) satisfies Project

    expect(homeProjectEntryFromProject(project).modified).toBe(50)
  })

  test('marks cloud-type project snapshots as remote-deleting Home cards', () => {
    const project = createProjectForTest('/projects/project', {
      name: 'project',
      default_file: '/projects/project/main.kcl',
      metadata: metadata(10),
      kcl_file_count: 1,
      cloudProjectId: 'remote-123',
      libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
    }) satisfies Project

    expect(homeProjectEntryFromProject(project).deleteRemoteOnDelete).toBe(true)
  })
})

describe('Home project deletion policy', () => {
  test('deletes the remote version only when the Home entry says delete removes the remote project', () => {
    expect(
      shouldDeleteRemoteOnHomeProjectDelete({
        remoteProjectId: 'remote-123',
        deleteRemoteOnDelete: true,
      })
    ).toBe(true)
    expect(
      shouldDeleteRemoteOnHomeProjectDelete({
        remoteProjectId: 'remote-123',
        deleteRemoteOnDelete: false,
      })
    ).toBe(false)
    expect(
      shouldDeleteRemoteOnHomeProjectDelete({
        remoteProjectId: 'remote-123',
        deleteRemoteOnDelete: undefined,
      })
    ).toBe(false)
    expect(
      shouldDeleteRemoteOnHomeProjectDelete({
        deleteRemoteOnDelete: true,
      })
    ).toBe(false)
  })

  test('preserves the remote version when deleting a local cloud-backed copy that does not delete remote', () => {
    expect(
      shouldPreserveRemoteOnHomeProjectDelete({
        localProjectPath: '/projects/bracket',
        remoteProjectId: 'remote-123',
        deleteRemoteOnDelete: false,
      })
    ).toBe(true)
    expect(
      shouldPreserveRemoteOnHomeProjectDelete({
        localProjectPath: '/cloud/bracket',
        remoteProjectId: 'remote-123',
        deleteRemoteOnDelete: true,
      })
    ).toBe(false)
  })
})

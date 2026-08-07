import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DEFAULT_PROJECT_LIBRARY_ID,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
} from '@src/lib/projectLibraries'
import { coalesceHomeProjectEntries } from '@src/registry/contracts/homeProjects'
import { describe, expect, test } from 'vitest'

describe('coalesceHomeProjectEntries', () => {
  test('keeps local-only projects as local entries', () => {
    expect(
      coalesceHomeProjectEntries([
        {
          source: 'local',
          status: 'local',
          name: 'local-project',
          localProjectPath: '/projects/local-project',
          localProjectName: 'local-project',
          modified: 10,
          readWriteAccess: true,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: 'local:/projects/local-project',
        source: 'local',
        status: 'local',
        name: 'local-project',
      }),
    ])
  })

  test('keeps cloud-only projects as remote entries', () => {
    expect(
      coalesceHomeProjectEntries([
        {
          source: 'remote',
          status: 'cloud-only',
          name: 'remote-project',
          title: 'Remote project',
          remoteProjectId: 'remote-123',
          modified: 20,
          readWriteAccess: true,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: 'remote:remote-123',
        source: 'remote',
        status: 'cloud-only',
        name: 'remote-project',
      }),
    ])
  })

  test('keeps cloud-linked local projects keyed by local path', () => {
    expect(
      coalesceHomeProjectEntries([
        {
          source: 'local',
          status: 'synced',
          name: 'local-project',
          localProjectPath: '/projects/local-project',
          localProjectName: 'local-project',
          remoteProjectId: 'remote-123',
          modified: 10,
          readWriteAccess: true,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: 'local:/projects/local-project',
        source: 'local',
        status: 'synced',
        remoteProjectId: 'remote-123',
      }),
    ])
  })

  test('merges local and remote entries with the same cloud project id', () => {
    expect(
      coalesceHomeProjectEntries([
        {
          source: 'remote',
          status: 'cloud-only',
          name: 'remote-name',
          title: 'Remote title',
          remoteProjectId: 'remote-123',
          modified: 20,
          readWriteAccess: true,
        },
        {
          source: 'local',
          status: 'synced',
          name: 'local-name',
          title: 'Local title',
          localProjectPath: '/projects/local-name',
          localProjectName: 'local-name',
          libraryPath: '/projects',
          libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
          remoteProjectId: 'remote-123',
          modified: 10,
          readWriteAccess: true,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: 'local:/projects/local-name',
        source: 'both',
        status: 'synced',
        name: 'local-name',
        title: 'Local title',
        modified: 20,
        localProjectPath: '/projects/local-name',
        libraryPath: '/projects',
        libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
        remoteProjectId: 'remote-123',
      }),
    ])
  })

  test('preserves remote conflict metadata when the local project snapshot is stale', () => {
    expect(
      coalesceHomeProjectEntries([
        {
          source: 'remote',
          status: 'conflicted',
          name: 'remote-name',
          title: 'Remote title',
          remoteProjectId: 'remote-123',
          localProjectPath: '/projects/local-name',
          conflict: {
            conflictProjectPath: '/projects/local-name (cloud conflict)',
          },
          modified: 20,
          readWriteAccess: true,
        },
        {
          source: 'local',
          status: 'synced',
          name: 'local-name',
          title: 'Local title',
          localProjectPath: '/projects/local-name',
          localProjectName: 'local-name',
          remoteProjectId: 'remote-123',
          modified: 10,
          readWriteAccess: true,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: 'local:/projects/local-name',
        source: 'both',
        status: 'conflicted',
        name: 'local-name',
        title: 'Local title',
        localProjectPath: '/projects/local-name',
        remoteProjectId: 'remote-123',
        conflict: {
          conflictProjectPath: '/projects/local-name (cloud conflict)',
        },
      }),
    ])
  })

  test('keeps configured library ownership over the default local fallback', () => {
    expect(
      coalesceHomeProjectEntries([
        {
          source: 'local',
          status: 'synced',
          libraryId: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
          name: 'cloud-name',
          localProjectPath: '/cloud/cloud-name',
          localProjectName: 'cloud-name',
          libraryPath: '/cloud',
          libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
          remoteProjectId: 'remote-123',
          modified: 20,
          readWriteAccess: true,
        },
        {
          source: 'local',
          status: 'synced',
          libraryId: DEFAULT_PROJECT_LIBRARY_ID,
          name: 'cloud-name',
          localProjectPath: '/cloud/cloud-name',
          localProjectName: 'cloud-name',
          libraryPath: '/cloud',
          libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
          remoteProjectId: 'remote-123',
          modified: 10,
          readWriteAccess: true,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        libraryIds: [
          PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
          DEFAULT_PROJECT_LIBRARY_ID,
        ],
        libraryPath: '/cloud',
        libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
      }),
    ])
  })
})

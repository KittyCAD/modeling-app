import {
  getLegacyCloudProjectMigrationFailureMessage,
  getLegacyCloudLocationProjects,
  getLegacyCloudProjectMigrationSignature,
} from '@src/lib/cloudSync/legacyProjectMigration'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
} from '@src/lib/projectLibraries'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import { describe, expect, it } from 'vitest'

const libraries: ProjectLibrary[] = [
  {
    id: 'client-projects',
    title: 'Client Projects',
    path: '/projects',
    type: DIRECTORY_PROJECT_LIBRARY_TYPE,
  },
  {
    id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
    title: 'Personal Cloud',
    path: '/personal',
    type: CLOUD_PROJECT_LIBRARY_TYPE,
  },
]

function project(overrides: Partial<HomeProjectEntry> = {}): HomeProjectEntry {
  return {
    id: 'local:/projects/bracket',
    source: 'both',
    status: 'synced',
    libraryIds: ['client-projects', PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
    name: 'bracket',
    title: 'Bracket',
    localProjectPath: '/projects/bracket',
    remoteProjectId: 'remote-123',
    readWriteAccess: true,
    ...overrides,
  }
}

describe('legacy cloud project migration helpers', () => {
  it('finds cloud-linked projects inside non-cloud libraries but outside Personal Cloud', () => {
    expect(
      getLegacyCloudLocationProjects({
        libraries,
        personalCloudRoot: '/documents/Zoo/personal',
        projects: [
          project(),
          project({
            id: 'local:/documents/Zoo/personal/cloud-project',
            localProjectPath: '/documents/Zoo/personal/cloud-project',
            remoteProjectId: 'remote-456',
          }),
          project({
            id: 'local:/projects/local-only',
            localProjectPath: '/projects/local-only',
            remoteProjectId: undefined,
          }),
          project({
            id: 'local:/projects/conflicted',
            localProjectPath: '/projects/conflicted',
            remoteProjectId: 'remote-789',
            conflict: {},
          }),
        ],
      })
    ).toEqual([project()])
  })

  it('uses remote ids to build a stable dismissal signature', () => {
    expect(
      getLegacyCloudProjectMigrationSignature([
        project({ remoteProjectId: 'remote-b' }),
        project({ remoteProjectId: 'remote-a' }),
      ])
    ).toBe('remote-a|remote-b')
  })

  it('formats single-project migration failures with the project and reason', () => {
    expect(
      getLegacyCloudProjectMigrationFailureMessage({
        movedCount: 0,
        failures: [
          {
            project: project({ title: 'Bracket' }),
            reason: new Error(
              'Personal Cloud already has a local copy of this cloud project at /documents/Zoo/personal/bracket.'
            ),
          },
        ],
      })
    ).toBe(
      'Could not move "Bracket" into Personal Cloud: Personal Cloud already has a local copy of this cloud project at /documents/Zoo/personal/bracket.'
    )
  })

  it('formats partial migration failures without hiding successful moves', () => {
    expect(
      getLegacyCloudProjectMigrationFailureMessage({
        movedCount: 2,
        failures: [
          {
            project: project({ title: 'Bracket' }),
            reason: 'destination already exists',
          },
        ],
      })
    ).toBe(
      'Moved 2 cloud-synced projects, but could not move "Bracket" into Personal Cloud: destination already exists'
    )
  })
})

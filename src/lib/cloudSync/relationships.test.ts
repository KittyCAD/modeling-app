import {
  classifyCloudProjectDuplicateRisk,
  deriveCloudProjectRelationships,
} from '@src/lib/cloudSync/relationships'
import type { CloudSyncProjectMetadataIndexEntry } from '@src/lib/cloudSync/types'
import type { ProjectLibraryRealization } from '@src/registry/contracts/projectLibraries'
import { describe, expect, test } from 'vitest'

function projectNameFromPath(projectPath: string) {
  return projectPath.slice(projectPath.lastIndexOf('/') + 1)
}

function realization(
  overrides: Partial<ProjectLibraryRealization> & {
    localProjectPath: string
    libraryType: string
  }
): ProjectLibraryRealization {
  const { libraryType, localProjectPath, ...rest } = overrides
  const localProjectName = projectNameFromPath(localProjectPath)

  return {
    id: `local:${localProjectPath}`,
    libraryIds: [`${libraryType}-library`],
    libraryRefs: [
      {
        id: `${libraryType}-library`,
        title: libraryType === 'cloud' ? 'Personal Cloud' : 'Projects',
        path: libraryType === 'cloud' ? '/cloud' : '/projects',
        type: libraryType,
      },
    ],
    localProjectPath,
    localProjectName,
    name: localProjectName,
    cloudProjectId: 'remote-123',
    modified: 1,
    readWriteAccess: true,
    ...rest,
  }
}

function metadata(
  overrides: Partial<CloudSyncProjectMetadataIndexEntry> & {
    localProjectPath: string
  }
): CloudSyncProjectMetadataIndexEntry {
  const { localProjectPath, ...rest } = overrides
  const projectName = projectNameFromPath(localProjectPath)

  return {
    schemaVersion: 1,
    localProjectPath,
    projectName,
    remoteProjectId: 'remote-123',
    hasPendingChanges: false,
    baseManifest: { files: {} },
    ...rest,
  }
}

describe('deriveCloudProjectRelationships', () => {
  test('groups local realizations by remote project id and prefers a clean cloud-library canonical', () => {
    const relationships = deriveCloudProjectRelationships({
      realizations: [
        realization({
          localProjectPath: '/projects/bracket',
          libraryType: 'directory',
          modified: 20,
        }),
        realization({
          localProjectPath: '/cloud/bracket',
          libraryType: 'cloud',
          modified: 10,
        }),
        realization({
          localProjectPath: '/cloud/bracket-copy',
          libraryType: 'cloud',
          modified: 5,
        }),
      ],
      remoteProjects: [{ id: 'remote-123', title: 'Remote Bracket' }],
      metadata: [
        metadata({ localProjectPath: '/projects/bracket' }),
        metadata({ localProjectPath: '/cloud/bracket' }),
        metadata({ localProjectPath: '/cloud/bracket-copy' }),
      ],
    })

    expect(relationships).toEqual([
      expect.objectContaining({
        remoteProjectId: 'remote-123',
        canonicalRealization: expect.objectContaining({
          role: 'canonical',
          realization: expect.objectContaining({
            localProjectPath: '/cloud/bracket',
          }),
        }),
        duplicateRealizations: [
          expect.objectContaining({
            duplicateRisk: 'unknown',
            autoCleanupEligible: false,
            realization: expect.objectContaining({
              localProjectPath: '/projects/bracket',
            }),
          }),
          expect.objectContaining({
            duplicateRisk: 'unknown',
            autoCleanupEligible: false,
            realization: expect.objectContaining({
              localProjectPath: '/cloud/bracket-copy',
            }),
          }),
        ],
      }),
    ])
  })

  test('prefers the newest clean synced realization when no cloud-library realization exists', () => {
    const relationships = deriveCloudProjectRelationships({
      realizations: [
        realization({
          localProjectPath: '/archive/bracket',
          libraryType: 'directory',
          modified: 10,
        }),
        realization({
          localProjectPath: '/projects/bracket',
          libraryType: 'directory',
          modified: 20,
        }),
      ],
      remoteProjects: [{ id: 'remote-123', title: 'Remote Bracket' }],
      metadata: [
        metadata({ localProjectPath: '/archive/bracket' }),
        metadata({ localProjectPath: '/projects/bracket' }),
      ],
    })

    expect(
      relationships[0]?.canonicalRealization?.realization.localProjectPath
    ).toBe('/projects/bracket')
  })

  test('uses local manifest comparisons to classify exact and divergent duplicates', () => {
    const relationships = deriveCloudProjectRelationships({
      realizations: [
        realization({
          localProjectPath: '/projects/bracket',
          libraryType: 'directory',
          modified: 20,
        }),
        realization({
          localProjectPath: '/cloud/bracket',
          libraryType: 'cloud',
          modified: 10,
        }),
        realization({
          localProjectPath: '/cloud/bracket-copy',
          libraryType: 'cloud',
          modified: 5,
        }),
      ],
      remoteProjects: [{ id: 'remote-123', title: 'Remote Bracket' }],
      metadata: [
        metadata({ localProjectPath: '/projects/bracket' }),
        metadata({ localProjectPath: '/cloud/bracket' }),
        metadata({ localProjectPath: '/cloud/bracket-copy' }),
      ],
      localManifestComparisons: new Map([
        ['/projects/bracket', { localMatchesBase: false }],
        ['/cloud/bracket', { localMatchesBase: true }],
        ['/cloud/bracket-copy', { localMatchesBase: true }],
      ]),
    })

    expect(relationships[0]?.duplicateRealizations).toEqual([
      expect.objectContaining({
        duplicateRisk: 'divergent',
        autoCleanupEligible: false,
        realization: expect.objectContaining({
          localProjectPath: '/projects/bracket',
        }),
      }),
      expect.objectContaining({
        duplicateRisk: 'exact',
        autoCleanupEligible: true,
        realization: expect.objectContaining({
          localProjectPath: '/cloud/bracket-copy',
        }),
      }),
    ])
  })

  test('creates remote-only relationships from remote projects', () => {
    expect(
      deriveCloudProjectRelationships({
        realizations: [],
        remoteProjects: [{ id: 'remote-only', title: 'Remote Only' }],
        metadata: [],
      })
    ).toEqual([
      expect.objectContaining({
        remoteProjectId: 'remote-only',
        name: 'Remote Only',
        canonicalRealization: undefined,
        duplicateRealizations: [],
        localRealizations: [],
      }),
    ])
  })
})

describe('classifyCloudProjectDuplicateRisk', () => {
  test.each([
    ['tombstoned', { tombstone: true }],
    ['sync-excluded', { syncExcluded: true }],
    ['conflicted', { hasConflict: true }],
    ['pending', { hasPendingChanges: true }],
    ['unreadable', { readWriteAccess: false }],
    ['unreadable', { manifestReadable: false }],
    ['divergent', { localMatchesBase: false }],
    ['exact', { hasBaseManifest: true, localMatchesBase: true }],
    ['unknown', {}],
  ] as const)('classifies %s duplicate realizations', (expected, input) => {
    expect(classifyCloudProjectDuplicateRisk(input)).toBe(expected)
  })
})

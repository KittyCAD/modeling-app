import { normalizePathForSync } from '@src/lib/cloudSync/paths'
import type {
  CloudSyncProjectMetadataIndexEntry,
  RemoteProjectSummary,
} from '@src/lib/cloudSync/types'
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import type {
  CloudProjectDuplicateRisk,
  CloudProjectRelationship,
  CloudProjectRelationshipRealization,
} from '@src/registry/contracts/cloudSync'
import type { ProjectLibraryRealization } from '@src/registry/contracts/projectLibraries'

export type DeriveCloudProjectRelationshipsInput = {
  realizations: readonly ProjectLibraryRealization[]
  remoteProjects: readonly RemoteProjectSummary[]
  metadata: readonly CloudSyncProjectMetadataIndexEntry[]
  localManifestComparisons?: ReadonlyMap<
    string,
    CloudProjectLocalManifestComparison
  >
  remoteThumbnailUrls?: ReadonlyMap<string, string>
  preservedDefaultFiles?: ReadonlyMap<string, string>
  getModifiedTime?: (
    metadata: CloudSyncProjectMetadataIndexEntry | undefined,
    localModified: number | null | undefined
  ) => number | null
}

export type ClassifyCloudProjectDuplicateRiskInput = {
  hasBaseManifest?: boolean
  hasPendingChanges?: boolean
  hasConflict?: boolean
  readWriteAccess?: boolean
  tombstone?: boolean
  syncExcluded?: boolean
  localMatchesBase?: boolean
  manifestReadable?: boolean
}

export type CloudProjectLocalManifestComparison = {
  localMatchesBase?: boolean
  manifestReadable?: boolean
}

function cloudProjectRelationshipId(remoteProjectId: string) {
  return `cloud:${remoteProjectId}`
}

function realizationIsInCloudLibrary(realization: ProjectLibraryRealization) {
  return realization.libraryRefs.some(
    (library) => library.type === CLOUD_PROJECT_LIBRARY_TYPE
  )
}

function realizationIsOnlyInCloudLibraries(
  realization: ProjectLibraryRealization
) {
  return (
    realization.libraryRefs.length > 0 &&
    realization.libraryRefs.every(
      (library) => library.type === CLOUD_PROJECT_LIBRARY_TYPE
    )
  )
}

/**
 * Exact/divergent are reserved for callers that have compared the current
 * local manifest with the relationship's clean base. Metadata alone can only
 * classify known policy states such as pending, conflicted, tombstoned, or
 * sync-excluded.
 */
export function classifyCloudProjectDuplicateRisk({
  hasBaseManifest,
  hasPendingChanges,
  hasConflict,
  readWriteAccess = true,
  tombstone,
  syncExcluded,
  localMatchesBase,
  manifestReadable = true,
}: ClassifyCloudProjectDuplicateRiskInput): CloudProjectDuplicateRisk {
  if (tombstone) {
    return 'tombstoned'
  }
  if (syncExcluded) {
    return 'sync-excluded'
  }
  if (hasConflict) {
    return 'conflicted'
  }
  if (hasPendingChanges) {
    return 'pending'
  }
  if (!readWriteAccess || !manifestReadable) {
    return 'unreadable'
  }
  if (localMatchesBase === false) {
    return 'divergent'
  }
  if (hasBaseManifest && localMatchesBase === true) {
    return 'exact'
  }

  return 'unknown'
}

function classifyDuplicateRisk({
  localManifestComparison,
  realization,
  metadata,
}: {
  localManifestComparison?: CloudProjectLocalManifestComparison
  realization: ProjectLibraryRealization
  metadata: CloudSyncProjectMetadataIndexEntry | undefined
}): CloudProjectDuplicateRisk {
  return classifyCloudProjectDuplicateRisk({
    hasBaseManifest: Boolean(
      metadata?.baseManifest ||
        localManifestComparison?.localMatchesBase !== undefined
    ),
    hasPendingChanges: metadata?.hasPendingChanges,
    hasConflict: Boolean(metadata?.conflict || realization.conflict),
    readWriteAccess: realization.readWriteAccess,
    tombstone: metadata?.tombstone,
    syncExcluded: Boolean(metadata?.syncExcluded),
    localMatchesBase: localManifestComparison?.localMatchesBase,
    manifestReadable: localManifestComparison?.manifestReadable,
  })
}

function duplicateRiskIsClean(risk: CloudProjectDuplicateRisk) {
  return risk === 'exact' || risk === 'unknown'
}

function canonicalPreferenceKey(
  relationshipRealization: CloudProjectRelationshipRealization
) {
  const { realization, duplicateRisk } = relationshipRealization
  const clean = duplicateRiskIsClean(duplicateRisk)
  const cloudLibrary = realizationIsInCloudLibrary(realization)
  const modified = String(realization.modified ?? 0).padStart(16, '0')

  return [
    clean && cloudLibrary ? '2' : clean ? '1' : '0',
    modified,
    realization.localProjectPath,
  ].join(':')
}

function selectCanonicalRealization(
  realizations: readonly CloudProjectRelationshipRealization[]
) {
  return realizations.toSorted((a, b) =>
    canonicalPreferenceKey(b).localeCompare(canonicalPreferenceKey(a))
  )[0]
}

function relationshipTitle({
  canonical,
  remoteProject,
  metadata,
}: {
  canonical: CloudProjectRelationshipRealization | undefined
  remoteProject: RemoteProjectSummary | undefined
  metadata: CloudSyncProjectMetadataIndexEntry | undefined
}) {
  return (
    canonical?.realization.title ||
    metadata?.projectName ||
    remoteProject?.title ||
    remoteProject?.id
  )
}

function relationshipName({
  canonical,
  remoteProject,
  metadata,
  remoteProjectId,
}: {
  canonical: CloudProjectRelationshipRealization | undefined
  remoteProject: RemoteProjectSummary | undefined
  metadata: CloudSyncProjectMetadataIndexEntry | undefined
  remoteProjectId: string
}) {
  return (
    canonical?.realization.name ||
    metadata?.projectName ||
    remoteProject?.title ||
    remoteProjectId
  )
}

function remoteModifiedTime(remoteProject: RemoteProjectSummary | undefined) {
  const modified = remoteProject?.updated_at
    ? Date.parse(remoteProject.updated_at)
    : NaN

  return Number.isNaN(modified) ? undefined : modified
}

export function deriveCloudProjectRelationships({
  localManifestComparisons = new Map(),
  realizations,
  remoteProjects,
  metadata,
  remoteThumbnailUrls = new Map(),
  preservedDefaultFiles = new Map(),
  getModifiedTime,
}: DeriveCloudProjectRelationshipsInput): CloudProjectRelationship[] {
  const remoteProjectsById = new Map(
    remoteProjects.map((project) => [project.id, project])
  )
  const metadataByPath = new Map(
    metadata.map((entry) => [
      normalizePathForSync(entry.localProjectPath),
      entry,
    ])
  )
  const metadataByRemoteProjectId = new Map<
    string,
    CloudSyncProjectMetadataIndexEntry[]
  >()
  const realizationsByRemoteProjectId = new Map<
    string,
    ProjectLibraryRealization[]
  >()
  const remoteProjectIds = new Set(remoteProjects.map((project) => project.id))

  for (const entry of metadata) {
    if (!entry.remoteProjectId) {
      continue
    }
    if (
      !entry.tombstone &&
      !entry.syncExcluded &&
      (entry.conflict || entry.lastFailure)
    ) {
      remoteProjectIds.add(entry.remoteProjectId)
    }
    const entries = metadataByRemoteProjectId.get(entry.remoteProjectId) ?? []
    entries.push(entry)
    metadataByRemoteProjectId.set(entry.remoteProjectId, entries)
  }

  for (const realization of realizations) {
    const remoteProjectId = realization.cloudProjectId?.trim()
    if (!remoteProjectId) {
      continue
    }
    remoteProjectIds.add(remoteProjectId)
    const groupedRealizations =
      realizationsByRemoteProjectId.get(remoteProjectId) ?? []
    groupedRealizations.push(realization)
    realizationsByRemoteProjectId.set(remoteProjectId, groupedRealizations)
  }

  return Array.from(remoteProjectIds)
    .toSorted((a, b) => a.localeCompare(b))
    .map((remoteProjectId) => {
      const remoteProject = remoteProjectsById.get(remoteProjectId)
      const relationshipMetadata =
        metadataByRemoteProjectId.get(remoteProjectId) ?? []
      const firstMetadata = relationshipMetadata[0]
      const relationshipRealizations = (
        realizationsByRemoteProjectId.get(remoteProjectId) ?? []
      ).map((realization): CloudProjectRelationshipRealization => {
        const localMetadata = metadataByPath.get(
          normalizePathForSync(realization.localProjectPath)
        )
        const localManifestComparison = localManifestComparisons.get(
          normalizePathForSync(realization.localProjectPath)
        )
        const duplicateRisk = classifyDuplicateRisk({
          localManifestComparison,
          realization,
          metadata: localMetadata,
        })

        return {
          role: 'duplicate',
          realization,
          duplicateRisk,
          autoCleanupEligible:
            duplicateRisk === 'exact' &&
            realizationIsOnlyInCloudLibraries(realization),
        }
      })
      const canonical = selectCanonicalRealization(relationshipRealizations)
      const localRealizations = relationshipRealizations.map((entry) =>
        entry === canonical
          ? {
              ...entry,
              role: 'canonical' as const,
              autoCleanupEligible: false,
            }
          : entry
      )
      const canonicalRealization = localRealizations.find(
        (entry) => entry.role === 'canonical'
      )
      const duplicateRealizations = localRealizations.filter(
        (entry) => entry.role === 'duplicate'
      )
      const preservedDefaultFile = firstMetadata
        ? preservedDefaultFiles.get(
            normalizePathForSync(firstMetadata.localProjectPath)
          )
        : undefined
      const modified =
        getModifiedTime?.(
          firstMetadata,
          canonicalRealization?.realization.modified ??
            remoteModifiedTime(remoteProject)
        ) ??
        canonicalRealization?.realization.modified ??
        remoteModifiedTime(remoteProject)

      return {
        id: cloudProjectRelationshipId(remoteProjectId),
        remoteProjectId,
        remoteProject,
        canonicalRealization,
        duplicateRealizations,
        localRealizations,
        name: relationshipName({
          canonical: canonicalRealization,
          remoteProject,
          metadata: firstMetadata,
          remoteProjectId,
        }),
        title: relationshipTitle({
          canonical: canonicalRealization,
          remoteProject,
          metadata: firstMetadata,
        }),
        modified: modified ?? undefined,
        remoteThumbnailUrl: remoteThumbnailUrls.get(remoteProjectId),
        defaultFile:
          canonicalRealization?.realization.defaultFile ?? preservedDefaultFile,
        conflict:
          canonicalRealization?.realization.conflict ?? firstMetadata?.conflict,
        syncFailure:
          firstMetadata?.lastFailure?.kind === 'remote-upload-forbidden'
            ? firstMetadata.lastFailure
            : undefined,
      }
    })
}

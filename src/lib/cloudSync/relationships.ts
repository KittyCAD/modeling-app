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

/**
 * Inputs for the pure cloud-relationship derivation pass.
 *
 * projectLibraries contributes local realizations. cloudSync adds cloud-side
 * project records, sync metadata, manifest comparisons, and remote artifacts.
 * Callers must gather those observations before calling this module; derivation
 * itself must not touch disk, network, or service methods.
 */
export type DeriveCloudProjectRelationshipsInput = {
  realizations: readonly ProjectLibraryRealization[]
  remoteProjects: readonly RemoteProjectSummary[]
  metadata: readonly CloudSyncProjectMetadataIndexEntry[]
  localManifestComparisons?: ReadonlyMap<
    string,
    CloudProjectLocalManifestComparison
  >
  remoteThumbnailUrls?: ReadonlyMap<string, string>
  getModifiedTime?: (
    metadata: CloudSyncProjectMetadataIndexEntry | undefined,
    localModified: number | null | undefined
  ) => number | null
}

/**
 * Facts used to classify cleanup risk for one local realization. Missing facts
 * deliberately degrade to `unknown` instead of pretending a folder is safe to
 * delete.
 */
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

/**
 * Result of comparing the current local project manifest against the clean base
 * manifest stored for the cloud relationship.
 */
export type CloudProjectLocalManifestComparison = {
  localMatchesBase?: boolean
  manifestReadable?: boolean
}

/**
 * Lookup tables built once per derivation so later helpers can operate on one
 * remote project ID at a time without repeating grouping or path normalization.
 */
type RelationshipInputIndex = {
  getModifiedTime?: DeriveCloudProjectRelationshipsInput['getModifiedTime']
  localManifestComparisons: ReadonlyMap<
    string,
    CloudProjectLocalManifestComparison
  >
  metadataByPath: ReadonlyMap<string, CloudSyncProjectMetadataIndexEntry>
  metadataByRemoteProjectId: ReadonlyMap<
    string,
    readonly CloudSyncProjectMetadataIndexEntry[]
  >
  realizationsByRemoteProjectId: ReadonlyMap<
    string,
    readonly ProjectLibraryRealization[]
  >
  remoteProjectIds: ReadonlySet<string>
  remoteProjectsById: ReadonlyMap<string, RemoteProjectSummary>
  remoteThumbnailUrls: ReadonlyMap<string, string>
}

/** The complete local, remote, and metadata context for one remote project ID. */
type RelationshipContext = {
  metadata: readonly CloudSyncProjectMetadataIndexEntry[]
  remoteProject?: RemoteProjectSummary
  remoteProjectId: string
  realizations: readonly ProjectLibraryRealization[]
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

/**
 * Canonical selection policy:
 * 1. Prefer a clean realization in a cloud library.
 * 2. Otherwise prefer any clean synced realization.
 * 3. Otherwise keep the newest local realization as a display-only fallback.
 */
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

function remoteModifiedTime(remoteProject: RemoteProjectSummary | undefined) {
  const modified = remoteProject?.updated_at
    ? Date.parse(remoteProject.updated_at)
    : NaN

  return Number.isNaN(modified) ? undefined : modified
}

function groupedMapSet<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key) ?? []
  values.push(value)
  map.set(key, values)
}

/**
 * Metadata can preserve a relationship even without a listed remote project or
 * readable local realization. This keeps conflicts and sync failures visible.
 */
function relationshipShouldExistForMetadata(
  metadata: CloudSyncProjectMetadataIndexEntry
) {
  return (
    !metadata.tombstone &&
    !metadata.syncExcluded &&
    (metadata.conflict || metadata.lastFailure)
  )
}

/** Groups every relationship input by normalized path and remote project ID. */
function indexRelationshipInputs({
  getModifiedTime,
  localManifestComparisons = new Map(),
  realizations,
  remoteProjects,
  metadata,
  remoteThumbnailUrls = new Map(),
}: DeriveCloudProjectRelationshipsInput): RelationshipInputIndex {
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

    if (relationshipShouldExistForMetadata(entry)) {
      remoteProjectIds.add(entry.remoteProjectId)
    }
    groupedMapSet(metadataByRemoteProjectId, entry.remoteProjectId, entry)
  }

  for (const realization of realizations) {
    const remoteProjectId = realization.cloudProjectId?.trim()
    if (!remoteProjectId) {
      continue
    }
    remoteProjectIds.add(remoteProjectId)
    groupedMapSet(realizationsByRemoteProjectId, remoteProjectId, realization)
  }

  return {
    getModifiedTime,
    localManifestComparisons,
    metadataByPath,
    metadataByRemoteProjectId,
    realizationsByRemoteProjectId,
    remoteProjectIds,
    remoteProjectsById,
    remoteThumbnailUrls,
  }
}

function relationshipContexts(
  index: RelationshipInputIndex
): RelationshipContext[] {
  return Array.from(index.remoteProjectIds)
    .toSorted((a, b) => a.localeCompare(b))
    .map((remoteProjectId) => ({
      metadata: index.metadataByRemoteProjectId.get(remoteProjectId) ?? [],
      remoteProject: index.remoteProjectsById.get(remoteProjectId),
      remoteProjectId,
      realizations:
        index.realizationsByRemoteProjectId.get(remoteProjectId) ?? [],
    }))
}

/**
 * Converts one local realization into relationship state. It starts as a
 * duplicate candidate; canonical selection happens only after all realizations
 * for the remote project ID are visible.
 */
function relationshipRealizationFromLocal(
  index: RelationshipInputIndex,
  realization: ProjectLibraryRealization
): CloudProjectRelationshipRealization {
  const normalizedProjectPath = normalizePathForSync(
    realization.localProjectPath
  )
  const duplicateRisk = classifyDuplicateRisk({
    localManifestComparison: index.localManifestComparisons.get(
      normalizedProjectPath
    ),
    realization,
    metadata: index.metadataByPath.get(normalizedProjectPath),
  })

  return {
    role: 'duplicate',
    realization,
    duplicateRisk,
    autoCleanupEligible:
      duplicateRisk === 'exact' &&
      realizationIsOnlyInCloudLibraries(realization),
  }
}

/** Marks one local realization canonical and leaves the rest as duplicates. */
function localRealizationsFromContext(
  index: RelationshipInputIndex,
  context: RelationshipContext
) {
  const relationshipRealizations = context.realizations.map((realization) =>
    relationshipRealizationFromLocal(index, realization)
  )
  const canonical = selectCanonicalRealization(relationshipRealizations)

  return relationshipRealizations.map((entry) =>
    entry === canonical
      ? {
          ...entry,
          role: 'canonical' as const,
          autoCleanupEligible: false,
        }
      : entry
  )
}

function relationshipModifiedTime({
  canonicalRealization,
  context,
  index,
}: {
  canonicalRealization?: CloudProjectRelationshipRealization
  context: RelationshipContext
  index: RelationshipInputIndex
}) {
  const localOrRemoteModified =
    canonicalRealization?.realization.modified ??
    remoteModifiedTime(context.remoteProject)

  return (
    index.getModifiedTime?.(context.metadata[0], localOrRemoteModified) ??
    localOrRemoteModified
  )
}

function relationshipConflict({
  canonicalRealization,
  context,
}: {
  canonicalRealization?: CloudProjectRelationshipRealization
  context: RelationshipContext
}) {
  return (
    canonicalRealization?.realization.conflict ?? context.metadata[0]?.conflict
  )
}

function relationshipSyncFailure(context: RelationshipContext) {
  const lastFailure = context.metadata[0]?.lastFailure
  return lastFailure?.kind === 'remote-upload-forbidden'
    ? lastFailure
    : undefined
}

/**
 * Builds the public cloud relationship for one remote project ID. Display-only
 * fields such as Home card name/title/default file are intentionally omitted;
 * Home derives them from the relationship plus canonical realization.
 */
function relationshipFromContext(
  index: RelationshipInputIndex,
  context: RelationshipContext
): CloudProjectRelationship {
  const localRealizations = localRealizationsFromContext(index, context)
  const canonicalRealization = localRealizations.find(
    (entry) => entry.role === 'canonical'
  )
  const duplicateRealizations = localRealizations.filter(
    (entry) => entry.role === 'duplicate'
  )
  const modified = relationshipModifiedTime({
    canonicalRealization,
    context,
    index,
  })

  return {
    id: cloudProjectRelationshipId(context.remoteProjectId),
    remoteProjectId: context.remoteProjectId,
    remoteProject: context.remoteProject,
    canonicalRealization,
    duplicateRealizations,
    localRealizations,
    modified: modified ?? undefined,
    remoteThumbnailUrl: index.remoteThumbnailUrls.get(context.remoteProjectId),
    conflict: relationshipConflict({ canonicalRealization, context }),
    syncFailure: relationshipSyncFailure(context),
  }
}

/**
 * Derives explicit remote-project-to-local-realization relationships. This is
 * where cloud identity resolution, canonical selection, and duplicate
 * classification happen; Home receives the result as already-resolved domain
 * state.
 */
export function deriveCloudProjectRelationships(
  input: DeriveCloudProjectRelationshipsInput
): CloudProjectRelationship[] {
  const index = indexRelationshipInputs(input)
  return relationshipContexts(index).map((context) =>
    relationshipFromContext(index, context)
  )
}

import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import { uniqueStrings } from '@src/lib/stringUtils'
import { isArray } from '@src/lib/utils'

export type HomeProjectSource = 'local' | 'remote' | 'both'

export type HomeProjectStatus =
  | 'local'
  | 'cloud-only'
  | 'syncing'
  | 'synced'
  | 'conflicted'

export type HomeProjectThumbnail =
  | {
      type: 'local'
      path: string
    }
  | {
      type: 'remote'
      url: string
    }

export interface HomeProjectEntry {
  id: string
  source: HomeProjectSource
  status: HomeProjectStatus
  libraryIds?: readonly string[]
  name: string
  title?: string
  localProjectPath?: string
  localProjectName?: string
  remoteProjectId?: string
  modified?: number
  defaultFile?: string
  kclFileCount?: number
  directoryCount?: number
  readWriteAccess: boolean
  thumbnail?: HomeProjectThumbnail
  conflict?: unknown
}

export type HomeProjectEntryContribution = Omit<
  HomeProjectEntry,
  'id' | 'libraryIds' | 'source'
> & {
  id?: string
  libraryId?: string
  libraryIds?: readonly string[]
  source: Exclude<HomeProjectSource, 'both'>
}

export type HomeProjectEntryContributionGroup =
  | HomeProjectEntryContribution
  | readonly HomeProjectEntryContribution[]

export type HomeProjectOpenResult = {
  defaultFile: string
}

export interface HomeProjectActionsService {
  canOpen: (project: HomeProjectEntry) => boolean
  canRename: (project: HomeProjectEntry) => boolean
  canDelete: (project: HomeProjectEntry) => boolean
  open: (
    project: HomeProjectEntry
  ) => Promise<HomeProjectOpenResult | undefined>
  rename: (project: HomeProjectEntry, requestedName: string) => Promise<void>
  delete: (project: HomeProjectEntry) => Promise<void>
}

function contributionBucketKey(entry: HomeProjectEntryContribution) {
  if (entry.remoteProjectId) {
    return `remote:${entry.remoteProjectId}`
  }
  if (entry.localProjectPath) {
    return `local:${entry.localProjectPath}`
  }
  return `${entry.source}:${entry.id ?? entry.name}`
}

function contributionStableId(entry: HomeProjectEntryContribution) {
  if (entry.localProjectPath) {
    return `local:${entry.localProjectPath}`
  }
  if (entry.remoteProjectId) {
    return `remote:${entry.remoteProjectId}`
  }
  return `${entry.source}:${entry.id ?? entry.name}`
}

function contributionLibraryIds(entry: HomeProjectEntryContribution) {
  return uniqueStrings([entry.libraryId, ...(entry.libraryIds ?? [])])
}

function entryFromContribution(
  contribution: HomeProjectEntryContribution
): HomeProjectEntry {
  const {
    libraryId: _libraryId,
    libraryIds: _libraryIds,
    ...entry
  } = contribution

  return {
    ...entry,
    id: contribution.id ?? contributionStableId(contribution),
    libraryIds: contributionLibraryIds(contribution),
  }
}

function mergeHomeProjectEntries(
  local: HomeProjectEntry | undefined,
  remote: HomeProjectEntry | undefined
): HomeProjectEntry | undefined {
  if (!local && !remote) {
    return undefined
  }
  if (!local) {
    return remote
  }
  if (!remote) {
    return local
  }

  const conflict = local.conflict ?? remote.conflict

  return {
    ...remote,
    ...local,
    id: local.id || remote.id,
    source: 'both',
    status: conflict
      ? 'conflicted'
      : remote.status === 'syncing'
        ? 'syncing'
        : 'synced',
    conflict,
    modified: Math.max(local.modified ?? 0, remote.modified ?? 0) || undefined,
    thumbnail: local.thumbnail ?? remote.thumbnail,
    readWriteAccess: local.readWriteAccess,
    libraryIds: uniqueStrings([
      ...(local.libraryIds ?? []),
      ...(remote.libraryIds ?? []),
    ]),
  }
}

/**
 * Same-source entries can overlap when multiple libraries point at the same
 * local or remote project. Keep the newest display data while preserving every
 * library membership so library-filtered views can still find the project.
 */
function mergeSameSourceHomeProjectEntries(
  existing: HomeProjectEntry | undefined,
  next: HomeProjectEntry
): HomeProjectEntry {
  if (!existing) {
    return next
  }

  return {
    ...existing,
    ...next,
    modified: Math.max(existing.modified ?? 0, next.modified ?? 0) || undefined,
    thumbnail: existing.thumbnail ?? next.thumbnail,
    libraryIds: uniqueStrings([
      ...(existing.libraryIds ?? []),
      ...(next.libraryIds ?? []),
    ]),
  }
}

/**
 * Coalesce independently contributed local and remote entries so Home renders a
 * single card for projects that are present in both places.
 */
export function coalesceHomeProjectEntries(
  contributionGroups: readonly HomeProjectEntryContributionGroup[]
) {
  const contributions = contributionGroups.flatMap((contribution) =>
    isArray(contribution) ? contribution : [contribution]
  )
  const buckets = new Map<
    string,
    {
      local?: HomeProjectEntry
      remote?: HomeProjectEntry
    }
  >()

  for (const contribution of contributions) {
    const key = contributionBucketKey(contribution)
    const entry = entryFromContribution(contribution)
    const bucket = buckets.get(key) ?? {}

    if (contribution.source === 'local') {
      bucket.local = mergeSameSourceHomeProjectEntries(bucket.local, entry)
    } else {
      bucket.remote = mergeSameSourceHomeProjectEntries(bucket.remote, entry)
    }

    buckets.set(key, bucket)
  }

  return Array.from(buckets.values()).flatMap(({ local, remote }) => {
    const entry = mergeHomeProjectEntries(local, remote)
    return entry ? [entry] : []
  })
}

export const homeProjectsContract = defineContract({
  homeProjectActionsService: defineService<HomeProjectActionsService>(
    'home-project-actions'
  ),
  homeProjectEntriesValueSpec: defineValueSpec<
    HomeProjectEntryContributionGroup,
    HomeProjectEntry[]
  >({
    name: 'home-project-entries',
    defaultValue: [],
    combine: coalesceHomeProjectEntries,
  }),
})

export const { homeProjectActionsService, homeProjectEntriesValueSpec } =
  homeProjectsContract

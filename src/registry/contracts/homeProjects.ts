import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import { isArray } from '@src/lib/utils'

export type HomeProjectSource = 'local' | 'remote' | 'merged'

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
  'id' | 'source'
> & {
  id?: string
  source: Exclude<HomeProjectSource, 'merged'>
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

function contributionKey(entry: HomeProjectEntryContribution) {
  if (entry.remoteProjectId) {
    return `remote:${entry.remoteProjectId}`
  }
  if (entry.localProjectPath) {
    return `local:${entry.localProjectPath}`
  }
  return `${entry.source}:${entry.id ?? entry.name}`
}

function entryFromContribution(
  contribution: HomeProjectEntryContribution
): HomeProjectEntry {
  return {
    ...contribution,
    id: contribution.id ?? contributionKey(contribution),
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

  return {
    ...remote,
    ...local,
    id: local.remoteProjectId
      ? `remote:${local.remoteProjectId}`
      : local.id || remote.id,
    source: 'merged',
    status: local.conflict
      ? 'conflicted'
      : remote.status === 'syncing'
        ? 'syncing'
        : 'synced',
    modified: Math.max(local.modified ?? 0, remote.modified ?? 0) || undefined,
    thumbnail: local.thumbnail ?? remote.thumbnail,
    readWriteAccess: local.readWriteAccess,
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
    const key = contributionKey(contribution)
    const entry = entryFromContribution(contribution)
    const bucket = buckets.get(key) ?? {}

    if (contribution.source === 'local') {
      bucket.local = entry
    } else {
      bucket.remote = entry
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

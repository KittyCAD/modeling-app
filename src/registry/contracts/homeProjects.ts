import { defineContract, defineValueSpec } from '@kittycad/registry'

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
): HomeProjectEntry {
  if (!local && !remote) {
    throw new Error('Expected a local or remote Home project entry.')
  }
  if (!local) {
    return remote as HomeProjectEntry
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

export function coalesceHomeProjectEntries(
  contributions: readonly HomeProjectEntryContribution[]
) {
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

  return Array.from(buckets.values(), ({ local, remote }) =>
    mergeHomeProjectEntries(local, remote)
  )
}

export const homeProjectsContract = defineContract({
  homeProjectEntriesValueSpec: defineValueSpec<
    HomeProjectEntryContribution,
    HomeProjectEntry[]
  >({
    name: 'home-project-entries',
    defaultValue: [],
    combine: coalesceHomeProjectEntries,
  }),
})

export const { homeProjectEntriesValueSpec } = homeProjectsContract

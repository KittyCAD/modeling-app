import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { Project } from '@src/lib/project'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import { uniqueStrings } from '@src/lib/stringUtils'
import { isArray } from '@src/lib/utils'
import type { CloudProjectDuplicateRisk } from '@src/registry/contracts/cloudSync'

export type HomeProjectSource = 'local' | 'remote'

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

export type HomeProjectSyncFailure = {
  message: string
  at?: string
  kind?: string
}

export interface HomeProjectDuplicateRealization {
  remoteProjectId: string
  canonicalProjectPath?: string
  localProjectPath: string
  localProjectName?: string
  title?: string
  libraryIds: readonly string[]
  libraryTitles: readonly string[]
  duplicateRisk: CloudProjectDuplicateRisk
  autoCleanupEligible: boolean
}

/**
 * Home project view model: UI-ready card data derived from project-library
 * realizations and cloudSync relationships. Home entries are presentation
 * models only; Home must not infer cloud identity, merge providers by cloud ID,
 * or manufacture a combined local/remote source.
 */
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
  /**
   * Delete confirmation wording is derived from explicit action semantics rather
   * than from library identity. A local cloud relationship may either delete only
   * its local realization or delete the backing remote project as well.
   */
  deleteRemoteOnDelete?: boolean
  modified?: number
  defaultFile?: string
  kclFileCount?: number
  directoryCount?: number
  readWriteAccess: boolean
  thumbnail?: HomeProjectThumbnail
  conflict?: unknown
  syncFailure?: HomeProjectSyncFailure
  cloudRelationshipId?: string
  duplicateRealizations?: readonly HomeProjectDuplicateRealization[]
}

export type HomeProjectEntryContribution = Omit<
  HomeProjectEntry,
  'id' | 'libraryIds'
> & {
  id?: string
  libraryId?: string
  libraryIds?: readonly string[]
}

export type HomeProjectEntryContributionGroup =
  | HomeProjectEntryContribution
  | readonly HomeProjectEntryContribution[]

export type HomeProjectOpenResult = {
  defaultFile: string
}

export interface HomeProjectMoveToLibraryTarget {
  library: ProjectLibrary
  sourceLibrary: ProjectLibrary
}

export interface HomeProjectActionsService {
  canOpen: (project: HomeProjectEntry) => boolean
  canDuplicate: (project: HomeProjectEntry) => boolean
  canRename: (project: HomeProjectEntry) => boolean
  canDelete: (project: HomeProjectEntry) => boolean
  canMoveToLibrary: (project: HomeProjectEntry) => boolean
  canReviewDuplicateRealizations: (project: HomeProjectEntry) => boolean
  open: (
    project: HomeProjectEntry
  ) => Promise<HomeProjectOpenResult | undefined>
  duplicate: (project: HomeProjectEntry) => Promise<void>
  rename: (project: HomeProjectEntry, requestedName: string) => Promise<void>
  renameLocalProject: (project: Project, requestedName: string) => Promise<void>
  delete: (project: HomeProjectEntry) => Promise<void>
  getMoveToLibraryTargets: (
    project: HomeProjectEntry
  ) => readonly HomeProjectMoveToLibraryTarget[]
  moveToLibrary: (
    project: HomeProjectEntry,
    targetLibraryId: string
  ) => Promise<HomeProjectOpenResult | undefined>
  deleteDuplicateRealizations: (
    project: HomeProjectEntry,
    duplicateProjectPaths: readonly string[]
  ) => Promise<void>
}

function contributionStableId(entry: HomeProjectEntryContribution) {
  if (entry.source === 'remote' && entry.remoteProjectId) {
    return `remote:${entry.remoteProjectId}`
  }
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

/**
 * Home entry contributions are flattened only. Identity resolution lives in
 * cloudSync relationships, and local realization path membership lives in
 * projectLibraries.
 */
export function combineHomeProjectEntryContributions(
  contributionGroups: readonly HomeProjectEntryContributionGroup[]
) {
  return contributionGroups
    .flatMap((contribution) =>
      isArray(contribution) ? contribution : [contribution]
    )
    .map(entryFromContribution)
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
    combine: combineHomeProjectEntryContributions,
  }),
})

export const { homeProjectActionsService, homeProjectEntriesValueSpec } =
  homeProjectsContract

import { Popover } from '@headlessui/react'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import {
  computed,
  effect,
  type Signal,
  signal,
  untracked,
} from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import { ActionIcon } from '@src/components/ActionIcon'
import {
  CloudConflictDialogHost,
  CloudSyncErrorDialogHost,
  openCloudConflictDialog,
  openCloudSyncErrorDialog,
  useCloudSyncProjectConflicts,
  useCloudSyncProjectConflict,
  useCloudSyncProjectMetadata,
} from '@src/components/CloudConflictDialog'
import type { CustomIconName } from '@src/components/CustomIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import {
  type CloudSyncProjectMetadataIndexEntry,
  type CloudSyncStatus,
  type ProjectManifest,
  cloudSyncRemoteProjects,
  cloudSyncStatus,
  duplicateRemoteCloudProject,
  getCloudSyncProjectModifiedTime,
  type RemoteProjectSummary,
  renameRemoteCloudProject,
  retryCloudSync,
  scheduleCloudProjectDirectoryNameSyncFromTitles,
} from '@src/lib/cloudSync'
import {
  getCloudProjectLibraryMaterializationDirectoryPath,
  normalizePathForSync,
} from '@src/lib/cloudSync/paths'
import { localProjectManifestMatchesBase } from '@src/lib/cloudSync/localManifest'
import {
  type CloudProjectLocalManifestComparison,
  classifyCloudProjectDuplicateRisk,
  deriveCloudProjectRelationships,
} from '@src/lib/cloudSync/relationships'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { writeProjectTitleToProjectToml } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { getHomeProjectDisplayName } from '@src/lib/homeProjects'
import { PATHS } from '@src/lib/paths'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { duplicateProjectInDirectory } from '@src/lib/projectDuplication'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  getDefaultCloudProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import { readProjectsFromProjectDirectory } from '@src/lib/projectLibraries/directoryScanner'
import {
  createProjectInLocalDirectory,
  moveProjectIntoLocalDirectory,
} from '@src/lib/projectLibraries/operations'
import { projectLibraryRealizationFromProject } from '@src/lib/projectLibraries/realizations'
import { invalidateProjectLibraryRealizations } from '@src/lib/projectLibraries/registry/invalidation'
import {
  canRevealInFileExplorer,
  revealInFileExplorer,
} from '@src/lib/revealInFileExplorer'
import { getResolvedTheme } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { userFeaturesContextHas } from '@src/machines/userFeaturesMachine'
import {
  type AppHeaderItemProps,
  appHeaderItemsValueSpec,
} from '@src/registry/contracts/appHeader'
import {
  cloudProjectRelationshipsService,
  cloudSyncService,
} from '@src/registry/contracts/cloudSync'
import {
  type ProjectExplorerProjectBreadcrumbBadgeComponentProps,
  type ProjectExplorerProjectMenuItemComponentProps,
  projectExplorerProjectBreadcrumbBadgesValueSpec,
  projectExplorerProjectMenuItemsValueSpec,
} from '@src/registry/contracts/projectExplorer'
import {
  type ProjectLibrarySettingsDetailsProps,
  type ProjectLibraryRealization,
  type ProjectLibraryTypeContribution,
  projectLibraryRealizationsValueSpec,
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { settingsService } from '@src/registry/contracts/settings'
import {
  nullableStatusBarItem,
  statusBarGlobalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { systemIOService } from '@src/registry/contracts/systemIO'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { Fragment, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

const CLOUD_SYNC_PLUGIN_ID = 'cloud-sync'
const CLOUD_SYNC_STALLED_AFTER_MS = 5 * 60_000

function cloudSyncProjectIsStalled(
  metadata: CloudSyncProjectMetadataIndexEntry | undefined,
  now = Date.now()
) {
  if (!metadata?.hasPendingChanges || !metadata.pendingSince) {
    return false
  }
  const pendingSince = Date.parse(metadata.pendingSince)
  return Number.isFinite(pendingSince)
    ? now - pendingSince >= CLOUD_SYNC_STALLED_AFTER_MS
    : false
}

function useCloudSyncProjectIsStalled(
  metadata: CloudSyncProjectMetadataIndexEntry | undefined
) {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (!metadata?.hasPendingChanges || !metadata.pendingSince) {
      return
    }
    const pendingSince = Date.parse(metadata.pendingSince)
    if (!Number.isFinite(pendingSince)) {
      return
    }
    const timeout = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, CLOUD_SYNC_STALLED_AFTER_MS - (Date.now() - pendingSince))
    )
    return () => clearTimeout(timeout)
  }, [metadata?.hasPendingChanges, metadata?.pendingSince])

  return cloudSyncProjectIsStalled(metadata, now)
}

type CloudSyncStatusBarPresentation = {
  label: string
  icon: CustomIconName
  iconClassName: string
  isBlocked: boolean
  tooltip: string
}

function CloudProjectLibrarySettingsDetails({
  library,
}: ProjectLibrarySettingsDetailsProps) {
  const [storagePath, setStoragePath] = useState<string>()

  useEffect(() => {
    let disposed = false

    getCloudProjectLibraryMaterializationDirectoryPath(library)
      .then((projectDirectoryPath) => {
        if (!disposed) {
          setStoragePath(projectDirectoryPath)
        }
      })
      .catch(() => {
        if (!disposed) {
          setStoragePath(undefined)
        }
      })

    return () => {
      disposed = true
    }
  }, [library])

  return (
    <div className="m-0 flex min-w-0 flex-1 items-center gap-2 text-sm">
      <p className="flex h-8 min-w-0 flex-1 items-center truncate px-1 text-2">
        {storagePath
          ? `Stored locally at ${storagePath}`
          : 'Resolving local storage path...'}
      </p>
      {canRevealInFileExplorer() && (
        <ActionButton
          Element="button"
          type="button"
          tabIndex={0}
          className="h-8 w-8 shrink-0 justify-center !p-0"
          iconStart={{
            icon: 'folderOpen',
            bgClassName: '!bg-transparent',
          }}
          disabled={!storagePath}
          onClick={() => {
            if (storagePath) {
              revealInFileExplorer(storagePath)
            }
          }}
        >
          <Tooltip position="top-right">Reveal in file explorer</Tooltip>
        </ActionButton>
      )}
    </div>
  )
}

export function getCloudSyncStatusBarPresentation(
  status: CloudSyncStatus
): CloudSyncStatusBarPresentation {
  const isSyncing = status.state === 'syncing'
  const isBlocked = status.state === 'failed' || status.state === 'conflict'
  const hasPendingChanges = status.pendingCount > 0
  const isRemoteUploadBlocked =
    status.lastFailureKind === 'remote-upload-forbidden'
  const label = isSyncing
    ? 'Cloud syncing'
    : status.state === 'conflict'
      ? 'Cloud conflict'
      : status.state === 'failed'
        ? isRemoteUploadBlocked
          ? 'Cloud sync blocked'
          : 'Cloud sync failed'
        : hasPendingChanges
          ? 'Cloud sync pending'
          : 'Cloud synced'
  const icon = isSyncing
    ? 'loading'
    : isBlocked
      ? 'triangleExclamation'
      : hasPendingChanges
        ? 'loading'
        : 'checkmark'
  const pendingText = `${status.pendingCount} cloud sync operation${
    status.pendingCount === 1 ? '' : 's'
  } pending.`

  return {
    label,
    icon,
    iconClassName:
      isSyncing || (!isBlocked && hasPendingChanges) ? 'animate-spin' : '',
    isBlocked,
    tooltip:
      status.lastFailure ||
      (hasPendingChanges ? pendingText : 'Cloud sync is up to date.'),
  }
}

function CloudSyncStatusBarItem() {
  useSignals()
  const location = useLocation()
  const status = cloudSyncStatus.value
  const activeProjectPath = status.activeProjectPath
  const conflictMetadata = useCloudSyncProjectConflict(activeProjectPath)
  const conflictMetadataList = useCloudSyncProjectConflicts()
  if (!status.enabled) {
    return null
  }

  const presentation = getCloudSyncStatusBarPresentation(status)
  const isHomeRoute = location.pathname.startsWith(PATHS.HOME)
  const isFileRoute = location.pathname.startsWith(PATHS.FILE)
  const canInspectConflict =
    status.state === 'conflict' &&
    isFileRoute &&
    activeProjectPath &&
    conflictMetadata?.conflict
  const shouldListConflicts = status.state === 'conflict' && isHomeRoute

  const statusBarButtonContent = (
    <>
      <ActionIcon
        icon={presentation.icon}
        iconClassName={presentation.iconClassName}
        bgClassName="bg-transparent dark:bg-transparent"
        size="sm"
      />
      <span>{presentation.label}</span>
      <Tooltip>{presentation.tooltip}</Tooltip>
    </>
  )

  const blockedClassName =
    status.state === 'conflict'
      ? 'text-warn-80 dark:text-warn-40'
      : presentation.isBlocked
        ? 'text-destroy-80 dark:text-destroy-40'
        : ''
  const statusBarClassName = `${defaultStatusBarItemClassNames} ${blockedClassName}`

  return shouldListConflicts ? (
    <Popover className="relative flex items-stretch">
      <Popover.Button as={Fragment}>
        <button
          className={statusBarClassName}
          data-testid="cloud-sync-status"
          type="button"
        >
          {statusBarButtonContent}
        </button>
      </Popover.Button>
      <Popover.Panel as={Fragment}>
        <div
          className="absolute left-0 bottom-full z-20 mb-1 flex w-72 max-w-[calc(100vw-1rem)] flex-col gap-1 rounded border border-chalkboard-30 bg-chalkboard-10 p-2 text-xs shadow-lg dark:border-chalkboard-80 dark:bg-chalkboard-90"
          data-testid="cloud-conflict-list"
        >
          <div className="px-2 py-1 font-bold text-chalkboard-100 dark:text-chalkboard-10">
            Projects with cloud conflicts
          </div>
          {conflictMetadataList === undefined ? (
            <p className="px-2 py-1 text-chalkboard-70 dark:text-chalkboard-40">
              Loading conflicted projects...
            </p>
          ) : conflictMetadataList.length > 0 ? (
            conflictMetadataList.map((metadata) => (
              <button
                key={metadata.localProjectPath}
                type="button"
                className="rounded px-2 py-1 text-left text-chalkboard-100 hover:bg-chalkboard-20 focus:bg-chalkboard-20 focus:outline-none dark:text-chalkboard-10 dark:hover:bg-chalkboard-80 dark:focus:bg-chalkboard-80"
                onClick={() =>
                  openCloudConflictDialog({
                    projectPath: metadata.localProjectPath,
                    projectName: metadata.projectName,
                  })
                }
              >
                {metadata.projectName}
              </button>
            ))
          ) : (
            <p className="px-2 py-1 text-chalkboard-70 dark:text-chalkboard-40">
              No conflicted projects found.
            </p>
          )}
        </div>
      </Popover.Panel>
    </Popover>
  ) : (
    <button
      type="button"
      className={statusBarClassName}
      data-testid="cloud-sync-status"
      onClick={() => {
        if (canInspectConflict && activeProjectPath) {
          openCloudConflictDialog({
            projectPath: activeProjectPath,
          })
          return
        }
        retryCloudSync()
      }}
    >
      {statusBarButtonContent}
    </button>
  )
}

const cloudSyncStatusBarItem = defineRegistryItemFactory((ctx) => {
  const settings = ctx.services.signal(settingsService)
  const userFeatures = ctx.services.signal(userFeaturesService)

  const statusBarItem = computed(() =>
    nullableStatusBarItem(
      settings.value &&
        userFeatures.value &&
        userFeaturesContextHas(
          userFeatures.value.context.value,
          OPFS_CLOUD_FEATURE_FLAG,
          false
        ) &&
        cloudSyncStatus.value.enabled
        ? {
            id: 'cloud-sync',
            component: CloudSyncStatusBarItem,
            scopes: ['home'],
            order: 2,
          }
        : null
    )
  )

  return {
    item: defineRuntimeRegistryItem({
      id: 'cloud-sync.status-bar-item',
      provides: [provide(statusBarGlobalItemsValueSpec, statusBarItem)],
    }),
  }
}, 'cloud-sync.status-bar-item')

const cloudSyncStatusBarItemContribution = defineRegistryItem({
  id: 'cloud-sync.status-bar-item-contribution',
  uses: [cloudSyncStatusBarItem],
})

function cloudSyncStatusAppliesToProject(
  status: CloudSyncStatus,
  projectPath: string
) {
  return (
    !status.activeProjectPath ||
    normalizePathForSync(status.activeProjectPath) ===
      normalizePathForSync(projectPath)
  )
}

function cloudSyncFailureAppliesToProject(
  status: CloudSyncStatus,
  projectPath: string
) {
  return (
    Boolean(status.lastFailure && status.activeProjectPath) &&
    normalizePathForSync(status.activeProjectPath ?? '') ===
      normalizePathForSync(projectPath)
  )
}

function CloudSyncProjectMenuItem({
  context,
  className,
  close,
}: ProjectExplorerProjectMenuItemComponentProps) {
  useSignals()
  const status = cloudSyncStatus.value
  const conflictMetadata = useCloudSyncProjectConflict(context.projectPath)
  const projectMetadata = useCloudSyncProjectMetadata(context.projectPath)
  const projectName = getProjectDisplayName(context.project)
  const presentation = getCloudSyncStatusBarPresentation(status)
  const isActiveProjectStatus = cloudSyncStatusAppliesToProject(
    status,
    context.projectPath
  )
  const durableFailure = projectMetadata?.lastFailure
  const hasStalledProjectWork = useCloudSyncProjectIsStalled(projectMetadata)
  const isError =
    status.enabled &&
    !conflictMetadata &&
    (Boolean(durableFailure) ||
      (status.state !== 'conflict' &&
        cloudSyncFailureAppliesToProject(status, context.projectPath)))
  const isStalled =
    status.enabled && !isError && !conflictMetadata && hasStalledProjectWork
  const errorMessage = isError
    ? durableFailure?.message ||
      status.lastFailure ||
      'Cloud sync failed without a reported error message.'
    : isStalled
      ? 'Cloud sync has local changes that have not reached the cloud after several retries.'
      : undefined

  if (!status.enabled) {
    return null
  }

  const isConflict =
    Boolean(conflictMetadata) ||
    (status.state === 'conflict' && isActiveProjectStatus)
  const hasCloudSyncProjectStatus =
    isConflict ||
    isError ||
    isStalled ||
    Boolean(status.scopedProjectCloudProjectId) ||
    (isActiveProjectStatus &&
      (status.state === 'syncing' || status.pendingCount > 0))

  if (!hasCloudSyncProjectStatus) {
    return null
  }

  const label = isConflict
    ? 'Cloud conflict'
    : isError
      ? status.lastFailureKind === 'remote-upload-forbidden'
        ? 'Cloud sync blocked'
        : 'Cloud sync failed'
      : isStalled
        ? 'Cloud sync stalled'
        : presentation.label
  const icon =
    isConflict || isStalled ? 'triangleExclamation' : presentation.icon
  const iconClassName = isConflict
    ? '!text-warn-80 dark:!text-warn-10'
    : isError
      ? '!text-destroy-80 dark:!text-destroy-20'
      : isStalled
        ? '!text-warn-80 dark:!text-warn-10'
        : `!text-chalkboard-60 dark:!text-chalkboard-40 ${presentation.iconClassName}`
  const statusClassName = isConflict
    ? 'bg-warn-10/60 text-warn-90 hover:!bg-warn-20 focus:!bg-warn-20 dark:bg-warn-80/20 dark:text-warn-10 dark:hover:!bg-warn-80/30 dark:focus:!bg-warn-80/30'
    : isError
      ? 'bg-destroy-10/60 text-destroy-80 hover:!bg-destroy-10 focus:!bg-destroy-10 dark:bg-destroy-80/20 dark:text-destroy-20 dark:hover:!bg-destroy-80/30 dark:focus:!bg-destroy-80/30'
      : isStalled
        ? 'bg-warn-10/60 text-warn-90 hover:!bg-warn-20 focus:!bg-warn-20 dark:bg-warn-80/20 dark:text-warn-10 dark:hover:!bg-warn-80/30 dark:focus:!bg-warn-80/30'
        : 'hover:!bg-chalkboard-20 focus:!bg-chalkboard-20 dark:hover:!bg-chalkboard-80 dark:focus:!bg-chalkboard-80'
  const dataTestId = isConflict
    ? 'project-sidebar-inspect-cloud-conflicts'
    : isError
      ? 'project-sidebar-inspect-cloud-sync-error'
      : isStalled
        ? 'project-sidebar-inspect-cloud-sync-stalled'
        : 'project-sidebar-cloud-sync-status'

  return (
    <li className="contents">
      <ActionButton
        Element="button"
        iconEnd={{
          icon,
          bgClassName: '!bg-transparent dark:!bg-transparent',
          iconClassName,
          size: 'sm',
        }}
        className={`${className}${statusClassName}`}
        onClick={() => {
          if (isConflict) {
            openCloudConflictDialog({
              projectPath: context.projectPath,
              projectName,
            })
            close()
            return
          }
          if (errorMessage) {
            openCloudSyncErrorDialog({
              title: label,
              message: errorMessage,
              projectName,
              occurredAt:
                durableFailure?.at ||
                status.lastFailureAt ||
                projectMetadata?.pendingSince,
            })
            close()
            return
          }

          retryCloudSync()
          close()
        }}
      >
        <span className="min-w-0 flex-1 truncate" data-testid={dataTestId}>
          {label}
        </span>
      </ActionButton>
    </li>
  )
}

function CloudSyncProjectBreadcrumbBadge({
  context,
  className,
}: ProjectExplorerProjectBreadcrumbBadgeComponentProps) {
  useSignals()
  const conflictMetadata = useCloudSyncProjectConflict(context.projectPath)
  const projectMetadata = useCloudSyncProjectMetadata(context.projectPath)
  const hasStalledProjectWork = useCloudSyncProjectIsStalled(projectMetadata)
  const status = cloudSyncStatus.value
  const isActiveProjectStatus = cloudSyncStatusAppliesToProject(
    status,
    context.projectPath
  )
  const isConflict =
    Boolean(conflictMetadata) ||
    (status.enabled && status.state === 'conflict' && isActiveProjectStatus)
  const isError =
    status.enabled &&
    !isConflict &&
    (Boolean(projectMetadata?.lastFailure) ||
      (status.state !== 'conflict' &&
        cloudSyncFailureAppliesToProject(status, context.projectPath)))
  const isStalled =
    status.enabled && !isConflict && !isError && hasStalledProjectWork

  if (!isConflict && !isError && !isStalled) {
    return null
  }

  const badge = isConflict
    ? {
        label: 'Cloud conflict',
        className: 'bg-warn-20 text-warn-90 dark:bg-warn-80 dark:text-warn-10',
        dataTestId: 'project-sidebar-cloud-conflict-badge',
      }
    : isError
      ? {
          label: 'Cloud error',
          className:
            'bg-destroy-10 text-destroy-80 ring-1 ring-inset ring-destroy-40 dark:bg-destroy-80 dark:text-destroy-10 dark:ring-destroy-70',
          dataTestId: 'project-sidebar-cloud-error-badge',
        }
      : {
          label: 'Cloud sync stalled',
          className:
            'bg-warn-20 text-warn-90 ring-1 ring-inset ring-warn-40 dark:bg-warn-80 dark:text-warn-10 dark:ring-warn-70',
          dataTestId: 'project-sidebar-cloud-stalled-badge',
        }

  return (
    <span
      className={`${className} ${badge.className}`}
      data-testid={badge.dataTestId}
    >
      {badge.label}
    </span>
  )
}

function CloudSyncDialogAppHeaderItem({ app }: AppHeaderItemProps) {
  const settingsValues = app.settings.useSettings()

  return (
    <>
      <CloudConflictDialogHost
        resolvedTheme={getResolvedTheme(settingsValues.app.theme.current)}
      />
      <CloudSyncErrorDialogHost />
    </>
  )
}

export { CloudConflictDialogHost }

const cloudSyncProjectBreadcrumbBadge = defineRegistryItemFactory(() => {
  return {
    item: defineRuntimeRegistryItem({
      id: 'cloud-sync.project-breadcrumb-badge',
      provides: [
        provide(
          projectExplorerProjectBreadcrumbBadgesValueSpec,
          {
            id: 'cloud-sync.project-breadcrumb-badge',
            order: 10,
            Component: CloudSyncProjectBreadcrumbBadge,
          },
          { key: 'cloud-sync.project-breadcrumb-badge' }
        ),
      ],
    }),
  }
}, 'cloud-sync.project-breadcrumb-badge')

const cloudSyncDialogAppHeaderItem = defineRegistryItemFactory(() => {
  return {
    item: defineRuntimeRegistryItem({
      id: 'cloud-sync.dialog-app-header-item',
      provides: [
        provide(
          appHeaderItemsValueSpec,
          {
            id: 'cloud-sync.dialog-app-header-item',
            order: 1000,
            Component: CloudSyncDialogAppHeaderItem,
          },
          { key: 'cloud-sync.dialog-app-header-item' }
        ),
      ],
    }),
  }
}, 'cloud-sync.dialog-app-header-item')

const cloudSyncProjectMenuItem = defineRegistryItemFactory(() => {
  return {
    item: defineRuntimeRegistryItem({
      id: 'cloud-sync.project-menu-item',
      provides: [
        provide(
          projectExplorerProjectMenuItemsValueSpec,
          {
            id: 'cloud-sync.project-menu-item',
            order: 9,
            Component: CloudSyncProjectMenuItem,
          },
          { key: 'cloud-sync.project-menu-item' }
        ),
      ],
    }),
  }
}, 'cloud-sync.project-menu-item')

function remoteThumbnailCacheKey(project: RemoteProjectSummary) {
  return [
    project.id,
    project.revision === undefined ? '' : String(project.revision),
    project.updated_at ?? '',
  ].join(':')
}

function setRemoteThumbnailUrl(
  thumbnailUrls: Signal<Map<string, string>>,
  remoteProjectId: string,
  thumbnailUrl: string
) {
  const nextThumbnailUrls = new Map(thumbnailUrls.value)
  nextThumbnailUrls.set(remoteProjectId, thumbnailUrl)
  thumbnailUrls.value = nextThumbnailUrls
}

function pruneRemoteThumbnailState({
  remoteProjects,
  requestedThumbnailKeys,
  thumbnailUrls,
}: {
  remoteProjects: RemoteProjectSummary[]
  requestedThumbnailKeys: Map<string, string>
  thumbnailUrls: Signal<Map<string, string>>
}) {
  const remoteProjectIds = new Set(remoteProjects.map((project) => project.id))

  for (const requestedProjectId of requestedThumbnailKeys.keys()) {
    if (!remoteProjectIds.has(requestedProjectId)) {
      requestedThumbnailKeys.delete(requestedProjectId)
    }
  }

  const currentThumbnailUrls = untracked(() => thumbnailUrls.value)
  const nextThumbnailUrls = new Map(
    Array.from(currentThumbnailUrls).filter(([remoteProjectId]) =>
      remoteProjectIds.has(remoteProjectId)
    )
  )

  if (nextThumbnailUrls.size !== currentThumbnailUrls.size) {
    thumbnailUrls.value = nextThumbnailUrls
  }
}

function groupedMetadataByRemoteProjectId(
  metadata: readonly CloudSyncProjectMetadataIndexEntry[]
) {
  const groups = new Map<string, CloudSyncProjectMetadataIndexEntry[]>()
  for (const entry of metadata) {
    if (!entry.remoteProjectId) {
      continue
    }

    groups.set(entry.remoteProjectId, [
      ...(groups.get(entry.remoteProjectId) ?? []),
      entry,
    ])
  }
  return groups
}

function firstCleanBaseManifest(
  metadataEntries: readonly CloudSyncProjectMetadataIndexEntry[] | undefined
): ProjectManifest | undefined {
  return metadataEntries?.find(
    (entry) => entry.baseManifest && !entry.tombstone && !entry.syncExcluded
  )?.baseManifest
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

function realizationIsInCloudLibrary(realization: ProjectLibraryRealization) {
  return realization.libraryRefs.some(
    (library) => library.type === CLOUD_PROJECT_LIBRARY_TYPE
  )
}

function cheapDuplicateRiskIsClean(
  realization: ProjectLibraryRealization,
  metadata: CloudSyncProjectMetadataIndexEntry | undefined
) {
  return (
    classifyCloudProjectDuplicateRisk({
      hasPendingChanges: metadata?.hasPendingChanges,
      hasConflict: Boolean(metadata?.conflict || realization.conflict),
      readWriteAccess: realization.readWriteAccess,
      tombstone: metadata?.tombstone,
      syncExcluded: Boolean(metadata?.syncExcluded),
    }) === 'unknown'
  )
}

function manifestComparisonCanonicalKey({
  metadata,
  realization,
}: {
  metadata: CloudSyncProjectMetadataIndexEntry | undefined
  realization: ProjectLibraryRealization
}) {
  const clean = cheapDuplicateRiskIsClean(realization, metadata)
  const cloudLibrary = realizationIsInCloudLibrary(realization)
  const modified = String(realization.modified ?? 0).padStart(16, '0')

  return [
    clean && cloudLibrary ? '2' : clean ? '1' : '0',
    modified,
    realization.localProjectPath,
  ].join(':')
}

function selectManifestComparisonCanonical({
  metadataByPath,
  realizations,
}: {
  metadataByPath: ReadonlyMap<string, CloudSyncProjectMetadataIndexEntry>
  realizations: readonly ProjectLibraryRealization[]
}) {
  return realizations.toSorted((left, right) => {
    const leftKey = manifestComparisonCanonicalKey({
      metadata: metadataByPath.get(normalizePathForSync(left.localProjectPath)),
      realization: left,
    })
    const rightKey = manifestComparisonCanonicalKey({
      metadata: metadataByPath.get(
        normalizePathForSync(right.localProjectPath)
      ),
      realization: right,
    })

    return rightKey.localeCompare(leftKey)
  })[0]
}

async function readLocalManifestComparisons({
  metadata,
  realizations,
}: {
  metadata: readonly CloudSyncProjectMetadataIndexEntry[]
  realizations: readonly ProjectLibraryRealization[]
}) {
  const comparisons = new Map<string, CloudProjectLocalManifestComparison>()
  const metadataByPath = new Map(
    metadata.map((entry) => [
      normalizePathForSync(entry.localProjectPath),
      entry,
    ])
  )
  const metadataByRemoteProjectId = groupedMetadataByRemoteProjectId(metadata)
  const realizationsByRemoteProjectId = new Map<
    string,
    ProjectLibraryRealization[]
  >()

  for (const realization of realizations) {
    const remoteProjectId = realization.cloudProjectId?.trim()
    if (!remoteProjectId) {
      continue
    }

    realizationsByRemoteProjectId.set(remoteProjectId, [
      ...(realizationsByRemoteProjectId.get(remoteProjectId) ?? []),
      realization,
    ])
  }

  await Promise.all(
    Array.from(realizationsByRemoteProjectId.entries()).flatMap(
      ([remoteProjectId, remoteRealizations]) => {
        if (remoteRealizations.length < 2) {
          return []
        }

        const canonical = selectManifestComparisonCanonical({
          metadataByPath,
          realizations: remoteRealizations,
        })
        const canonicalPath = canonical
          ? normalizePathForSync(canonical.localProjectPath)
          : undefined

        return remoteRealizations.map(async (realization) => {
          const normalizedLocalProjectPath = normalizePathForSync(
            realization.localProjectPath
          )
          const realizationMetadata = metadataByPath.get(
            normalizedLocalProjectPath
          )

          // Manifest comparison walks and hashes project files. Only pay that
          // cost for non-canonical cloud-library copies that could become
          // exact, silently removable duplicates.
          if (
            normalizedLocalProjectPath === canonicalPath ||
            !realizationIsOnlyInCloudLibraries(realization) ||
            !cheapDuplicateRiskIsClean(realization, realizationMetadata)
          ) {
            return
          }

          const baseManifest =
            realizationMetadata?.baseManifest ??
            firstCleanBaseManifest(
              metadataByRemoteProjectId.get(remoteProjectId)
            )

          if (!baseManifest) {
            return
          }

          try {
            comparisons.set(normalizedLocalProjectPath, {
              localMatchesBase: await localProjectManifestMatchesBase({
                baseManifest,
                localFs: fsZds,
                projectRoot: realization.localProjectPath,
              }),
            })
          } catch {
            comparisons.set(normalizedLocalProjectPath, {
              manifestReadable: false,
            })
          }
        })
      }
    )
  )

  return comparisons
}

const cloudSyncCloudProjectRelationships = defineRegistryItemFactory((ctx) => {
  const cloudSync = ctx.services.signal(cloudSyncService)
  const projectLibraryRealizations = ctx.valueSpecs.signal(
    projectLibraryRealizationsValueSpec
  )
  const cloudSyncMetadata = signal<CloudSyncProjectMetadataIndexEntry[]>([])
  const localManifestComparisons = signal<
    Map<string, CloudProjectLocalManifestComparison>
  >(new Map())
  const remoteThumbnailUrls = signal<Map<string, string>>(new Map())
  const requestedThumbnailKeys = new Map<string, string>()
  let disposed = false
  let disposeEffect: (() => void) | undefined
  let loadId = 0

  const cloudProjectRelationships = computed(() => {
    if (!cloudSyncStatus.value.enabled) {
      return []
    }

    return deriveCloudProjectRelationships({
      realizations: projectLibraryRealizations.value,
      remoteProjects: cloudSyncRemoteProjects.value,
      metadata: cloudSyncMetadata.value,
      localManifestComparisons: localManifestComparisons.value,
      remoteThumbnailUrls: remoteThumbnailUrls.value,
      getModifiedTime: getCloudSyncProjectModifiedTime,
    })
  })

  // Defer because `effect` runs immediately, and service reads are blocked
  // while the registry graph is still being built.
  queueMicrotask(() => {
    if (disposed) {
      return
    }

    // Keep Home cloud sync badges in sync with cloud sync metadata, even
    // before System IO rereads local project folders.
    disposeEffect = effect(() => {
      const service = cloudSync.value
      const status = cloudSyncStatus.value
      const nextLoadId = ++loadId

      if (!service || !status.enabled) {
        cloudSyncMetadata.value = []
        localManifestComparisons.value = new Map()
        remoteThumbnailUrls.value = new Map()
        requestedThumbnailKeys.clear()
        return
      }

      const remoteProjects = cloudSyncRemoteProjects.value
      const realizations = projectLibraryRealizations.value
      pruneRemoteThumbnailState({
        remoteProjects,
        requestedThumbnailKeys,
        thumbnailUrls: remoteThumbnailUrls,
      })

      for (const remoteProject of remoteProjects) {
        const cacheKey = remoteThumbnailCacheKey(remoteProject)
        if (requestedThumbnailKeys.get(remoteProject.id) === cacheKey) {
          continue
        }

        requestedThumbnailKeys.set(remoteProject.id, cacheKey)
        service
          .getRemoteProjectThumbnailUrl(remoteProject)
          .then((thumbnailUrl) => {
            if (
              disposed ||
              requestedThumbnailKeys.get(remoteProject.id) !== cacheKey ||
              !thumbnailUrl
            ) {
              return
            }

            setRemoteThumbnailUrl(
              remoteThumbnailUrls,
              remoteProject.id,
              thumbnailUrl
            )
          })
          .catch((error: unknown) => {
            if (requestedThumbnailKeys.get(remoteProject.id) === cacheKey) {
              requestedThumbnailKeys.delete(remoteProject.id)
            }
            reportRejection(error)
          })
      }

      service
        .getProjectMetadataIndex()
        .then((metadataIndex) => {
          if (disposed || nextLoadId !== loadId) {
            return
          }

          const metadata = Array.from(metadataIndex.values())
          cloudSyncMetadata.value = metadata

          readLocalManifestComparisons({
            metadata,
            realizations,
          })
            .then((comparisons) => {
              if (disposed || nextLoadId !== loadId) {
                return
              }

              localManifestComparisons.value = comparisons
            })
            .catch((error: unknown) => {
              if (!disposed && nextLoadId === loadId) {
                localManifestComparisons.value = new Map()
              }
              reportRejection(error)
            })
        })
        .catch((error: unknown) => {
          if (!disposed && nextLoadId === loadId) {
            cloudSyncMetadata.value = []
            localManifestComparisons.value = new Map()
          }
          reportRejection(error)
        })
    })
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'cloud-sync.cloud-project-relationships',
      providesServices: [
        provideService(cloudProjectRelationshipsService, {
          relationships: cloudProjectRelationships,
        }),
      ],
      dispose: () => {
        disposed = true
        disposeEffect?.()
      },
    }),
  }
}, 'cloud-sync.cloud-project-relationships')

/**
 * The `cloud` project-library *type* handler (browse/create in the local
 * Personal Cloud folder). This is registered as an always-on extension rather
 * than inside the cloud-sync plugin's toggle-able slot: on web the cloud folder
 * is the canonical project storage, so disabling cloud *sync* must not remove
 * the ability to list or create projects there. The plugin continues to own the
 * sync-only surface (remote entries, status bar, project-menu sync actions).
 */
export const cloudSyncProjectLibraryType = defineRegistryItemFactory((ctx) => {
  const systemIO = ctx.services.signal(systemIOService)
  const userFeatures = ctx.services.signal(userFeaturesService)
  const getWasmPromise = () =>
    ctx.valueSpecs.get(wasmPromiseValueSpec) ??
    new Error('Missing WASM promise registry value.')

  // A materialized cloud project can be listed either by System IO (when the
  // cloud folder is the app's project directory, e.g. on web) or by the
  // configured Personal Cloud library scan (e.g. on desktop). Refresh both so
  // local mutations show up regardless of which surface owns the entry.
  const refreshLocalCloudProjectEntries = () => {
    systemIO.value?.actor.send({
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
    })
    invalidateProjectLibraryRealizations()
  }

  const cloudLibraryType: ProjectLibraryTypeContribution = {
    type: CLOUD_PROJECT_LIBRARY_TYPE,
    title: 'Cloud',
    icon: 'cloud',
    order: 10,
    defaultSetting: getDefaultCloudProjectLibrarySetting(),
    newLibrarySetting: getDefaultCloudProjectLibrarySetting(),
    settingsDetails: CloudProjectLibrarySettingsDetails,
    operations: {
      createProject: {
        // Creating a project only needs the local library folder, so it stays
        // available whether or not cloud sync is currently enabled. When sync
        // is on we also enroll the new project; otherwise it is picked up the
        // next time sync is enabled through cloud-library auto-enrollment.
        run: async ({
          library,
          requestedProjectName,
          requestedProjectTitle,
          initialKclFile,
          initialProject,
        }) => {
          const wasmInstancePromise = getWasmPromise()
          if (wasmInstancePromise instanceof Error) {
            return Promise.reject(wasmInstancePromise)
          }

          const project = await createProjectInLocalDirectory({
            projectDirectoryPath:
              await getCloudProjectLibraryMaterializationDirectoryPath(library),
            requestedProjectName,
            requestedProjectTitle,
            wasmInstancePromise,
            initialKclFile,
            initialProject,
          })
          refreshLocalCloudProjectEntries()

          if (cloudSyncStatus.value.enabled) {
            await ctx.services
              .get(cloudSyncService)
              .startProjectSync(project.path)
          }

          return project
        },
      },
      duplicateProject: {
        run: async ({ library, project }) => {
          if (project.localProjectName && project.localProjectPath) {
            const wasmInstancePromise = getWasmPromise()
            if (wasmInstancePromise instanceof Error) {
              return Promise.reject(wasmInstancePromise)
            }

            const result = await duplicateProjectInDirectory({
              source: {
                directoryName: project.localProjectName,
                displayName: getHomeProjectDisplayName(project),
                path: project.localProjectPath,
              },
              projectDirectoryPath:
                await getCloudProjectLibraryMaterializationDirectoryPath(
                  library
                ),
              requestedProjectTitle: getHomeProjectDisplayName(project),
              wasmInstance: await wasmInstancePromise,
            })
            refreshLocalCloudProjectEntries()

            return result
          }

          if (!project.remoteProjectId) {
            return undefined
          }

          const sourceTitle = getHomeProjectDisplayName(project)
          const duplicatedProject = await duplicateRemoteCloudProject(
            project.remoteProjectId,
            sourceTitle
          )
          if (!duplicatedProject) {
            return undefined
          }

          return {
            message: `Successfully duplicated "${sourceTitle}" as "${duplicatedProject.title}"`,
            name: duplicatedProject.id,
            title: duplicatedProject.title,
          }
        },
      },
      // Rename/delete act on the remote project directly when it has not been
      // materialized locally. Once a local copy exists, they behave like a
      // normal local project: mutate the local files and let cloud sync
      // replicate the change to the remote.
      openProject: {
        run: ({ project }) => {
          if (!project.readWriteAccess || !project.defaultFile) {
            return undefined
          }

          return { defaultFile: project.defaultFile }
        },
      },
      renameProject: {
        run: async ({ project, requestedName }) => {
          const title = requestedName.trim()
          if (!title) {
            return
          }

          if (project.localProjectPath && project.readWriteAccess) {
            await writeProjectTitleToProjectToml(
              project.localProjectPath,
              title
            )
            refreshLocalCloudProjectEntries()
            return
          }

          if (project.remoteProjectId) {
            await renameRemoteCloudProject(project.remoteProjectId, title)
          }
        },
      },
      deleteProject: {
        run: async ({ project }) => {
          const remoteProjectId = project.remoteProjectId
          const cloudSyncActions = remoteProjectId
            ? ctx.services.get(cloudSyncService)
            : undefined
          if (
            remoteProjectId &&
            cloudSyncActions?.status.value.enabled !== true
          ) {
            return Promise.reject(new Error('Cloud sync is not enabled.'))
          }

          if (project.localProjectPath && project.readWriteAccess) {
            if (remoteProjectId) {
              await cloudSyncActions?.deleteLocalProjectRealizations(
                remoteProjectId,
                project.localProjectPath
              )
            } else {
              await fsZds.rm(project.localProjectPath, { recursive: true })
            }
            // Cloud-backed deletes are explicit local + remote product
            // actions, not just local tombstones for background sync.
            if (remoteProjectId) {
              await cloudSyncActions?.deleteRemoteProject(remoteProjectId)
            }
            refreshLocalCloudProjectEntries()
            return
          }

          if (remoteProjectId) {
            await cloudSyncActions?.deleteRemoteProject(remoteProjectId)
          }
        },
      },
      moveProjectFrom: {
        canMoveProject: ({ project }) =>
          Boolean(project.localProjectPath && project.readWriteAccess),
        run: async ({ project, targetLibrary }) => {
          if (!project.localProjectPath || !project.readWriteAccess) {
            return undefined
          }

          // Moving out of a cloud library is the product-level "make
          // local-only" policy. Detach before moving so the destination
          // directory cannot be re-adopted by its existing cloud project ID.
          if (targetLibrary.type !== CLOUD_PROJECT_LIBRARY_TYPE) {
            await ctx.services
              .get(cloudSyncService)
              .disconnectProjectSync(project.localProjectPath)
          }

          return {
            localProjectPath: project.localProjectPath,
            localProjectName:
              project.localProjectName ??
              fsZds.basename(project.localProjectPath),
            defaultFile: project.defaultFile,
          }
        },
      },
      moveProjectTo: {
        run: async ({ library, source }) => {
          const result = await moveProjectIntoLocalDirectory({
            projectDirectoryPath:
              await getCloudProjectLibraryMaterializationDirectoryPath(library),
            sourceProjectPath: source.localProjectPath,
            sourceProjectName: source.localProjectName,
            defaultFile: source.defaultFile,
          })

          if (cloudSyncStatus.value.enabled) {
            await ctx.services
              .get(cloudSyncService)
              .startProjectSync(result.localProjectPath)
          }

          refreshLocalCloudProjectEntries()

          return result
        },
      },
    },
    readRealizations: async ({ library, signal }) => {
      const wasmInstancePromise = getWasmPromise()
      if (wasmInstancePromise instanceof Error) {
        return Promise.reject(wasmInstancePromise)
      }

      const projects = await readProjectsFromProjectDirectory({
        projectDirectoryPath:
          await getCloudProjectLibraryMaterializationDirectoryPath(library),
        wasmInstancePromise,
        signal,
      })
      if (!signal.aborted) {
        scheduleCloudProjectDirectoryNameSyncFromTitles({
          projects,
          onProjectDirectoriesRenamed: invalidateProjectLibraryRealizations,
        })
      }

      return projects.map((project) =>
        projectLibraryRealizationFromProject(project, library)
      )
    },
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'cloud-sync.project-library-type',
      provides: [
        provide(projectLibrarySettingDefaultPoliciesValueSpec, {
          id: 'cloud-sync.personal-cloud-library-default-policy',
          priority: 10,
          getDefaultLibraries: ({ isDesktop }) =>
            !isDesktop &&
            userFeatures.value &&
            userFeaturesContextHas(
              userFeatures.value.context.value,
              OPFS_CLOUD_FEATURE_FLAG,
              false
            )
              ? [getDefaultCloudProjectLibrarySetting()]
              : undefined,
        }),
        provide(projectLibraryTypesValueSpec, cloudLibraryType, {
          key: 'cloud-sync.project-library-type',
        }),
      ],
    }),
  }
}, 'cloud-sync.project-library-type')

export const cloudSyncPlugin = createZdsPlugin({
  id: CLOUD_SYNC_PLUGIN_ID,
  title: 'Cloud sync',
  description: 'Cloud-backed project sync controls and status.',
  items: [
    cloudSyncDialogAppHeaderItem,
    cloudSyncProjectBreadcrumbBadge,
    cloudSyncProjectMenuItem,
    cloudSyncStatusBarItemContribution,
    cloudSyncCloudProjectRelationships,
  ],
  defaultSetting: 'off',
  // On web, cloud sync is the project storage layer rather than an optional
  // feature, so its toggle is hidden there and plugin activation policy keeps it
  // enabled for eligible users. Mirrors createZdsPlugin's default activation
  // setting otherwise.
  activationSetting: {
    category: 'plugins',
    settingName: CLOUD_SYNC_PLUGIN_ID,
    description: 'Whether the Cloud sync plugin is enabled.',
    hideOnLevel: 'project',
    hideOnPlatform: 'web',
    // Cloud sync is feature-gated; keep the toggle out of every settings
    // surface (settings panel, command bar, plugins list) for users without
    // the flag instead of special-casing the plugin id per surface.
    hideWithoutFeature: OPFS_CLOUD_FEATURE_FLAG,
    featurePolicy: {
      feature: OPFS_CLOUD_FEATURE_FLAG,
      defaultEnabled: true,
      forceEnabledOnPlatform: 'web',
      disableWithoutFeature: true,
    },
    userToml: {
      sectionKey: 'plugins',
      tomlKey: CLOUD_SYNC_PLUGIN_ID,
    },
  },
})

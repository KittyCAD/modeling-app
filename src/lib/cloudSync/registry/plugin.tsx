import { Popover } from '@headlessui/react'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
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
  CloudConflictDialog,
  useCloudSyncProjectConflict,
  useCloudSyncProjectConflicts,
} from '@src/components/CloudConflictDialog'
import type { CustomIconName } from '@src/components/CustomIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import {
  type CloudSyncProjectMetadataIndexEntry,
  type CloudSyncStatus,
  cloudSyncRemoteProjects,
  cloudSyncStatus,
  duplicateRemoteCloudProject,
  type RemoteProjectSummary,
  renameRemoteCloudProject,
  retryCloudSync,
  scheduleCloudProjectDirectoryNameSyncFromTitles,
} from '@src/lib/cloudSync'
import {
  getCloudProjectLibraryMaterializationDirectoryPath,
  normalizePathForSync,
} from '@src/lib/cloudSync/paths'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { writeProjectTitleToProjectToml } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import {
  getHomeProjectDisplayName,
  homeProjectEntryFromProject,
} from '@src/lib/homeProjects'
import { PATHS } from '@src/lib/paths'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { duplicateProjectInDirectory } from '@src/lib/projectDuplication'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  getDefaultCloudProjectLibrarySetting,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
} from '@src/lib/projectLibraries'
import { readProjectsFromProjectDirectory } from '@src/lib/projectLibraries/directoryScanner'
import {
  createProjectInLocalDirectory,
  moveProjectIntoLocalDirectory,
} from '@src/lib/projectLibraries/operations'
import {
  canRevealInFileExplorer,
  revealInFileExplorer,
} from '@src/lib/revealInFileExplorer'
import { getResolvedTheme, type ResolvedTheme } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { userFeaturesContextHas } from '@src/machines/userFeaturesMachine'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import {
  type HomeProjectEntryContribution,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import {
  type ProjectExplorerProjectMenuItemComponentProps,
  projectExplorerProjectMenuItemsValueSpec,
} from '@src/registry/contracts/projectExplorer'
import {
  type ProjectLibraryTypeContribution,
  type ProjectLibrarySettingsDetailsProps,
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
import { invalidateConfiguredProjectLibraryEntries } from '@src/registry/extensions/homeProjects'
import { Fragment, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

const CLOUD_SYNC_PLUGIN_ID = 'cloud-sync'

type CloudSyncStatusBarPresentation = {
  label: string
  icon: CustomIconName
  iconClassName: string
  isBlocked: boolean
  tooltip: string
}

type CloudConflictDialogRequest = {
  projectPath: string
  projectName?: string
}

const cloudConflictDialogRequest = signal<CloudConflictDialogRequest | null>(
  null
)

function openCloudConflictDialog(request: CloudConflictDialogRequest) {
  cloudConflictDialogRequest.value = request
}

const preservedCloudProjectDefaultFiles = signal<Map<string, string>>(new Map())

export function preserveCloudProjectDefaultFile({
  localProjectPath,
  defaultFile,
}: {
  localProjectPath?: string
  defaultFile?: string
}) {
  if (!localProjectPath || !defaultFile) {
    return
  }

  const nextDefaultFiles = new Map(preservedCloudProjectDefaultFiles.value)
  nextDefaultFiles.set(normalizePathForSync(localProjectPath), defaultFile)
  preservedCloudProjectDefaultFiles.value = nextDefaultFiles
}

function getPreservedCloudProjectDefaultFile(
  metadata: CloudSyncProjectMetadataIndexEntry | undefined
) {
  return metadata
    ? preservedCloudProjectDefaultFiles.value.get(
        normalizePathForSync(metadata.localProjectPath)
      )
    : undefined
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

function CloudSyncStatusBarItem({
  resolvedTheme,
}: {
  resolvedTheme: ResolvedTheme
}) {
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

  return (
    <>
      {shouldListConflicts ? (
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
      )}
      <CloudConflictDialogHost resolvedTheme={resolvedTheme} />
    </>
  )
}

const cloudSyncStatusBarItem = defineRegistryItemFactory((ctx) => {
  const settings = ctx.services.signal(settingsService)
  const userFeatures = ctx.services.signal(userFeaturesService)
  function CloudSyncStatusBarItemWithSettings() {
    const settingsValues = (
      settings.value as NonNullable<typeof settings.value>
    ).useSettings()
    return (
      <CloudSyncStatusBarItem
        resolvedTheme={getResolvedTheme(settingsValues.app.theme.current)}
      />
    )
  }

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
            component: CloudSyncStatusBarItemWithSettings,
            scopes: ['home', 'file'],
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

function CloudConflictProjectMenuItem({
  context,
  className,
  close,
}: ProjectExplorerProjectMenuItemComponentProps) {
  const conflictMetadata = useCloudSyncProjectConflict(context.projectPath)

  if (!conflictMetadata) {
    return null
  }

  return (
    <li className="contents">
      <ActionButton
        Element="button"
        iconStart={{
          icon: 'triangleExclamation',
          bgClassName: '!bg-transparent dark:!bg-transparent',
          iconClassName: '!text-warn-80 dark:!text-warn-10',
        }}
        className={`${className}bg-warn-10/50 text-warn-90 hover:!bg-warn-20 focus:!bg-warn-20 dark:bg-warn-80/20 dark:text-warn-10 dark:hover:!bg-warn-80/30 dark:focus:!bg-warn-80/30`}
        onClick={() => {
          openCloudConflictDialog({
            projectPath: context.projectPath,
            projectName: getProjectDisplayName(context.project),
          })
          close()
        }}
      >
        <span
          className="flex-1"
          data-testid="project-sidebar-inspect-cloud-conflicts"
        >
          Inspect cloud conflicts
        </span>
      </ActionButton>
    </li>
  )
}

export function CloudConflictDialogHost({
  resolvedTheme,
}: {
  resolvedTheme: ResolvedTheme
}) {
  useSignals()
  const dialog = cloudConflictDialogRequest.value

  useEffect(() => {
    return () => {
      cloudConflictDialogRequest.value = null
    }
  }, [])

  if (!dialog) {
    return null
  }

  return (
    <CloudConflictDialog
      projectPath={dialog.projectPath}
      projectName={dialog.projectName}
      resolvedTheme={resolvedTheme}
      onDismiss={() => {
        cloudConflictDialogRequest.value = null
      }}
      onResolved={() => {
        cloudConflictDialogRequest.value = null
      }}
    />
  )
}

const cloudConflictProjectMenuItem = defineRegistryItemFactory(() => {
  return {
    item: defineRuntimeRegistryItem({
      id: 'cloud-sync.conflict-project-menu-item',
      provides: [
        provide(
          projectExplorerProjectMenuItemsValueSpec,
          {
            id: 'cloud-sync.conflict-project-menu-item',
            order: 9,
            Component: CloudConflictProjectMenuItem,
          },
          { key: 'cloud-sync.conflict-project-menu-item' }
        ),
      ],
    }),
  }
}, 'cloud-sync.conflict-project-menu-item')

function getCloudSyncHomeProjectModifiedTime(
  project: { updated_at?: string },
  metadata?: CloudSyncProjectMetadataIndexEntry
) {
  const modified = metadata?.remoteUpdatedAt
    ? Date.parse(metadata.remoteUpdatedAt)
    : project.updated_at
      ? Date.parse(project.updated_at)
      : NaN

  return Number.isNaN(modified) ? undefined : modified
}

function homeProjectEntryCloudSyncFields(
  metadata: CloudSyncProjectMetadataIndexEntry | undefined
): Pick<
  HomeProjectEntryContribution,
  'conflict' | 'libraryId' | 'localProjectPath' | 'status' | 'syncFailure'
> {
  const syncFailure =
    metadata?.lastFailure?.kind === 'remote-upload-forbidden'
      ? metadata.lastFailure
      : undefined
  if (!metadata?.conflict) {
    return {
      libraryId: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
      status: 'cloud-only',
      ...(syncFailure
        ? { syncFailure, localProjectPath: metadata?.localProjectPath }
        : {}),
    }
  }

  return {
    libraryId: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
    status: 'conflicted',
    conflict: metadata.conflict,
    localProjectPath: metadata.localProjectPath,
    ...(syncFailure ? { syncFailure } : {}),
  }
}

function shouldContributeCloudSyncMetadata(
  metadata: CloudSyncProjectMetadataIndexEntry
) {
  return (
    Boolean(metadata.conflict) ||
    metadata.lastFailure?.kind === 'remote-upload-forbidden' ||
    Boolean(getPreservedCloudProjectDefaultFile(metadata))
  )
}

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

const cloudSyncRemoteHomeProjectEntryContribution = defineRegistryItemFactory(
  (ctx) => {
    const cloudSync = ctx.services.signal(cloudSyncService)
    const cloudSyncMetadata = signal<CloudSyncProjectMetadataIndexEntry[]>([])
    const remoteThumbnailUrls = signal<Map<string, string>>(new Map())
    const requestedThumbnailKeys = new Map<string, string>()
    let disposed = false
    let disposeEffect: (() => void) | undefined
    let loadId = 0

    const cloudSyncHomeProjectEntries = computed<
      HomeProjectEntryContribution[]
    >(() => {
      if (!cloudSyncStatus.value.enabled) {
        return []
      }

      const cloudSyncMetadataByRemoteProjectId = new Map(
        cloudSyncMetadata.value.flatMap((metadata) =>
          metadata.remoteProjectId
            ? ([[metadata.remoteProjectId, metadata]] as const)
            : []
        )
      )
      const remoteProjectIds = new Set(
        cloudSyncRemoteProjects.value.map((project) => project.id)
      )
      const remoteProjectEntries = cloudSyncRemoteProjects.value.map(
        (project) => {
          const metadata = cloudSyncMetadataByRemoteProjectId.get(project.id)
          const name = metadata?.projectName || project.title || project.id
          const thumbnailUrl = remoteThumbnailUrls.value.get(project.id)
          const defaultFile = getPreservedCloudProjectDefaultFile(metadata)

          return {
            source: 'remote',
            ...homeProjectEntryCloudSyncFields(metadata),
            name,
            title: metadata?.projectName || project.title,
            remoteProjectId: project.id,
            modified: getCloudSyncHomeProjectModifiedTime(project, metadata),
            readWriteAccess: true,
            ...(defaultFile ? { defaultFile } : {}),
            ...(thumbnailUrl
              ? {
                  thumbnail: {
                    type: 'remote',
                    url: thumbnailUrl,
                  },
                }
              : {}),
          } satisfies HomeProjectEntryContribution
        }
      )
      const localOnlyCloudSyncEntries = cloudSyncMetadata.value
        .filter(
          (metadata) =>
            !metadata.remoteProjectId ||
            !remoteProjectIds.has(metadata.remoteProjectId)
        )
        .map((metadata) => {
          const defaultFile = getPreservedCloudProjectDefaultFile(metadata)

          return {
            source: 'remote',
            ...homeProjectEntryCloudSyncFields(metadata),
            name: metadata.projectName,
            title: metadata.projectName,
            localProjectPath: metadata.localProjectPath,
            remoteProjectId: metadata.remoteProjectId,
            modified: getCloudSyncHomeProjectModifiedTime({}, metadata),
            readWriteAccess: true,
            ...(defaultFile ? { defaultFile } : {}),
          } satisfies HomeProjectEntryContribution
        })

      return [...remoteProjectEntries, ...localOnlyCloudSyncEntries]
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
          remoteThumbnailUrls.value = new Map()
          requestedThumbnailKeys.clear()
          return
        }

        const remoteProjects = cloudSyncRemoteProjects.value
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

            cloudSyncMetadata.value = Array.from(metadataIndex.values()).filter(
              (metadata) =>
                shouldContributeCloudSyncMetadata(metadata) &&
                !metadata.tombstone &&
                !metadata.syncExcluded
            )
          })
          .catch((error: unknown) => {
            if (!disposed && nextLoadId === loadId) {
              cloudSyncMetadata.value = []
            }
            reportRejection(error)
          })
      })
    })

    return {
      item: defineRuntimeRegistryItem({
        id: 'cloud-sync.remote-home-project-entries',
        provides: [
          provide(homeProjectEntriesValueSpec, cloudSyncHomeProjectEntries, {
            key: 'cloud-sync.remote-home-project-entries',
          }),
        ],
        dispose: () => {
          disposed = true
          disposeEffect?.()
        },
      }),
    }
  },
  'cloud-sync.remote-home-project-entries'
)

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
    invalidateConfiguredProjectLibraryEntries()
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
          })

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

          preserveCloudProjectDefaultFile({
            localProjectPath: result.localProjectPath,
            defaultFile: result.defaultFile,
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
    readEntries: async ({ library, signal }) => {
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
          onProjectDirectoriesRenamed:
            invalidateConfiguredProjectLibraryEntries,
        })
      }

      return projects.map((project) => ({
        ...homeProjectEntryFromProject(project),
        libraryId: library.id,
      }))
    },
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'cloud-sync.project-library-type',
      provides: [
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
    cloudConflictProjectMenuItem,
    cloudSyncStatusBarItemContribution,
    cloudSyncRemoteHomeProjectEntryContribution,
  ],
  defaultSetting: 'off',
  // On web, cloud sync is the project storage layer rather than an optional
  // feature, so its toggle is hidden there (and forced active by the app
  // runtime). Mirrors createZdsPlugin's default activation setting otherwise.
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
    userToml: {
      sectionKey: 'plugins',
      tomlKey: CLOUD_SYNC_PLUGIN_ID,
    },
  },
})

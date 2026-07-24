import { Dialog, Popover } from '@headlessui/react'
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
  type CloudSyncProjectMetadata,
  type CloudSyncProjectMetadataIndexEntry,
  type CloudSyncStatus,
  cloudSyncRemoteProjects,
  cloudSyncStatus,
  type RemoteProjectSummary,
  retryCloudSync,
} from '@src/lib/cloudSync'
import { getDefaultCloudProjectDirectoryPath } from '@src/lib/cloudSync/paths'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { PATHS } from '@src/lib/paths'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { homeProjectEntryFromProject } from '@src/lib/homeProjects'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  getDefaultCloudProjectLibrarySetting,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'
import { readProjectsFromProjectDirectory } from '@src/lib/projectLibraries/directoryScanner'
import { createProjectInLocalDirectory } from '@src/lib/projectLibraries/operations'
import {
  canRevealInFileExplorer,
  revealInFileExplorer,
} from '@src/lib/revealInFileExplorer'
import { getResolvedTheme, type ResolvedTheme } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'
import { userFeaturesContextHas } from '@src/machines/userFeaturesMachine'
import {
  type CloudSyncRegistryService,
  cloudSyncService,
} from '@src/registry/contracts/cloudSync'
import {
  type HomeProjectEntryContribution,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import {
  type ProjectExplorerProjectMenuItemComponentProps,
  projectExplorerProjectMenuItemsValueSpec,
} from '@src/registry/contracts/projectExplorer'
import {
  type ProjectLibrarySettingsDetailsProps,
  type ProjectLibraryTypeContribution,
  projectLibrariesValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import {
  nullableStatusBarItem,
  statusBarGlobalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { settingsService } from '@src/registry/contracts/settings'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { Fragment, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useLocation } from 'react-router-dom'

const CLOUD_SYNC_PLUGIN_ID = 'cloud-sync'

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

    getDefaultCloudProjectDirectoryPath()
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
  }, [])

  return (
    <div className="min-w-0 text-sm m-0 flex items-stretch gap-2">
      <p className="min-w-0 px-2 py-1 flex-1 truncate text-2">
        {storagePath
          ? `Stored locally at ${storagePath}`
          : 'Resolving local storage path...'}
      </p>
      {canRevealInFileExplorer() && (
        <ActionButton
          Element="button"
          type="button"
          tabIndex={0}
          className="!p-0"
          iconStart={{
            icon: 'folder',
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

type CloudSyncProjectMenuDialog =
  | {
      type: 'conflict'
      projectPath: string
      projectName: string
    }
  | {
      type: 'disconnect'
      projectPath: string
      projectName: string
      disconnectProjectSync: (projectPath: string) => Promise<void>
    }

const cloudSyncProjectMenuDialog = signal<CloudSyncProjectMenuDialog | null>(
  null
)

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function useCloudSyncProjectMetadata(
  projectPath: string,
  cloudSync: CloudSyncRegistryService | undefined
) {
  useSignals()
  const status = cloudSyncStatus.value
  const [metadata, setMetadata] = useState<
    CloudSyncProjectMetadata | undefined
  >()

  useEffect(() => {
    let cancelled = false

    if (!cloudSync || !status.enabled) {
      setMetadata(undefined)
      return
    }

    cloudSync
      .getProjectMetadata(projectPath)
      .then((nextMetadata) => {
        if (!cancelled) {
          setMetadata(nextMetadata)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMetadata(undefined)
        }
        reportRejection(error)
      })

    return () => {
      cancelled = true
    }
  }, [cloudSync, projectPath, status.enabled])

  return metadata
}

function CloudSyncDisconnectProjectDialog({
  projectPath,
  projectName,
  disconnectProjectSync,
  onDismiss,
}: {
  projectPath: string
  projectName: string
  disconnectProjectSync: (projectPath: string) => Promise<void>
  onDismiss: () => void
}) {
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  async function handleDisconnect() {
    setIsDisconnecting(true)
    try {
      await disconnectProjectSync(projectPath)
      toast.success('Cloud project deleted. Local project kept on this device.')
      onDismiss()
    } catch (error) {
      toast.error(messageFromError(error))
      reportRejection(error)
    } finally {
      setIsDisconnecting(false)
    }
  }

  return (
    <Dialog open={true} onClose={onDismiss} className="relative z-50">
      <div className="fixed inset-0 grid place-content-center bg-chalkboard-110/80 p-4">
        <Dialog.Panel
          className="w-full max-w-lg rounded border border-destroy-80 bg-chalkboard-10 p-4 shadow-lg dark:bg-chalkboard-100"
          data-testid="cloud-sync-disconnect-dialog"
        >
          <Dialog.Title as="h2" className="mb-2 text-2xl font-bold">
            Stop syncing project?
          </Dialog.Title>
          <Dialog.Description as="div" className="space-y-3 text-sm">
            <p className="break-words font-medium text-chalkboard-80 dark:text-chalkboard-30">
              {projectName}
            </p>
            <p>
              This will delete the cloud project and remove the cloud link from
              the local project. The files on this device will stay in place and
              future edits will be local-only.
            </p>
          </Dialog.Description>

          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <ActionButton
              Element="button"
              onClick={onDismiss}
              disabled={isDisconnecting}
              tabIndex={0}
            >
              Cancel
            </ActionButton>
            <ActionButton
              Element="button"
              data-testid="confirm-cloud-sync-disconnect"
              disabled={isDisconnecting}
              tabIndex={0}
              onClick={() => void handleDisconnect()}
              iconStart={{
                icon: 'trash',
                bgClassName: 'bg-destroy-10 dark:bg-destroy-80',
                iconClassName: '!text-destroy-80 dark:!text-destroy-20',
              }}
              className="border-destroy-60 bg-destroy-10/30 hover:border-destroy-60 dark:bg-destroy-80/20"
            >
              {isDisconnecting ? 'Deleting cloud project...' : 'Stop syncing'}
            </ActionButton>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}

function CloudSyncProjectMenuDialogHost({
  resolvedTheme,
}: {
  resolvedTheme: ResolvedTheme
}) {
  useSignals()
  const dialog = cloudSyncProjectMenuDialog.value

  if (!dialog) {
    return null
  }

  if (dialog.type === 'conflict') {
    return (
      <CloudConflictDialog
        projectPath={dialog.projectPath}
        projectName={dialog.projectName}
        resolvedTheme={resolvedTheme}
        onDismiss={() => {
          cloudSyncProjectMenuDialog.value = null
        }}
        onResolved={() => {
          cloudSyncProjectMenuDialog.value = null
        }}
      />
    )
  }

  return (
    <CloudSyncDisconnectProjectDialog
      projectPath={dialog.projectPath}
      projectName={dialog.projectName}
      disconnectProjectSync={dialog.disconnectProjectSync}
      onDismiss={() => {
        cloudSyncProjectMenuDialog.value = null
      }}
    />
  )
}

function CloudSyncProjectMenuItem({
  context,
  className,
  close,
  cloudSync,
}: ProjectExplorerProjectMenuItemComponentProps & {
  cloudSync: CloudSyncRegistryService | undefined
}) {
  useSignals()
  const status = cloudSyncStatus.value
  const project = context.project
  const projectName = getProjectDisplayName(project)
  const conflictMetadata = useCloudSyncProjectConflict(context.projectPath)
  const metadata = useCloudSyncProjectMetadata(context.projectPath, cloudSync)
  const userDisconnected =
    metadata?.syncExcluded?.reason === 'user-disconnected'
  const hasCloudProject = Boolean(
    !userDisconnected && (metadata?.remoteProjectId || project.cloudProjectId)
  )
  const isProjectSyncing =
    status.state === 'syncing' &&
    (!status.activeProjectPath || status.activeProjectPath === project.path)

  if (!status.enabled || !cloudSync || !project.readWriteAccess) {
    return null
  }

  if (conflictMetadata) {
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
            cloudSyncProjectMenuDialog.value = {
              type: 'conflict',
              projectPath: context.projectPath,
              projectName,
            }
            close()
          }}
        >
          <span className="flex-1" data-testid="inspect-cloud-conflicts">
            Inspect Conflicts
          </span>
        </ActionButton>
      </li>
    )
  }

  if (hasCloudProject) {
    return (
      <li className="contents">
        <ActionButton
          Element="button"
          iconStart={{
            icon: 'trash',
            bgClassName: '!bg-transparent dark:!bg-transparent',
            iconClassName: '!text-destroy-80 dark:!text-destroy-30',
          }}
          className={`${className}text-destroy-80 dark:text-destroy-30`}
          disabled={isProjectSyncing}
          onClick={() => {
            cloudSyncProjectMenuDialog.value = {
              type: 'disconnect',
              projectPath: context.projectPath,
              projectName,
              disconnectProjectSync: cloudSync.disconnectProjectSync,
            }
            close()
          }}
        >
          <span
            className="flex-1"
            data-testid="project-sidebar-disconnect-cloud-sync"
          >
            {isProjectSyncing ? 'Syncing...' : 'Stop syncing...'}
          </span>
        </ActionButton>
      </li>
    )
  }

  return (
    <li className="contents">
      <ActionButton
        Element="button"
        iconStart={{
          icon: 'share',
          bgClassName: '!bg-transparent dark:!bg-transparent',
        }}
        className={className}
        disabled={isProjectSyncing}
        onClick={() => {
          close()
          cloudSync
            .startProjectSync(context.projectPath)
            .then(() => toast.success('Cloud sync started.'))
            .catch((error: unknown) => {
              toast.error(messageFromError(error))
              reportRejection(error)
            })
        }}
      >
        <span className="flex-1" data-testid="project-sidebar-start-cloud-sync">
          {isProjectSyncing ? 'Syncing...' : 'Sync to cloud'}
        </span>
      </ActionButton>
    </li>
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
  const conflictMetadata = useCloudSyncProjectConflict(status.activeProjectPath)
  const conflictMetadataList = useCloudSyncProjectConflicts()
  const [isInspectingConflict, setIsInspectingConflict] = useState(false)
  const [selectedConflict, setSelectedConflict] = useState<
    CloudSyncProjectMetadata | undefined
  >()
  if (!status.enabled) {
    return null
  }

  const presentation = getCloudSyncStatusBarPresentation(status)
  const isHomeRoute = location.pathname.startsWith(PATHS.HOME)
  const isFileRoute = location.pathname.startsWith(PATHS.FILE)
  const canInspectConflict =
    status.state === 'conflict' &&
    isFileRoute &&
    status.activeProjectPath &&
    conflictMetadata?.conflict
  const selectedConflictProjectPath = selectedConflict?.localProjectPath
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
                    onClick={() => setSelectedConflict(metadata)}
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
            if (canInspectConflict) {
              setIsInspectingConflict(true)
              return
            }
            retryCloudSync()
          }}
        >
          {statusBarButtonContent}
        </button>
      )}
      {isInspectingConflict && status.activeProjectPath && (
        <CloudConflictDialog
          projectPath={status.activeProjectPath}
          resolvedTheme={resolvedTheme}
          onDismiss={() => setIsInspectingConflict(false)}
          onResolved={() => setIsInspectingConflict(false)}
        />
      )}
      {selectedConflictProjectPath && (
        <CloudConflictDialog
          projectPath={selectedConflictProjectPath}
          resolvedTheme={resolvedTheme}
          onDismiss={() => setSelectedConflict(undefined)}
          onResolved={() => setSelectedConflict(undefined)}
        />
      )}
      <CloudSyncProjectMenuDialogHost resolvedTheme={resolvedTheme} />
    </>
  )
}

const cloudSyncStatusBarItem = defineRegistryItemFactory((ctx) => {
  const settings = ctx.services.signal(settingsService)
  const userFeatures = ctx.services.signal(userFeaturesService)
  function CloudSyncStatusBarItemWithSettings() {
    const settingsValues = settings.value!.useSettings()
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

const cloudSyncProjectMenuItem = defineRegistryItemFactory((ctx) => {
  const cloudSync = ctx.services.signal(cloudSyncService)

  function CloudSyncProjectMenuItemWithService(
    props: ProjectExplorerProjectMenuItemComponentProps
  ) {
    useSignals()
    return <CloudSyncProjectMenuItem {...props} cloudSync={cloudSync.value} />
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'cloud-sync.project-menu-item',
      provides: [
        provide(
          projectExplorerProjectMenuItemsValueSpec,
          {
            id: 'cloud-sync.project-menu-item',
            order: 10,
            Component: CloudSyncProjectMenuItemWithService,
          },
          { key: 'cloud-sync.project-menu-item' }
        ),
      ],
    }),
  }
}, 'cloud-sync.project-menu-item')

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
    metadata.lastFailure?.kind === 'remote-upload-forbidden'
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

          return {
            source: 'remote',
            ...homeProjectEntryCloudSyncFields(metadata),
            name,
            title: metadata?.projectName || project.title,
            remoteProjectId: project.id,
            modified: getCloudSyncHomeProjectModifiedTime(project, metadata),
            readWriteAccess: true,
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
        .map(
          (metadata) =>
            ({
              source: 'remote',
              ...homeProjectEntryCloudSyncFields(metadata),
              name: metadata.projectName,
              title: metadata.projectName,
              localProjectPath: metadata.localProjectPath,
              remoteProjectId: metadata.remoteProjectId,
              modified: getCloudSyncHomeProjectModifiedTime({}, metadata),
              readWriteAccess: true,
            }) satisfies HomeProjectEntryContribution
        )

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

const cloudSyncProjectLibraryContribution = defineRegistryItemFactory((ctx) => {
  const settings = ctx.services.signal(settingsService)
  const library = computed<ProjectLibrary[]>(() => {
    const defaultCloudLibrary = getDefaultCloudProjectLibrarySetting()
    const configuredLibraries =
      settings.value?.current.value.app.libraries?.current
    const configuredCloudLibraryIndex =
      configuredLibraries?.findIndex(
        (library) =>
          library.type === defaultCloudLibrary.type &&
          library.path === defaultCloudLibrary.path
      ) ?? -1
    const configuredCloudLibrary =
      configuredCloudLibraryIndex === -1
        ? undefined
        : configuredLibraries?.[configuredCloudLibraryIndex]

    return [
      {
        ...defaultCloudLibrary,
        ...configuredCloudLibrary,
        id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
        icon: 'network',
        order:
          configuredCloudLibraryIndex === -1 ? 10 : configuredCloudLibraryIndex,
      },
    ]
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'cloud-sync.project-library',
      provides: [
        provide(projectLibrariesValueSpec, library, {
          key: 'cloud-sync.project-library',
        }),
      ],
    }),
  }
}, 'cloud-sync.project-library')

/**
 * The `cloud` project-library *type* handler (browse/create in the local
 * Personal Cloud folder). This is registered as an always-on extension rather
 * than inside the cloud-sync plugin's toggle-able slot: on web the cloud folder
 * is the canonical project storage, so disabling cloud *sync* must not remove
 * the ability to list or create projects there. The plugin continues to own the
 * sync-only surface (remote entries, status bar, project-menu sync actions).
 */
export const cloudSyncProjectLibraryType = defineRegistryItemFactory((ctx) => {
  const getWasmPromise = () =>
    ctx.valueSpecs.get(wasmPromiseValueSpec) ??
    Promise.reject(new Error('Missing WASM promise registry value.'))

  const cloudLibraryType: ProjectLibraryTypeContribution = {
    type: CLOUD_PROJECT_LIBRARY_TYPE,
    title: 'Cloud',
    icon: 'network',
    order: 10,
    defaultSetting: getDefaultCloudProjectLibrarySetting(),
    newLibrarySetting: getDefaultCloudProjectLibrarySetting(),
    settingsDetails: CloudProjectLibrarySettingsDetails,
    operations: {
      createProject: {
        // Creating a project only needs the local library folder, so it stays
        // available whether or not cloud sync is currently enabled. When sync
        // is on we also enroll the new project; otherwise it is picked up the
        // next time sync is enabled (via syncExistingLocalProjects on web /
        // startProjectSync on desktop).
        run: async ({ requestedProjectName, requestedProjectTitle }) => {
          const project = await createProjectInLocalDirectory({
            projectDirectoryPath: await getDefaultCloudProjectDirectoryPath(),
            requestedProjectName,
            requestedProjectTitle,
            wasmInstancePromise: getWasmPromise(),
          })

          if (cloudSyncStatus.value.enabled) {
            await ctx.services
              .get(cloudSyncService)
              .startProjectSync(project.path)
          }

          return project
        },
      },
    },
    readEntries: async ({ signal }) => {
      const projects = await readProjectsFromProjectDirectory({
        projectDirectoryPath: await getDefaultCloudProjectDirectoryPath(),
        wasmInstancePromise: getWasmPromise(),
        signal,
      })

      return projects.map((project) => ({
        ...homeProjectEntryFromProject(project),
        libraryId: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
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
    cloudSyncProjectLibraryContribution,
    cloudSyncStatusBarItemContribution,
    cloudSyncProjectMenuItem,
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
    userToml: {
      sectionKey: 'plugins',
      tomlKey: CLOUD_SYNC_PLUGIN_ID,
    },
  },
})

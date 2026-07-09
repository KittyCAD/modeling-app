import { Dialog, Popover } from '@headlessui/react'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed, effect, signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { ActionIcon } from '@src/components/ActionIcon'
import { ActionButton } from '@src/components/ActionButton'
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
  retryCloudSync,
} from '@src/lib/cloudSync'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { PATHS } from '@src/lib/paths'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { reportRejection } from '@src/lib/trap'
import { userFeaturesContextHas } from '@src/machines/userFeaturesMachine'
import {
  type CloudSyncRegistryService,
  cloudSyncService,
} from '@src/registry/contracts/cloudSync'
import {
  nullableStatusBarItem,
  statusBarGlobalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import {
  type HomeProjectEntryContribution,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import {
  type ProjectExplorerProjectMenuItemComponentProps,
  projectExplorerProjectMenuItemsValueSpec,
} from '@src/registry/contracts/projectExplorer'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { Fragment, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useLocation } from 'react-router-dom'

type CloudSyncStatusBarPresentation = {
  label: string
  icon: CustomIconName
  iconClassName: string
  isBlocked: boolean
  tooltip: string
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
  }, [
    cloudSync,
    projectPath,
    status.enabled,
    status.state,
    status.pendingCount,
    status.lastFailureAt,
    status.lastSyncedAt,
  ])

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

function CloudSyncProjectMenuDialogHost() {
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
  const label = isSyncing
    ? 'Cloud syncing'
    : status.state === 'conflict'
      ? 'Cloud conflict'
      : status.state === 'failed'
        ? 'Cloud sync failed'
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
  const projectName = status.activeProjectPath
    ?.split(/[\\/]/)
    .filter(Boolean)
    .at(-1)
  const selectedConflictProjectName = selectedConflict?.projectName
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
          projectName={projectName || 'this project'}
          onDismiss={() => setIsInspectingConflict(false)}
          onResolved={() => setIsInspectingConflict(false)}
        />
      )}
      {selectedConflictProjectPath && selectedConflictProjectName && (
        <CloudConflictDialog
          projectPath={selectedConflictProjectPath}
          projectName={selectedConflictProjectName}
          onDismiss={() => setSelectedConflict(undefined)}
          onResolved={() => setSelectedConflict(undefined)}
        />
      )}
      <CloudSyncProjectMenuDialogHost />
    </>
  )
}

const cloudSyncStatusBarItem = defineRegistryItemFactory((ctx) => {
  const userFeatures = ctx.services.signal(userFeaturesService)
  const statusBarItem = computed(() =>
    nullableStatusBarItem(
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

function homeProjectEntryConflictFields(
  metadata: CloudSyncProjectMetadataIndexEntry | undefined
): Pick<
  HomeProjectEntryContribution,
  'conflict' | 'localProjectPath' | 'status'
> {
  return metadata?.conflict
    ? {
        status: 'conflicted',
        conflict: metadata.conflict,
        localProjectPath: metadata.localProjectPath,
      }
    : { status: 'cloud-only' }
}

const cloudSyncRemoteHomeProjectEntryContribution = defineRegistryItemFactory(
  (ctx) => {
    const cloudSync = ctx.services.signal(cloudSyncService)
    const conflictMetadata = signal<CloudSyncProjectMetadataIndexEntry[]>([])
    let disposed = false
    let disposeEffect: (() => void) | undefined
    let loadId = 0

    const cloudSyncHomeProjectEntries = computed<
      HomeProjectEntryContribution[]
    >(() => {
      if (!cloudSyncStatus.value.enabled) {
        return []
      }

      const conflictMetadataByRemoteProjectId = new Map(
        conflictMetadata.value.flatMap((metadata) =>
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
          const metadata = conflictMetadataByRemoteProjectId.get(project.id)
          const name = metadata?.projectName || project.title || project.id

          return {
            source: 'remote',
            ...homeProjectEntryConflictFields(metadata),
            name,
            title: metadata?.projectName || project.title,
            remoteProjectId: project.id,
            modified: getCloudSyncHomeProjectModifiedTime(project, metadata),
            readWriteAccess: true,
          } satisfies HomeProjectEntryContribution
        }
      )
      const localOnlyConflictEntries = conflictMetadata.value
        .filter(
          (metadata) =>
            !metadata.remoteProjectId ||
            !remoteProjectIds.has(metadata.remoteProjectId)
        )
        .map(
          (metadata) =>
            ({
              source: 'remote',
              status: 'conflicted',
              name: metadata.projectName,
              title: metadata.projectName,
              localProjectPath: metadata.localProjectPath,
              remoteProjectId: metadata.remoteProjectId,
              modified: getCloudSyncHomeProjectModifiedTime({}, metadata),
              readWriteAccess: true,
              conflict: metadata.conflict,
            }) satisfies HomeProjectEntryContribution
        )

      return [...remoteProjectEntries, ...localOnlyConflictEntries]
    })

    // Defer because `effect` runs immediately, and service reads are blocked
    // while the registry graph is still being built.
    queueMicrotask(() => {
      if (disposed) {
        return
      }

      // Keep Home conflict badges in sync with cloud sync metadata, even
      // before System IO rereads local project folders.
      disposeEffect = effect(() => {
        const service = cloudSync.value
        const status = cloudSyncStatus.value
        const nextLoadId = ++loadId

        if (!service || !status.enabled) {
          conflictMetadata.value = []
          return
        }

        service
          .getProjectMetadataIndex()
          .then((metadataIndex) => {
            if (disposed || nextLoadId !== loadId) {
              return
            }

            conflictMetadata.value = Array.from(metadataIndex.values()).filter(
              (metadata) =>
                Boolean(metadata.conflict) &&
                !metadata.tombstone &&
                !metadata.syncExcluded
            )
          })
          .catch((error: unknown) => {
            if (!disposed && nextLoadId === loadId) {
              conflictMetadata.value = []
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

export const cloudSyncPlugin = createZdsPlugin({
  id: 'cloud-sync',
  title: 'Cloud sync',
  description: 'Cloud-backed project sync controls and status.',
  items: [
    cloudSyncStatusBarItemContribution,
    cloudSyncProjectMenuItem,
    cloudSyncRemoteHomeProjectEntryContribution,
  ],
  defaultSetting: 'core',
})

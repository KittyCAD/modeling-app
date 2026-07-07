import { Popover } from '@headlessui/react'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
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
  type CloudSyncStatus,
  cloudSyncStatus,
  retryCloudSync,
} from '@src/lib/cloudSync'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { PATHS } from '@src/lib/paths'
import { userFeaturesContextHas } from '@src/machines/userFeaturesMachine'
import {
  nullableStatusBarItem,
  statusBarGlobalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { Fragment, createElement, useState } from 'react'
import { useLocation } from 'react-router-dom'

type CloudSyncStatusBarPresentation = {
  label: string
  icon: CustomIconName
  iconClassName: string
  isBlocked: boolean
  tooltip: string
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

  const statusBarButtonChildren = [
    createElement(ActionIcon, {
      key: 'icon',
      icon: presentation.icon,
      iconClassName: presentation.iconClassName,
      bgClassName: 'bg-transparent dark:bg-transparent',
      size: 'sm',
    }),
    createElement('span', { key: 'label' }, presentation.label),
    createElement(Tooltip, { key: 'tooltip' }, presentation.tooltip),
  ]

  const blockedClassName =
    status.state === 'conflict'
      ? 'text-warn-80 dark:text-warn-40'
      : presentation.isBlocked
        ? 'text-destroy-80 dark:text-destroy-40'
        : ''
  const statusBarClassName = `${defaultStatusBarItemClassNames} ${blockedClassName}`

  return createElement(
    Fragment,
    null,
    shouldListConflicts
      ? createElement(
          Popover,
          { className: 'relative flex items-stretch' },
          createElement(
            Popover.Button,
            {
              as: Fragment,
            },
            createElement(
              'button',
              {
                className: statusBarClassName,
                'data-testid': 'cloud-sync-status',
                type: 'button',
              },
              ...statusBarButtonChildren
            )
          ),
          createElement(
            Popover.Panel,
            {
              as: Fragment,
            },
            createElement(
              'div',
              {
                className:
                  'absolute left-0 bottom-full z-20 mb-1 flex w-72 max-w-[calc(100vw-1rem)] flex-col gap-1 rounded border border-chalkboard-30 bg-chalkboard-10 p-2 text-xs shadow-lg dark:border-chalkboard-80 dark:bg-chalkboard-90',
                'data-testid': 'cloud-conflict-list',
              },
              createElement(
                'div',
                {
                  className:
                    'px-2 py-1 font-bold text-chalkboard-100 dark:text-chalkboard-10',
                },
                'Projects with cloud conflicts'
              ),
              conflictMetadataList === undefined
                ? createElement(
                    'p',
                    {
                      className:
                        'px-2 py-1 text-chalkboard-70 dark:text-chalkboard-40',
                    },
                    'Loading conflicted projects...'
                  )
                : conflictMetadataList.length > 0
                  ? conflictMetadataList.map((metadata) =>
                      createElement(
                        'button',
                        {
                          key: metadata.localProjectPath,
                          type: 'button',
                          className:
                            'rounded px-2 py-1 text-left text-chalkboard-100 hover:bg-chalkboard-20 focus:bg-chalkboard-20 focus:outline-none dark:text-chalkboard-10 dark:hover:bg-chalkboard-80 dark:focus:bg-chalkboard-80',
                          onClick: () => setSelectedConflict(metadata),
                        },
                        metadata.projectName
                      )
                    )
                  : createElement(
                      'p',
                      {
                        className:
                          'px-2 py-1 text-chalkboard-70 dark:text-chalkboard-40',
                      },
                      'No conflicted projects found.'
                    )
            )
          )
        )
      : createElement(
          'button',
          {
            type: 'button',
            className: statusBarClassName,
            'data-testid': 'cloud-sync-status',
            onClick: () => {
              if (canInspectConflict) {
                setIsInspectingConflict(true)
                return
              }
              retryCloudSync()
            },
          },
          ...statusBarButtonChildren
        ),
    isInspectingConflict &&
      status.activeProjectPath &&
      createElement(CloudConflictDialog, {
        projectPath: status.activeProjectPath,
        projectName: projectName || 'this project',
        onDismiss: () => setIsInspectingConflict(false),
        onResolved: () => setIsInspectingConflict(false),
      }),
    selectedConflictProjectPath &&
      selectedConflictProjectName &&
      createElement(CloudConflictDialog, {
        projectPath: selectedConflictProjectPath,
        projectName: selectedConflictProjectName,
        onDismiss: () => setSelectedConflict(undefined),
        onResolved: () => setSelectedConflict(undefined),
      })
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

export const cloudSyncPlugin = createZdsPlugin({
  id: 'cloud-sync',
  title: 'Cloud sync',
  description: 'Cloud-backed project sync controls and status.',
  items: [cloudSyncStatusBarItemContribution],
  defaultSetting: 'core',
})

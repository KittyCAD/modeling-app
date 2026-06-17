import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { ActionIcon } from '@src/components/ActionIcon'
import type { CustomIconName } from '@src/components/CustomIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import {
  type OPFSCloudSyncStatus,
  opfsCloudSyncStatus,
  retryOpfsCloudSync,
} from '@src/lib/fs-zds/opfsCloud'
import { userFeaturesContextHas } from '@src/machines/userFeaturesMachine'
import {
  nullableStatusBarItem,
  statusBarGlobalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { createElement } from 'react'

type CloudSyncStatusBarPresentation = {
  label: string
  icon: CustomIconName
  iconClassName: string
  isBlocked: boolean
  tooltip: string
}

export function getCloudSyncStatusBarPresentation(
  status: OPFSCloudSyncStatus
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
        ? 'refresh'
        : 'checkmark'
  const pendingText = `${status.pendingCount} cloud sync operation${
    status.pendingCount === 1 ? '' : 's'
  } pending.`

  return {
    label,
    icon,
    iconClassName: isSyncing ? 'animate-spin' : '',
    isBlocked,
    tooltip:
      status.lastFailure ||
      (hasPendingChanges ? pendingText : 'Cloud sync is up to date.'),
  }
}

function CloudSyncStatusBarItem() {
  useSignals()
  const status = opfsCloudSyncStatus.value
  if (!status.enabled) {
    return null
  }

  const presentation = getCloudSyncStatusBarPresentation(status)

  return createElement(
    'button',
    {
      type: 'button',
      className: `${defaultStatusBarItemClassNames} ${
        presentation.isBlocked ? 'text-destroy-80 dark:text-destroy-40' : ''
      }`,
      'data-testid': 'cloud-sync-status',
      onClick: retryOpfsCloudSync,
    },
    createElement(ActionIcon, {
      icon: presentation.icon,
      iconClassName: presentation.iconClassName,
      bgClassName: 'bg-transparent dark:bg-transparent',
      size: 'sm',
    }),
    createElement('span', null, presentation.label),
    createElement(Tooltip, null, presentation.tooltip)
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
        opfsCloudSyncStatus.value.enabled
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

const cloudSyncExtension = defineRegistryItem({
  id: 'cloud-sync-extension',
  uses: [cloudSyncStatusBarItem],
})

export default cloudSyncExtension

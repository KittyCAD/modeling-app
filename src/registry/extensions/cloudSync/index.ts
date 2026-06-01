import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { ActionIcon } from '@src/components/ActionIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import {
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

function CloudSyncStatusBarItem() {
  useSignals()
  const status = opfsCloudSyncStatus.value
  if (!status.enabled) {
    return null
  }

  const isBusy = status.state === 'syncing'
  const isBlocked = status.state === 'failed' || status.state === 'conflict'
  const label =
    status.state === 'syncing'
      ? 'Cloud syncing'
      : status.state === 'conflict'
        ? 'Cloud conflict'
        : status.state === 'failed'
          ? 'Cloud sync failed'
          : status.pendingCount > 0
            ? 'Cloud sync pending'
            : 'Cloud synced'
  const icon = isBusy
    ? 'loading'
    : isBlocked
      ? 'triangleExclamation'
      : 'checkmark'
  const pendingText = `${status.pendingCount} cloud sync operation${
    status.pendingCount === 1 ? '' : 's'
  } pending.`

  return createElement(
    'button',
    {
      type: 'button',
      className: `${defaultStatusBarItemClassNames} ${
        isBlocked ? 'text-destroy-80 dark:text-destroy-40' : ''
      }`,
      'data-testid': 'cloud-sync-status',
      onClick: retryOpfsCloudSync,
    },
    createElement(ActionIcon, {
      icon,
      iconClassName: isBusy ? 'animate-spin' : '',
      bgClassName: 'bg-transparent dark:bg-transparent',
      size: 'sm',
    }),
    createElement('span', null, label),
    createElement(
      Tooltip,
      null,
      status.lastFailure ||
        (status.pendingCount > 0 ? pendingText : 'Cloud sync is up to date.')
    )
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

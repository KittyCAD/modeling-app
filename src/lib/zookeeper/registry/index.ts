import { computed } from '@preact/signals-core'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import { getOpenPanes } from '@src/lib/layout/utils'
import { zookeeperRuntimeRegistryItem } from '@src/lib/zookeeper/registry/runtime'
import { layoutService } from '@src/registry/contracts/layout'
import {
  nullableStatusBarItem,
  statusBarLocalItemsFacet,
} from '@src/registry/contracts/statusBar'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import {
  extension as defineExtension,
  contribute,
  type Extension,
} from 'plankton'
import { createElement, lazy, Suspense } from 'react'

const ZookeeperCreditsMenu = lazy(async () => {
  const { ZookeeperCreditsMenu } = await import(
    '@src/components/ZookeeperCreditsMenu'
  )
  return { default: ZookeeperCreditsMenu }
})

const ZookeeperCreditsStatusBarItem = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(ZookeeperCreditsMenu)
  )
const zookeeperCreditsStatusBarItem = defineExtension({
  key: 'zookeeper.credits-status-bar-item',
  create: (_dependencies, ctx) => {
    const layout = computed(() => ctx.optional(layoutService))
    const item = computed(() => {
      const layoutSystem = layout.value

      return nullableStatusBarItem(
        layoutSystem &&
          getOpenPanes({ rootLayout: layoutSystem.signal.value }).includes(
            DefaultLayoutPaneID.Zookeeper
          )
          ? {
              id: 'zookeeper-credits',
              scopes: ['file'],
              component: ZookeeperCreditsStatusBarItem,
            }
          : null
      )
    })

    return {
      items: [contribute(statusBarLocalItemsFacet, () => item.value)],
    }
  },
}) satisfies Extension
const zookeeper = createZdsPlugin({
  id: 'zookeeper',
  title: 'Zookeeper',
  description: 'AI-assisted modeling conversation and project editing tools.',
  items: [zookeeperRuntimeRegistryItem, zookeeperCreditsStatusBarItem],
  defaultSetting: 'core',
})

export default zookeeper

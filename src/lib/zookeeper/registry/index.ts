import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import {
  hasOpenZookeeperPane,
  zookeeperPaneRuntimeRegistryItem,
} from '@src/lib/zookeeper/registry/runtime'
import { layoutService } from '@src/registry/contracts/layout'
import {
  nullableStatusBarItem,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
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

const zookeeperCreditsStatusBarItem = defineRegistryItemFactory((ctx) => {
  const layout = ctx.services.signal(layoutService)
  const item = computed(() => {
    const layoutSystem = layout.value

    return nullableStatusBarItem(
      layoutSystem && hasOpenZookeeperPane(layoutSystem.signal.value)
        ? {
            id: 'zookeeper-credits',
            scopes: ['file'],
            component: ZookeeperCreditsStatusBarItem,
          }
        : null
    )
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'zookeeper.credits-status-bar-item',
      provides: [provide(statusBarLocalItemsValueSpec, item)],
    }),
  }
}, 'zookeeper.credits-status-bar-item')

const zookeeper = createZdsPlugin({
  id: 'zookeeper',
  title: 'Zookeeper',
  description: 'AI-assisted modeling conversation and project editing tools.',
  items: [zookeeperPaneRuntimeRegistryItem, zookeeperCreditsStatusBarItem],
  defaultSetting: 'core',
})

export default zookeeper

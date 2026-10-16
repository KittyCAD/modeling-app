import { defineRegistryItem, provide } from '@kittycad/registry'
import { ZookeeperHeaderButton } from '@src/lib/zookeeper/components/ZookeeperHeaderButton'
import { zookeeperRuntimeRegistryItem } from '@src/lib/zookeeper/registry/runtime'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { statusBarLocalItemsValueSpec } from '@src/registry/contracts/statusBar'
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

const zookeeperCreditsStatusBarItem = defineRegistryItem({
  id: 'zookeeper.credits-status-bar-item',
  provides: [
    provide(statusBarLocalItemsValueSpec, {
      id: 'zookeeper-credits',
      scopes: ['file'],
      component: ZookeeperCreditsStatusBarItem,
    }),
  ],
})

const zookeeper = createZdsPlugin({
  id: 'zookeeper',
  title: 'Zookeeper',
  description: 'AI-assisted modeling conversation and project editing tools.',
  items: [
    zookeeperRuntimeRegistryItem,
    zookeeperCreditsStatusBarItem,
    defineRegistryItem({
      provides: [
        provide(appHeaderItemsValueSpec, {
          id: 'zookeeper.toggle',
          order: 110,
          Component: ZookeeperHeaderButton,
        }),
      ],
    }),
  ],
  defaultSetting: 'core',
})

export default zookeeper

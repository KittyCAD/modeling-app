import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { type Layout, LayoutType } from '@src/lib/layout/types'
import { zookeeperPaneRuntimeRegistryItem } from '@src/lib/zookeeper/registry/runtime'
import { layoutService } from '@src/registry/contracts/layout'
import {
  nullableStatusBarItem,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { createElement, lazy, Suspense } from 'react'

const ZOOKEEPER_PANE_ID = 'ttc'
const LAYOUT_TOOLBAR_IDS = new Set(['left-toolbar', 'right-toolbar'])

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

function hasOpenToolbarPane(
  rootLayout: Layout | undefined,
  paneId: string
): boolean {
  if (!rootLayout) {
    return false
  }

  if (
    rootLayout.type === LayoutType.Panes &&
    LAYOUT_TOOLBAR_IDS.has(rootLayout.id) &&
    rootLayout.activeIndices.some(
      (activeIndex) => rootLayout.children[activeIndex]?.id === paneId
    )
  ) {
    return true
  }

  if (rootLayout.type === LayoutType.Splits) {
    return rootLayout.children.some((child) =>
      hasOpenToolbarPane(child, paneId)
    )
  }

  return false
}

const zookeeperCreditsStatusBarItem = defineRegistryItemFactory((ctx) => {
  const layout = ctx.services.signal(layoutService)
  const item = computed(() => {
    const layoutSystem = layout.value

    return nullableStatusBarItem(
      layoutSystem &&
        hasOpenToolbarPane(layoutSystem.signal.value, ZOOKEEPER_PANE_ID)
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

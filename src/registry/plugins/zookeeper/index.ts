import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import {
  AreaType,
  type AreaTypeComponentProps,
  type Layout,
  LayoutType,
} from '@src/lib/layout/types'
import {
  layoutAreaLibraryValueSpec,
  layoutService,
} from '@src/registry/contracts/layout'
import {
  nullableStatusBarItem,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { createElement, lazy, Suspense } from 'react'

const ZOOKEEPER_PANE_ID = 'ttc'
const LAYOUT_TOOLBAR_IDS = new Set(['left-toolbar', 'right-toolbar'])

// Registry plugins are imported eagerly while App is still initializing.
// Keep Zookeeper UI behind lazy imports so importing the plugin does not pull
// in boot.ts through components that use the global app context.
const MlEphantConversationPaneWrapper = lazy(async () => {
  const { MlEphantConversationPaneWrapper } = await import(
    '@src/components/layout/areas/MlEphantConversationPaneWrapper'
  )
  return { default: MlEphantConversationPaneWrapper }
})

const ZookeeperCreditsMenu = lazy(async () => {
  const { ZookeeperCreditsMenu } = await import(
    '@src/components/ZookeeperCreditsMenu'
  )
  return { default: ZookeeperCreditsMenu }
})

const ZookeeperConversationPane = (props: AreaTypeComponentProps) =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(MlEphantConversationPaneWrapper, props)
  )

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

const zookeeperLayoutArea = defineRegistryItem({
  id: 'zookeeper.layout-area',
  provides: [
    provide(layoutAreaLibraryValueSpec, {
      [AreaType.TTC]: {
        hide: () => false,
        shortcut: 'Ctrl + T',
        cssClassOverrides: {
          button:
            'bg-ml-green pressed:bg-transparent dark:!text-chalkboard-100 hover:dark:!text-inherit dark:pressed:!text-inherit',
        },
        Component: ZookeeperConversationPane,
      },
    }),
  ],
})

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
  items: [zookeeperLayoutArea, zookeeperCreditsStatusBarItem],
  defaultSetting: 'core',
})

export default zookeeper

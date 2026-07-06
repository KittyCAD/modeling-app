import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { ZookeeperCreditsMenu } from '@src/components/ZookeeperCreditsMenu'
import { MlEphantConversationPaneWrapper } from '@src/components/layout/areas/MlEphantConversationPaneWrapper'
import { DefaultLayoutPaneID, getOpenPanes } from '@src/lib/layout'
import { AreaType } from '@src/lib/layout/types'
import {
  layoutAreaLibraryValueSpec,
  layoutService,
} from '@src/registry/contracts/layout'
import {
  nullableStatusBarItem,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'

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
        Component: MlEphantConversationPaneWrapper,
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
        getOpenPanes({ rootLayout: layoutSystem.current.value }).includes(
          DefaultLayoutPaneID.TTC
        )
        ? {
            id: 'zookeeper-credits',
            scopes: ['file'],
            component: ZookeeperCreditsMenu,
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

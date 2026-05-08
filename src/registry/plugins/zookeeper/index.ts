import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { effect } from '@preact/signals-core'
import { MlEphantConversationPaneWrapper } from '@src/components/layout/areas/MlEphantConversationPaneWrapper'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import { layoutService as layoutServiceToken } from '@src/registry/contracts/layout'
import { layoutAreaLibraryValueSpec } from '@src/registry/contracts/layout'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { ensureZookeeperLayout, removeZookeeperLayout } from './layout'

const zookeeperSettingsItem = defineRegistryItem({
  provides: [
    provide(settingsValueSpec, {
      zookeeper: {
        debugTiming: defineBooleanExtensionSetting({
          defaultValue: false,
          description:
            'Whether Zookeeper records client-side reasoning and tool-call response timings.',
          hideOnLevel: 'project',
          userToml: {
            sectionKey: 'zookeeper',
            tomlKey: 'debug_timing',
          },
        }),
      },
    }),
  ],
})

const zookeeperAreaItem = defineRegistryItem({
  provides: [
    provide(layoutAreaLibraryValueSpec, {
      ttc: {
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

const zookeeperLayoutItem = defineRegistryItemFactory((ctx) => {
  const layoutService = ctx.container.get(layoutServiceToken)
  const disposeEffect = effect(() => {
    layoutService.signal.value
    layoutService.update(ensureZookeeperLayout)
  })

  return {
    item: defineRuntimeRegistryItem({
      dispose: () => {
        disposeEffect()
        layoutService.update(removeZookeeperLayout)
      },
    }),
  }
}, 'zookeeper-layout')

const zookeeper = createZdsPlugin({
  id: 'zookeeper',
  title: 'Zookeeper',
  description:
    'Adds the in-app LLM agent pane and keeps it in the right sidebar.',
  items: [zookeeperSettingsItem, zookeeperAreaItem, zookeeperLayoutItem],
  defaultSetting: 'core',
})

export default zookeeper

import { defineRegistryItem, provide } from '@kittycad/registry'
import { CommandBarOpenButton } from '@src/components/CommandBarOpenButton'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { createElement } from 'react'

function CommandBarHeaderItem({ app }: AppHeaderItemProps) {
  return createElement(CommandBarOpenButton, { app })
}

const commandBarHeaderItem = defineRegistryItem({
  provides: [
    provide(appHeaderItemsValueSpec, {
      id: 'command-bar.open',
      order: 10,
      Component: CommandBarHeaderItem,
    }),
  ],
})

const commandBar = createZdsPlugin({
  id: 'command-bar',
  title: 'Command bar',
  description: 'Command bar controls.',
  items: [commandBarHeaderItem],
  defaultSetting: 'core',
})

export default commandBar

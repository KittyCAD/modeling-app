import { defineRegistryItem, provide } from '@kittycad/registry'
import { useSignals } from '@preact/signals-react/runtime'
import { PublishButton } from '@src/components/PublishButton'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { projectSession } from '@src/registry/contracts/projectSession'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { createElement } from 'react'

function PublishHeaderItem({ app }: AppHeaderItemProps) {
  useSignals()

  if (!app.registry.get(projectSession).project.value) {
    return null
  }

  return createElement(PublishButton, { app })
}

const publishHeaderItem = defineRegistryItem({
  provides: [
    provide(appHeaderItemsValueSpec, {
      id: 'publish.open',
      order: 100,
      Component: PublishHeaderItem,
    }),
  ],
})

const publish = createZdsPlugin({
  id: 'publish',
  title: 'Publish',
  description: 'Publish project controls.',
  items: [publishHeaderItem],
  defaultSetting: 'core',
})

export default publish

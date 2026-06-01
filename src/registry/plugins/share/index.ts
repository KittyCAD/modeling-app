import { defineRegistryItem, provide } from '@kittycad/registry'
import { useSignals } from '@preact/signals-react/runtime'
import { ShareButton } from '@src/components/ShareButton'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { createElement } from 'react'

function ShareHeaderItem({ app }: AppHeaderItemProps) {
  useSignals()

  if (!app.projectSignal.value) {
    return null
  }

  return createElement(ShareButton, { app })
}

const shareHeaderItem = defineRegistryItem({
  provides: [
    provide(appHeaderItemsValueSpec, {
      id: 'share.open',
      order: 90,
      Component: ShareHeaderItem,
    }),
  ],
})

const share = createZdsPlugin({
  id: 'share',
  title: 'Share',
  description: 'Share project controls.',
  items: [shareHeaderItem],
  defaultSetting: 'core',
})

export default share

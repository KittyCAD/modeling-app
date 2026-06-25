import { defineRegistryItem, provide } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { ShareButton } from '@src/components/ShareButton'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { provideCommand } from '@src/registry/contracts/commands'
import {
  type KeymapDocument,
  MODE_MODELING_KEYMAP_SCOPE,
  MODE_SKETCHING_KEYMAP_SCOPE,
  MODE_SKETCH_NO_FACE_KEYMAP_SCOPE,
  MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
  keymapValueSpec,
} from '@src/registry/contracts/keymap'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import {
  SHARE_COMMAND_ID,
  SHARE_HOTKEY,
  SHARE_KEYMAP_SOURCE,
} from '@src/registry/plugins/share/constants'
import { createElement } from 'react'

const shareOpenRequest = signal(0)

const shareKeymap: KeymapDocument = {
  source: SHARE_KEYMAP_SOURCE,
  bindings: [
    {
      id: 'share.open',
      title: 'Open share dialog',
      scopes: [
        MODE_MODELING_KEYMAP_SCOPE,
        MODE_SKETCHING_KEYMAP_SCOPE,
        MODE_SKETCH_NO_FACE_KEYMAP_SCOPE,
        MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
      ],
      keystrokes: [SHARE_HOTKEY],
      command: SHARE_COMMAND_ID,
    },
  ],
}

function ShareHeaderItem({ app }: AppHeaderItemProps) {
  useSignals()

  if (!app.projectSignal.value) {
    return null
  }

  return createElement(ShareButton, { app, openRequest: shareOpenRequest })
}

const shareHeaderItem = defineRegistryItem({
  provides: [
    provideCommand({
      id: SHARE_COMMAND_ID,
      name: SHARE_COMMAND_ID,
      groupId: 'share',
      displayName: 'Open share dialog',
      hideFromSearch: true,
      needsReview: false,
      onSubmit: () => {
        shareOpenRequest.value += 1
      },
    }),
    provide(keymapValueSpec, shareKeymap, { key: shareKeymap.source }),
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

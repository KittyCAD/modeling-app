import { computed, signal } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import {
  commandsFacet,
  MODE_MODELING_COMMAND_SCOPE,
} from '@src/registry/contracts/commands'
import {
  findKeymapItemForCommand,
  keymapService,
  keymapScopesFacet,
  provideKeymapItem,
} from '@src/registry/contracts/keymap'
import { observe, observeService } from '@src/registry/inputs'
import {
  type ViewControlMenuItem,
  viewControlMenuItemsFacet,
} from '@src/registry/contracts/viewControls'
import { observations as viewportNavigationObservations } from '@src/registry/contracts/viewportNavigation'
import { factory, contribute } from 'plankton'
import { createElement } from 'react'
import { RecenterViewControl } from './RecenterViewControl'

export const RECENTER_COMMAND_ID = 'zds.view.recenter'
const RECENTER_KEYS = ['v', 'c']

export const RECENTER_TIP_SEEN_KEY = 'zoo.recenter-tip-seen.v1'

export default factory({
  key: 'recenter',
  dependencies: {
    navigation: viewportNavigationObservations,
    keymap: observeService(keymapService),
    keymapScopes: observe(keymapScopesFacet),
  },
  create: ({ navigation, keymap, keymapScopes }) => {
    let previouslySeen = false
    try {
      previouslySeen =
        globalThis.localStorage?.getItem(RECENTER_TIP_SEEN_KEY) === 'true'
    } catch {}
    const seen = signal(previouslySeen)
    const markSeen = () => {
      if (seen.peek()) return
      seen.value = true
      try {
        globalThis.localStorage?.setItem(RECENTER_TIP_SEEN_KEY, 'true')
      } catch {}
    }
    const requested = computed(
      () =>
        !seen.value &&
        !!navigation.viewportNavigationService.current.value?.isModelOutOfView
          .value
    )
    const recenter = async () => {
      const viewport = navigation.viewportNavigationService.current.value
      if (!viewport) return false
      markSeen()
      await viewport.recenter()
      return true
    }
    const shortcut = computed(() => {
      const service = keymap.current.value
      return service
        ? findKeymapItemForCommand(
            service.keymap.value,
            RECENTER_COMMAND_ID,
            service.getCurrentScopes(),
            keymapScopes.value
          )?.keystrokes
        : RECENTER_KEYS
    })
    const command = computed<Command>(() => ({
      id: RECENTER_COMMAND_ID,
      name: RECENTER_COMMAND_ID,
      groupId: 'recenter',
      displayName: 'Recenter',
      description:
        'Fit the model in view while keeping the current viewing direction.',
      icon: 'camera',
      scopes: [MODE_MODELING_COMMAND_SCOPE],
      needsReview: false,
      disabled: !navigation.viewportNavigationService.current.value,
      onSubmit: recenter,
    }))
    const item: ViewControlMenuItem = {
      id: 'recenter',
      order: 0,
      Component: (props) =>
        createElement(RecenterViewControl, {
          ...props,
          navigation: navigation.viewportNavigationService.current,
          onRecenter: recenter,
          shortcut,
        }),
      help: {
        requested,
        message: "Can't find your model? Recenter it here.",
        shown: markSeen,
      },
    }
    return {
      items: [
        contribute(commandsFacet, () => command.value, {
          key: RECENTER_COMMAND_ID,
        }),
        provideKeymapItem({
          id: 'view.recenter',
          title: 'Recenter',
          source: 'Recenter',
          command: RECENTER_COMMAND_ID,
          when: [MODE_MODELING_COMMAND_SCOPE],
          keystrokes: RECENTER_KEYS,
        }),
        contribute(viewControlMenuItemsFacet, () => item, { key: item.id }),
      ],
    }
  },
})

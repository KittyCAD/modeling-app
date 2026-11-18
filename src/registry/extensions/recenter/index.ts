import { computed, signal } from '@preact/signals-core'
import {
  type ViewControlMenuItem,
  viewControlMenuItemsFacet,
} from '@src/registry/contracts/viewControls'
import { observations as viewportNavigationObservations } from '@src/registry/contracts/viewportNavigation'
import { factory, contribute } from 'plankton'
import { createElement } from 'react'
import { RecenterViewControl } from './RecenterViewControl'

export const RECENTER_TIP_SEEN_KEY = 'zoo.recenter-tip-seen.v1'

export default factory({
  key: 'recenter',
  dependencies: { navigation: viewportNavigationObservations },
  create: ({ navigation }) => {
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
    const item: ViewControlMenuItem = {
      id: 'recenter',
      order: 0,
      Component: (props) =>
        createElement(RecenterViewControl, {
          ...props,
          navigation: navigation.viewportNavigationService.current,
          onUse: markSeen,
        }),
      help: {
        requested,
        message: "Can't find your model? Recenter it here.",
        shown: markSeen,
      },
    }
    return {
      items: [
        contribute(viewControlMenuItemsFacet, () => item, { key: item.id }),
      ],
    }
  },
})

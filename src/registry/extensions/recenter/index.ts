import {
  defineEngineSceneViewExtension,
  engineSceneViewExtensionsFacet,
} from '@src/registry/contracts/engineScene'
import { observations as viewportNavigationObservations } from '@src/registry/contracts/viewportNavigation'
import { factory, contribute } from 'plankton'
import { createElement, lazy, Suspense } from 'react'

const RecenterViewControl = lazy(async () => ({
  default: (await import('./RecenterViewControl')).RecenterViewControl,
}))

export default factory({
  key: 'recenter',
  dependencies: { navigation: viewportNavigationObservations },
  create: ({ navigation }) => {
    const view = defineEngineSceneViewExtension({
      id: 'engine-scene.recenter',
      zone: 'bottom-right',
      order: 19,
      Component: () =>
        createElement(
          Suspense,
          { fallback: null },
          createElement(RecenterViewControl, {
            navigation: navigation.viewportNavigationService.current,
          })
        ),
    })
    return {
      items: [
        contribute(engineSceneViewExtensionsFacet, () => view, {
          key: view.id,
        }),
      ],
    }
  },
})

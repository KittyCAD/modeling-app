import { defineRegistryItem, provide } from '@kittycad/registry'
import { engineSceneOverlayItemsValueSpec } from '@src/registry/contracts/engineScene'
import { viewControlMenuSectionsValueSpec } from '@src/registry/contracts/viewControlMenu'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { Suspense, createElement, lazy } from 'react'

const SpaceMouseSceneController = lazy(async () => {
  const { SpaceMouseSceneController } = await import(
    './SpaceMouseSceneController'
  )
  return { default: SpaceMouseSceneController }
})

const SpaceMouseViewControlMenuSection = lazy(async () => {
  const { SpaceMouseViewControlMenuSection } = await import(
    './SpaceMouseViewControlMenuSection'
  )
  return { default: SpaceMouseViewControlMenuSection }
})

const SpaceMouseSceneOverlay = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(SpaceMouseSceneController)
  )

const SpaceMouseMenuSection = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(SpaceMouseViewControlMenuSection)
  )

const spaceMouseControls = defineRegistryItem({
  provides: [
    provide(engineSceneOverlayItemsValueSpec, {
      id: 'spacemouse.controller',
      order: 10,
      Component: SpaceMouseSceneOverlay,
    }),
    provide(viewControlMenuSectionsValueSpec, {
      id: 'spacemouse.connect',
      order: 50,
      Component: SpaceMouseMenuSection,
    }),
  ],
})

const spaceMouse = createZdsPlugin({
  id: 'spacemouse',
  title: 'SpaceMouse',
  description: '3Dconnexion SpaceMouse viewport controls.',
  items: [spaceMouseControls],
  defaultSetting: 'off',
})

export default spaceMouse

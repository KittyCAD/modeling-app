import { defineRegistryItem, provide } from '@kittycad/registry'
import { engineSceneViewExtensionsValueSpec } from '@src/registry/contracts/engineScene'
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
    provide(engineSceneViewExtensionsValueSpec, {
      id: 'spacemouse.controller',
      zone: 'overlay',
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
  activationSetting: {
    category: 'modeling',
    settingName: 'spaceMouse',
    title: 'SpaceMouse',
    description:
      'Navigate with a 3Dconnexion SpaceMouse. Requires Use Local Renderer.',
    commandConfig: { inputType: 'boolean' },
    hideOnLevel: 'project',
    // Keep the saved preference when moving the toggle out of Plugins.
    userToml: { sectionKey: 'plugins', tomlKey: 'spacemouse' },
  },
})

export default spaceMouse

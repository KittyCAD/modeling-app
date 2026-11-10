import { defineRegistryItem, provide } from '@kittycad/registry'
import { engineSceneViewExtensionsValueSpec } from '@src/registry/contracts/engineScene'
import { statusBarGlobalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { Suspense, createElement, lazy } from 'react'

const SpaceMouseSceneController = lazy(async () => {
  const { SpaceMouseSceneController } = await import(
    './SpaceMouseSceneController'
  )
  return { default: SpaceMouseSceneController }
})

const SpaceMouseStatusBarItem = lazy(async () => {
  const { SpaceMouseStatusBarItem } = await import('./SpaceMouseStatusBarItem')
  return { default: SpaceMouseStatusBarItem }
})

const SpaceMouseSceneOverlay = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(SpaceMouseSceneController)
  )

const SpaceMouseStatus = () =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(SpaceMouseStatusBarItem)
  )

const spaceMouseControls = defineRegistryItem({
  provides: [
    provide(engineSceneViewExtensionsValueSpec, {
      id: 'spacemouse.controller',
      zone: 'overlay',
      order: 10,
      Component: SpaceMouseSceneOverlay,
    }),
    provide(statusBarGlobalItemsValueSpec, {
      id: 'spacemouse.status',
      order: 40,
      component: SpaceMouseStatus,
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

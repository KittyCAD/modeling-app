import {
  defineEngineSceneViewExtension,
  engineSceneViewExtensionsFacet,
} from '@src/registry/contracts/engineScene'
import { statusBarGlobalItemsFacet } from '@src/registry/contracts/statusBar'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { contribute } from 'plankton'
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

const spaceMouse = createZdsPlugin({
  id: 'spacemouse',
  title: 'SpaceMouse',
  description: '3Dconnexion SpaceMouse viewport controls.',
  items: [
    contribute(engineSceneViewExtensionsFacet, () =>
      defineEngineSceneViewExtension({
        id: 'spacemouse.controller',
        zone: 'overlay',
        order: 10,
        Component: SpaceMouseSceneOverlay,
      })
    ),
    contribute(statusBarGlobalItemsFacet, () => ({
      id: 'spacemouse.status',
      order: 40,
      component: SpaceMouseStatus,
    })),
  ],
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

import {
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import type { ZooFeatureTree } from '@kittycad/ui-components/web-components'
import { signal } from '@preact/signals-core'
import {
  sceneBrowserService,
  SCENE_BROWSER_FOCUSED_SCOPE,
  TOGGLE_BROWSER_COMMAND,
} from '@src/lib/sceneBrowser/registry/contract'
import {
  FILE_COMMAND_SCOPES,
  provideCommand,
  provideCommandScope,
} from '@src/registry/contracts/commands'
import { engineSceneViewExtensionsValueSpec } from '@src/registry/contracts/engineScene'
import { provideKeymapItem } from '@src/registry/contracts/keymap'
import { createElement, lazy, Suspense } from 'react'

const Browser = lazy(() =>
  import('@src/lib/sceneBrowser/SceneBrowser').then((module) => ({
    default: module.SceneBrowser,
  }))
)

export const sceneBrowserExtension = defineRegistryItemFactory(() => {
  const collapsed = signal(false)
  const tree = signal<ZooFeatureTree | null>(null)
  const service = {
    tree,
    setTree: (element: ZooFeatureTree | null) => {
      tree.value = element
    },
    collapsed,
    toggle: () => {
      collapsed.value = !collapsed.value
    },
  }
  return {
    id: 'scene-browser',
    providesServices: [provideService(sceneBrowserService, service)],
    provides: [
      provideCommandScope({
        id: SCENE_BROWSER_FOCUSED_SCOPE,
        displayName: 'Scene browser focused',
        priority: 500,
      }),
      provideCommand({
        id: TOGGLE_BROWSER_COMMAND,
        name: TOGGLE_BROWSER_COMMAND,
        groupId: 'sceneBrowser',
        displayName: 'Toggle scene browser',
        scopes: FILE_COMMAND_SCOPES,
        icon: 'model',
        needsReview: false,
        onSubmit: () => {
          service.toggle()
          return true
        },
      }),
      provideKeymapItem({
        id: TOGGLE_BROWSER_COMMAND,
        command: TOGGLE_BROWSER_COMMAND,
        title: 'Toggle scene browser',
        source: 'Scene browser',
        when: FILE_COMMAND_SCOPES,
        keystrokes: ['shift+t'],
      }),
      provide(engineSceneViewExtensionsValueSpec, {
        id: 'browser',
        zone: 'left',
        order: 0,
        wrapperClassName: 'min-h-0 max-h-full',
        Component: () =>
          createElement(Suspense, { fallback: null }, createElement(Browser)),
      }),
    ],
  }
}, 'scene-browser')
export default sceneBrowserExtension

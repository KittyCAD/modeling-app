import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import type { Command, CommandScopes } from '@src/lib/commandTypes'
import {
  FEATURE_TREE_COMMANDS,
  FEATURE_TREE_FOCUSED_SCOPE,
} from '@src/lib/featureTree/registry/contract'
import { provideCommand } from '@src/registry/contracts/commands'
import {
  sceneBrowserSections,
  sceneBrowserService,
  TOGGLE_BROWSER_COMMAND,
} from '@src/lib/sceneBrowser/registry/contract'
import {
  keymapEventOwnersValueSpec,
  provideKeymapItem,
} from '@src/registry/contracts/keymap'
import { createElement, lazy, Suspense } from 'react'

const FeatureTreeSection = lazy(() =>
  import('@src/lib/featureTree/BrowserSections').then((module) => ({
    default: module.FeatureTreeBrowserSection,
  }))
)
const BodiesSection = lazy(() =>
  import('@src/lib/featureTree/BrowserSections').then((module) => ({
    default: module.BodiesBrowserSection,
  }))
)
const FeatureTreeMenu = lazy(() =>
  import('@src/lib/featureTree/FeatureTreeMenu').then((module) => ({
    default: module.FeatureTreeMenu,
  }))
)

/** Widget keys stay local unless the focused tree scope explicitly binds them. */
export function ownsFeatureTreeKey(event: KeyboardEvent) {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
    return false
  const path = event.composedPath()
  if (
    !path.some(
      (target) =>
        target instanceof HTMLElement && target.tagName === 'ZOO-FEATURE-TREE'
    )
  )
    return false
  if (
    path.some(
      (target) =>
        target instanceof HTMLElement &&
        target.matches(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
        )
    )
  )
    return false
  return (
    event.key.length === 1 ||
    [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'Enter',
    ].includes(event.key)
  )
}

export const featureTreeExtension = defineRegistryItemFactory((ctx) => {
  const browser = ctx.services.signal(sceneBrowserService)
  const command = (
    id: string,
    title: string,
    run: () => unknown,
    scopes: CommandScopes
  ): Command => ({
    id,
    name: id,
    groupId: 'featureTree',
    displayName: title,
    scopes,
    icon: 'model',
    needsReview: false,
    onSubmit: () => {
      run()
      return true
    },
  })
  const bindings = [
    {
      id: FEATURE_TREE_COMMANDS.actions,
      title: 'Focus tree row actions',
      key: 'f2',
      run: () => browser.value?.tree.value?.focusActions(),
    },
    {
      id: FEATURE_TREE_COMMANDS.row,
      title: 'Return to tree row',
      key: 'escape',
      run: () => browser.value?.tree.value?.focusRow(),
    },
    {
      id: FEATURE_TREE_COMMANDS.menu,
      title: 'Open tree row context menu',
      key: 'shift+f10',
      run: () => browser.value?.tree.value?.requestContextMenu(),
    },
  ]
  return {
    id: 'feature-tree',
    provides: [
      provideKeymapItem({
        id: 'scene-browser.toggle.tree-focus',
        title: 'Toggle scene browser',
        source: 'Scene browser',
        command: TOGGLE_BROWSER_COMMAND,
        hidden: true,
        userBindingCommand: TOGGLE_BROWSER_COMMAND,
        when: [FEATURE_TREE_FOCUSED_SCOPE],
        keystrokes: ['shift+t'],
      }),
      ...bindings.flatMap((binding) => [
        provideCommand(
          command(binding.id, binding.title, binding.run, [
            FEATURE_TREE_FOCUSED_SCOPE,
          ])
        ),
        provideKeymapItem({
          id: binding.id,
          title: binding.title,
          source: 'Feature tree',
          command: binding.id,
          when: [FEATURE_TREE_FOCUSED_SCOPE],
          keystrokes: [binding.key],
        }),
      ]),
      provide(keymapEventOwnersValueSpec, {
        id: 'feature-tree',
        scope: FEATURE_TREE_FOCUSED_SCOPE,
        owns: ownsFeatureTreeKey,
      }),
      provide(sceneBrowserSections, {
        id: 'feature-tree',
        title: 'Feature tree',
        order: 0,
        Component: () =>
          createElement(
            Suspense,
            { fallback: null },
            createElement(FeatureTreeSection)
          ),
        Menu: () =>
          createElement(
            Suspense,
            { fallback: null },
            createElement(FeatureTreeMenu)
          ),
      }),
      provide(sceneBrowserSections, {
        id: 'bodies',
        title: 'Bodies',
        order: 1,
        Component: () =>
          createElement(
            Suspense,
            { fallback: null },
            createElement(BodiesSection)
          ),
      }),
    ],
  }
}, 'feature-tree')
export default featureTreeExtension

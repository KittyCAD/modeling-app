import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import {
  layoutAreaLibraryValueSpec,
  layoutPaneShortcutsValueSpec,
  layoutService,
} from '@src/lib/layout/registry/contract'
import { AreaType, type AreaTypeComponentProps } from '@src/lib/layout/types'
import { getOpenPanes, togglePaneLayoutNode } from '@src/lib/layout/utils'
import {
  FILE_COMMAND_SCOPES,
  provideCommand,
} from '@src/registry/contracts/commands'
import {
  keymapService,
  provideKeymapItem,
} from '@src/registry/contracts/keymap'
import { createElement, lazy, Suspense } from 'react'

const TOGGLE_FEATURE_TREE_COMMAND_ID = 'feature-tree.toggle'

const FeatureTreePane = lazy(async () => {
  const { FeatureTreePane } = await import(
    '@src/components/layout/areas/FeatureTreePane'
  )
  return { default: FeatureTreePane }
})

const FeatureTreeArea = (props: AreaTypeComponentProps) =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(FeatureTreePane, props)
  )

export default defineRegistryItemFactory(
  (ctx) => ({
    item: defineRuntimeRegistryItem({
      id: 'feature-tree',
      provides: [
        provide(
          layoutPaneShortcutsValueSpec,
          computed(() => ({
            [DefaultLayoutPaneID.FeatureTree]:
              ctx.services
                .signal(keymapService)
                .value?.keymap.value.items.find(
                  (item) => item.command === TOGGLE_FEATURE_TREE_COMMAND_ID
                )?.keystrokes ?? [],
          }))
        ),
        provide(layoutAreaLibraryValueSpec, {
          [AreaType.FeatureTree]: {
            hide: () => false,
            Component: FeatureTreeArea,
          },
        }),
        provideCommand({
          id: TOGGLE_FEATURE_TREE_COMMAND_ID,
          name: 'Toggle Feature Tree',
          groupId: 'feature-tree',
          icon: 'model',
          scopes: FILE_COMMAND_SCOPES,
          needsReview: false,
          onSubmit: () => {
            const layout = ctx.services.get(layoutService)
            const rootLayout = structuredClone(layout.get())
            layout.set(
              togglePaneLayoutNode({
                rootLayout,
                targetNodeId: DefaultLayoutPaneID.FeatureTree,
                shouldExpand: !getOpenPanes({ rootLayout }).includes(
                  DefaultLayoutPaneID.FeatureTree
                ),
              })
            )
          },
        }),
        provideKeymapItem({
          id: TOGGLE_FEATURE_TREE_COMMAND_ID,
          title: 'Toggle Feature Tree',
          source: 'feature-tree',
          command: TOGGLE_FEATURE_TREE_COMMAND_ID,
          when: FILE_COMMAND_SCOPES,
          keystrokes: ['shift+t'],
        }),
      ],
    }),
  }),
  'feature-tree'
)

import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
} from '@kittycad/registry'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import { layoutService } from '@src/lib/layout/registry/contract'
import { getOpenPanes, togglePaneLayoutNode } from '@src/lib/layout/utils'
import {
  FILE_COMMAND_SCOPES,
  provideCommand,
} from '@src/registry/contracts/commands'
import { provideKeymapItem } from '@src/registry/contracts/keymap'

const TOGGLE_FEATURE_TREE_COMMAND_ID = 'feature-tree.toggle'

export default defineRegistryItemFactory(
  (ctx) => ({
    item: defineRuntimeRegistryItem({
      id: 'feature-tree',
      provides: [
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

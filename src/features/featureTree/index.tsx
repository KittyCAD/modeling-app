import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import { keybindingsValueSpec } from '@src/contracts/keybindings'
import {
  sceneHudSectionsValueSpec,
  sceneHudService,
} from '@src/contracts/sceneHud'
import { FeatureTree } from '@src/features/featureTree/FeatureTree'

/** The section id, shared between the contribution and the command that folds it. */
const SECTION_ID = 'scene.features'

/**
 * The operation-tree view of the scene's executing KCL buffer.
 *
 * Contributes both the section and the keyboard for it, which is the pattern any
 * outline section should follow: the section is the unit of contribution, so its
 * command and binding belong to whoever owns it rather than to a list in the
 * scene that would have to be edited every time somebody adds one.
 *
 * `Mod+Shift+5` pairs with the `Mod+5` that folds the whole outline, the way
 * `⇧⌘1` pairs with `⌘1` for the code panel and the file tree inside it.
 */
export default defineRegistryItemFactory((ctx) => {
  const hud = () => ctx.services.get(sceneHudService)

  return {
    item: defineRuntimeRegistryItem({
      id: 'featureTree',
      provides: [
        provide(sceneHudSectionsValueSpec, {
          id: SECTION_ID,
          title: 'Features',
          icon: 'layers',
          order: 0,
          render: () => <FeatureTree />,
        }),

        provide(commandsValueSpec, {
          id: 'featureTree.toggle',
          title: 'Toggle features outline',
          category: 'View',
          icon: 'layers',
          shortcut: '⇧⌘5',
          active: computed(() => hud().sectionOpen(SECTION_ID).value),
          run: () => hud().toggleSection(SECTION_ID),
        }),
        provide(keybindingsValueSpec, {
          keystrokes: ['Mod+Shift+5'],
          commandId: 'featureTree.toggle',
        }),
      ],
    }),
  }
}, 'featureTree')

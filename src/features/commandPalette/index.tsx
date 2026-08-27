import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { signal } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import { keybindingsValueSpec } from '@src/contracts/keybindings'
import { overlaysValueSpec } from '@src/contracts/shell'
import { CommandPalette } from '@src/features/commandPalette/CommandPalette'

/**
 * Opens and closes the palette.
 *
 * Open state is a signal owned here rather than component state, so anything
 * that can reach a command can open the palette — a menu item, a button, a
 * keystroke, a future agent.
 */
export default defineRegistryItemFactory(() => {
  const open = signal(false)

  return {
    item: defineRuntimeRegistryItem({
      id: 'commandPalette',
      provides: [
        provide(overlaysValueSpec, {
          id: 'commandPalette',
          order: 0,
          render: () => <CommandPalette open={open} />,
        }),
        provide(commandsValueSpec, {
          id: 'palette.open',
          title: 'Show all commands',
          category: 'General',
          icon: 'command',
          run: () => {
            open.value = true
          },
        }),
        provide(keybindingsValueSpec, {
          combo: 'Mod+K',
          commandId: 'palette.open',
          // Reachable from a search box or the editor, which is the point.
          allowInTextInput: true,
        }),
      ],
    }),
  }
}, 'commandPalette')

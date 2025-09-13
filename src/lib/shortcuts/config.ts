import { Shortcut } from '@src/lib/shortcuts'
import type { ShortcutProps } from '@src/lib/shortcuts/types'

export const initialShortcutConfigs = [
  {
    id: 'toggle-cmd-palette',
    title: 'Toggle command palette',
    description: 'Open and close the thing',
    category: 'Command Palette',
    sequence: 'mod+k',
    enabledDescription: 'Always available',
  },
  {
    id: 'close-cmd-palette',
    title: 'Close command palette',
    description: 'Always close the thing',
    category: 'Command Palette',
    sequence: 'esc',
    enabledDescription: 'When the command palette is open',
  },
  {
    id: 'bring-the-pain',
    title: 'Bring the pain',
    description: 'A goofy test keybinding',
    category: 'Miscellaneous',
    sequence: 'g LeftButton shift+o',
    enabledDescription: 'Always available',
  },
] satisfies ShortcutProps[]

export const initialShortcuts = initialShortcutConfigs.map(
  (config) => new Shortcut(config)
)

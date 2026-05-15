import { defineRegistryItem, provide } from '@kittycad/registry'
import { isDesktop } from '@src/lib/isDesktop'
import {
  CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE,
  type KeymapDocument,
  keymapValueSpec,
} from '@src/registry/contracts/keymap'

const BASE_KEYMAP_SOURCE = 'Base'

export const defaultKeymap: KeymapDocument = {
  source: BASE_KEYMAP_SOURCE,
  bindings: [
    {
      id: 'command-palette.open',
      title: 'Open command palette',
      keystrokes: ['mod+k'],
      command: 'zds.commandPalette.open',
    },
    {
      id: 'command-palette.close',
      title: 'Close command palette',
      scopes: ['cmd-palette-open'],
      keystrokes: ['mod+k'],
      command: 'zds.commandPalette.close',
    },
    {
      id: 'settings.open',
      title: 'Open settings',
      keystrokes: [isDesktop() ? 'mod+,' : 'mod+shift+,'],
      command: 'zds.settings.open',
    },
    {
      id: 'settings.project',
      title: 'Project settings',
      scopes: ['settings-open'],
      keystrokes: ['p'],
      command: 'zds.settings.tab',
      arguments: {
        tab: 'project',
      },
    },
    {
      id: 'settings.user',
      title: 'User settings',
      scopes: ['settings-open'],
      keystrokes: ['u'],
      command: 'zds.settings.tab',
      arguments: {
        tab: 'user',
      },
    },
    {
      id: 'view.top',
      title: 'Top view',
      scopes: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
      keystrokes: ['v', '1'],
      command: 'standardViews:Top view',
    },
    {
      id: 'view.right',
      title: 'Right view',
      scopes: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
      keystrokes: ['v', '2'],
      command: 'standardViews:Right view',
    },
    {
      id: 'view.front',
      title: 'Front view',
      scopes: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
      keystrokes: ['v', '3'],
      command: 'standardViews:Front view',
    },
    {
      id: 'view.back',
      title: 'Back view',
      scopes: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
      keystrokes: ['v', '4'],
      command: 'standardViews:Back view',
    },
    {
      id: 'view.bottom',
      title: 'Bottom view',
      scopes: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
      keystrokes: ['v', '5'],
      command: 'standardViews:Bottom view',
    },
    {
      id: 'view.left',
      title: 'Left view',
      scopes: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
      keystrokes: ['v', '6'],
      command: 'standardViews:Left view',
    },
    {
      id: 'view.zoom-to-fit',
      title: 'Zoom to fit',
      scopes: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
      keystrokes: ['v', 'f'],
      command: 'standardViews:Zoom to fit',
    },
    {
      id: 'view.reset',
      title: 'Reset view',
      scopes: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
      keystrokes: ['v', 'r'],
      command: 'zds.view.reset',
    },
  ],
}

export const defaultKeymapItem = defineRegistryItem({
  id: 'default-keymap',
  provides: [
    provide(keymapValueSpec, defaultKeymap, { key: defaultKeymap.source }),
  ],
})

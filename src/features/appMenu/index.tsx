import { defineRegistryItem, provide } from '@kittycad/registry'
import { appMenuSectionsValueSpec } from '@src/contracts/appMenu'
import { topBarItemsValueSpec } from '@src/contracts/shell'
import { AppMenu } from '@src/features/appMenu/AppMenu'

/**
 * The app menu surface.
 *
 * Owns the trigger's place in the top bar and nothing else. Every entry is
 * contributed, including the ones below — appearance, and the two commands that
 * belong nowhere else yet.
 *
 * The theme control lives here rather than in the status bar, where it was: the
 * status bar is for state the app is reporting, and the theme is a preference
 * someone sets. Confusing the two is how a status bar turns into a toolbar.
 */
export default defineRegistryItem({
  id: 'appMenu',
  provides: [
    provide(topBarItemsValueSpec, {
      id: 'appMenu',
      zone: 'end',
      order: 200,
      render: () => <AppMenu />,
    }),
    provide(appMenuSectionsValueSpec, {
      id: 'appMenu.appearance',
      order: 100,
      label: 'Appearance',
      items: [
        {
          id: 'theme.dark',
          label: 'Dark',
          icon: 'moon',
          commandId: 'theme.set.dark',
        },
        {
          id: 'theme.light',
          label: 'Light',
          icon: 'sun',
          commandId: 'theme.set.light',
        },
        {
          id: 'theme.system',
          label: 'Match system',
          icon: 'monitor',
          commandId: 'theme.set.system',
        },
      ],
    }),
    provide(appMenuSectionsValueSpec, {
      id: 'appMenu.general',
      order: 200,
      items: [
        {
          id: 'palette',
          label: 'Show all commands',
          icon: 'command',
          commandId: 'palette.open',
        },
        {
          id: 'libraries',
          label: 'Project libraries',
          icon: 'folder',
          commandId: 'libraries.showAll',
        },
        {
          id: 'fitView',
          label: 'Fit the model in view',
          icon: 'grid',
          commandId: 'engine.fitView',
        },
      ],
    }),
  ],
})

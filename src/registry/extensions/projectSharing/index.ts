import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { isDesktop } from '@src/lib/isDesktop'
import {
  getCloudProjectPath,
  PROJECT_ACTION_COMMANDS,
} from '@src/lib/projectSharing'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { commandSystemService } from '@src/registry/contracts/commands'
import { projectExplorerProjectMenuItemsValueSpec } from '@src/registry/contracts/projectExplorer'
import { ShareProjectButton } from './ShareProjectButton'

export default defineRegistryItemFactory(
  (ctx) => ({
    id: 'project-sharing',
    provides: [
      provide(appHeaderItemsValueSpec, {
        id: 'project.share',
        order: 110,
        Component: ShareProjectButton,
      }),
      ...[
        {
          ...PROJECT_ACTION_COMMANDS.share,
          label: 'Share',
          id: 'project-sidebar-share',
        },
        {
          ...PROJECT_ACTION_COMMANDS.desktop,
          label: 'Open in desktop app',
          id: 'project-sidebar-open-in-desktop',
        },
      ].map(({ name, groupId, label, id }) =>
        provide(projectExplorerProjectMenuItemsValueSpec, {
          id,
          order: 10,
          label,
          dataTestId: id,
          isVisible: ({ project }) =>
            !isDesktop() && !!getCloudProjectPath(project),
          onSelect: () =>
            ctx.services.get(commandSystemService).send({
              type: 'Find and select command',
              data: { name, groupId },
            }),
        })
      ),
    ],
  }),
  'project-sharing'
)

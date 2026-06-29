import { defineRegistryItem, provide } from '@kittycad/registry'
import {
  canRevealInFileExplorer,
  revealInFileExplorer,
} from '@src/lib/revealInFileExplorer'
import {
  projectExplorerProjectMenuItemsValueSpec,
  projectExplorerRowContextMenuItemsValueSpec,
} from '@src/registry/contracts/projectExplorer'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'

const revealInFileExplorerItems = defineRegistryItem({
  id: 'reveal-in-file-explorer.items',
  provides: [
    provide(
      projectExplorerProjectMenuItemsValueSpec,
      {
        id: 'reveal-in-file-explorer.project-menu',
        order: 100,
        label: 'Reveal in File Explorer',
        dataTestId: 'project-sidebar-reveal-in-file-explorer',
        isVisible: ({ projectPath }) =>
          Boolean(projectPath) && canRevealInFileExplorer(),
        onSelect: ({ projectPath }) => revealInFileExplorer(projectPath),
      },
      { key: 'reveal-in-file-explorer.project-menu' }
    ),
    provide(
      projectExplorerRowContextMenuItemsValueSpec,
      {
        id: 'reveal-in-file-explorer.row-context-menu',
        order: 100,
        label: 'Reveal in File Explorer',
        dataTestId: 'context-menu-reveal-in-file-explorer',
        isVisible: ({ row }) => !row.isFake && canRevealInFileExplorer(),
        onSelect: ({ row }) => revealInFileExplorer(row.path),
      },
      { key: 'reveal-in-file-explorer.row-context-menu' }
    ),
  ],
})

const revealInFileExplorerPlugin = createZdsPlugin({
  id: 'reveal-in-file-explorer',
  title: 'Reveal in File Explorer',
  description:
    'Adds project and file tree menu actions for opening items in the system file manager.',
  items: [revealInFileExplorerItems],
  defaultSetting: 'core',
})

export default revealInFileExplorerPlugin

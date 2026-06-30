import { defineRegistryItem, provide } from '@kittycad/registry'
import {
  canRevealInFileExplorer,
  revealInFileExplorer,
} from '@src/lib/revealInFileExplorer'
import {
  projectExplorerProjectMenuItemsValueSpec,
  projectExplorerRowContextMenuItemsValueSpec,
} from '@src/registry/contracts/projectExplorer'

const projectExplorerExtension = defineRegistryItem({
  id: 'project-explorer',
  provides: [
    provide(
      projectExplorerProjectMenuItemsValueSpec,
      {
        id: 'reveal-in-file-explorer.project-menu',
        order: 100,
        label: 'Reveal in file explorer',
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
        label: 'Reveal in file explorer',
        dataTestId: 'context-menu-reveal-in-file-explorer',
        isVisible: ({ row }) => !row.isFake && canRevealInFileExplorer(),
        onSelect: ({ row }) => revealInFileExplorer(row.path),
      },
      { key: 'reveal-in-file-explorer.row-context-menu' }
    ),
  ],
})

export default projectExplorerExtension

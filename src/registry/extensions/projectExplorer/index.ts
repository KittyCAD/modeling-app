import { defineRegistryItem, provide } from '@kittycad/registry'
import {
  projectExplorerProjectMenuItemsValueSpec,
  projectExplorerRowContextMenuItemsValueSpec,
} from '@src/registry/contracts/projectExplorer'
import {
  canRevealInFileExplorer,
  revealInFileExplorer,
} from './revealInFileExplorer'

const projectExplorerExtension = defineRegistryItem({
  id: 'project-explorer',
  provides: [
    provide(
      projectExplorerProjectMenuItemsValueSpec,
      {
        id: 'project-explorer.project-menu.reveal-in-file-explorer',
        order: 100,
        label: 'Reveal in File Explorer',
        dataTestId: 'project-sidebar-reveal-in-file-explorer',
        isVisible: ({ projectPath }) =>
          Boolean(projectPath) && canRevealInFileExplorer(),
        onSelect: ({ projectPath }) => revealInFileExplorer(projectPath),
      },
      { key: 'project-explorer.project-menu.reveal-in-file-explorer' }
    ),
    provide(
      projectExplorerRowContextMenuItemsValueSpec,
      {
        id: 'project-explorer.reveal-in-file-explorer',
        order: 100,
        label: 'Reveal in File Explorer',
        dataTestId: 'context-menu-reveal-in-file-explorer',
        isVisible: ({ row }) => !row.isFake && canRevealInFileExplorer(),
        onSelect: ({ row }) => revealInFileExplorer(row.path),
      },
      { key: 'project-explorer.reveal-in-file-explorer' }
    ),
  ],
})

export default projectExplorerExtension

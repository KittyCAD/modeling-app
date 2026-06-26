import { defineRegistryItem, provide } from '@kittycad/registry'
import {
  canRevealInFileExplorer,
  revealInFileExplorer,
} from '@src/lib/revealInFileExplorer'
import { projectExplorerRowContextMenuItemsValueSpec } from '@src/registry/contracts/projectExplorer'

const projectExplorerExtension = defineRegistryItem({
  id: 'project-explorer',
  provides: [
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

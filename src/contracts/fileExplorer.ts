import { defineContract, defineValueSpec } from '@kittycad/registry'
import type { ContextMenuContribution } from '@src/contracts/contextMenu'
import type { ProjectSession } from '@src/contracts/projectSession'
import type { ProjectFile } from '@src/contracts/projects'
import { byOrder, dedupeById } from '@src/lib/registryOrdering'

/** The exact row under the pointer, not merely the tree's current selection. */
export interface FileExplorerContextMenuContext {
  entry: ProjectFile
  session: ProjectSession
}

export const fileExplorerContract = defineContract({
  fileExplorerContextMenuItemsValueSpec: defineValueSpec<
    ContextMenuContribution<FileExplorerContextMenuContext>,
    ContextMenuContribution<FileExplorerContextMenuContext>[]
  >({
    name: 'fileExplorer.contextMenuItems',
    defaultValue: [],
    combine: (inputs) => byOrder(dedupeById(inputs)),
  }),
})

export const { fileExplorerContextMenuItemsValueSpec } = fileExplorerContract

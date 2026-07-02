import { defineContract, defineValueSpec } from '@kittycad/registry'
import type { ReactNode } from 'react'

export interface ProjectExplorerRowContextMenuRow {
  path: string
  name: string
  isFolder: boolean
  isFake: boolean
}

export interface ProjectExplorerRowContextMenuItemContext {
  row: ProjectExplorerRowContextMenuRow
}

export interface ProjectExplorerRowContextMenuItem {
  id: string
  order?: number
  label: ReactNode
  dataTestId?: string
  disabled?:
    | boolean
    | ((context: ProjectExplorerRowContextMenuItemContext) => boolean)
  isVisible?: (context: ProjectExplorerRowContextMenuItemContext) => boolean
  onSelect: (context: ProjectExplorerRowContextMenuItemContext) => void
}

export interface ProjectExplorerProjectMenuItemContext {
  projectPath: string
}

export interface ProjectExplorerProjectMenuItem {
  id: string
  order?: number
  label: ReactNode
  dataTestId?: string
  disabled?:
    | boolean
    | ((context: ProjectExplorerProjectMenuItemContext) => boolean)
  isVisible?: (context: ProjectExplorerProjectMenuItemContext) => boolean
  onSelect: (context: ProjectExplorerProjectMenuItemContext) => void
}

const byOrder = (
  a: ProjectExplorerRowContextMenuItem | ProjectExplorerProjectMenuItem,
  b: ProjectExplorerRowContextMenuItem | ProjectExplorerProjectMenuItem
) => (a.order || 0) - (b.order || 0)

export const projectExplorerContract = defineContract({
  projectExplorerProjectMenuItemsValueSpec: defineValueSpec<
    ProjectExplorerProjectMenuItem,
    ProjectExplorerProjectMenuItem[]
  >({
    name: 'project-explorer-project-menu-items',
    defaultValue: [],
    combine: (items) => items.toSorted(byOrder),
  }),
  projectExplorerRowContextMenuItemsValueSpec: defineValueSpec<
    ProjectExplorerRowContextMenuItem,
    ProjectExplorerRowContextMenuItem[]
  >({
    name: 'project-explorer-row-context-menu-items',
    defaultValue: [],
    combine: (items) => items.toSorted(byOrder),
  }),
})

export const {
  projectExplorerProjectMenuItemsValueSpec,
  projectExplorerRowContextMenuItemsValueSpec,
} = projectExplorerContract

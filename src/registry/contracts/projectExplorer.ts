import { defineContract, defineValueSpec } from '@kittycad/registry'
import type { ComponentType, ReactNode } from 'react'
import type { Project } from '@src/lib/project'

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
  project: Project
}

/**
 * Render props for project menu contributions that need hooks, local state, or
 * dialogs instead of a simple label and onSelect callback.
 */
export interface ProjectExplorerProjectMenuItemComponentProps {
  context: ProjectExplorerProjectMenuItemContext
  /** The base menu item classes from ProjectSidebarMenu. */
  className: string
  /** Close the menu popover before opening long-lived dialogs or async flows. */
  close: () => void
}

type ProjectExplorerProjectMenuItemBase = {
  id: string
  order?: number
  disabled?:
    | boolean
    | ((context: ProjectExplorerProjectMenuItemContext) => boolean)
  isVisible?: (context: ProjectExplorerProjectMenuItemContext) => boolean
}

type ProjectExplorerProjectMenuItemSlotProps = {
  label:
    | ReactNode
    | ((context: ProjectExplorerProjectMenuItemContext) => ReactNode)
  dataTestId?:
    | string
    | ((context: ProjectExplorerProjectMenuItemContext) => string | undefined)
  className?:
    | string
    | ((context: ProjectExplorerProjectMenuItemContext) => string | undefined)
}

export type ProjectExplorerProjectMenuItem =
  /** Simple stateless menu item rendered by ProjectSidebarMenu. */
  | (ProjectExplorerProjectMenuItemBase &
      ProjectExplorerProjectMenuItemSlotProps & {
        onSelect: (context: ProjectExplorerProjectMenuItemContext) => void
        Component?: undefined
      })
  /** Stateful menu item rendered by the contributing extension or plugin. */
  | (ProjectExplorerProjectMenuItemBase & {
      Component: ComponentType<ProjectExplorerProjectMenuItemComponentProps>
    })

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

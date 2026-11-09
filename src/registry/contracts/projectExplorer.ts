import type { FileEntry, Project } from '@src/lib/project'
import { contract, Facet } from 'plankton'
import type { ComponentType, ReactNode } from 'react'

export interface ProjectExplorerRowContextMenuRow {
  path: string
  name: string
  isFolder: boolean
  isFake: boolean
}

export interface ProjectExplorerRowContextMenuItemContext {
  row: ProjectExplorerRowContextMenuRow
  /** Explorer state, absent when rendering a standalone file tree. */
  project?: Project
  file?: FileEntry
  readOnly?: boolean
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

export interface ProjectExplorerProjectBreadcrumbBadgeContext {
  projectPath: string
  project: Project
}

export interface ProjectExplorerProjectBreadcrumbBadgeComponentProps {
  context: ProjectExplorerProjectBreadcrumbBadgeContext
  /** The base badge classes from ProjectSidebarMenu. */
  className: string
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
  placement?: 'project-actions' | 'footer'
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

type ProjectExplorerProjectBreadcrumbBadgeBase = {
  id: string
  order?: number
  isVisible?: (context: ProjectExplorerProjectBreadcrumbBadgeContext) => boolean
}

type ProjectExplorerProjectBreadcrumbBadgeSlotProps = {
  label:
    | ReactNode
    | ((context: ProjectExplorerProjectBreadcrumbBadgeContext) => ReactNode)
  dataTestId?:
    | string
    | ((
        context: ProjectExplorerProjectBreadcrumbBadgeContext
      ) => string | undefined)
  className?:
    | string
    | ((
        context: ProjectExplorerProjectBreadcrumbBadgeContext
      ) => string | undefined)
}

export type ProjectExplorerProjectBreadcrumbBadge =
  | (ProjectExplorerProjectBreadcrumbBadgeBase &
      ProjectExplorerProjectBreadcrumbBadgeSlotProps & {
        Component?: undefined
      })
  | (ProjectExplorerProjectBreadcrumbBadgeBase & {
      Component: ComponentType<ProjectExplorerProjectBreadcrumbBadgeComponentProps>
    })

const byOrder = (
  a:
    | ProjectExplorerRowContextMenuItem
    | ProjectExplorerProjectMenuItem
    | ProjectExplorerProjectBreadcrumbBadge,
  b:
    | ProjectExplorerRowContextMenuItem
    | ProjectExplorerProjectMenuItem
    | ProjectExplorerProjectBreadcrumbBadge
) => (a.order || 0) - (b.order || 0)
export const projectExplorerContract = contract({
  projectExplorerProjectMenuItemsFacet: new Facet<
    ProjectExplorerProjectMenuItem,
    ProjectExplorerProjectMenuItem[]
  >('project-explorer-project-menu-items', (inputs) =>
    inputs.length ? ((items) => items.toSorted(byOrder))(inputs) : []
  ),
  projectExplorerProjectBreadcrumbBadgesFacet: new Facet<
    ProjectExplorerProjectBreadcrumbBadge,
    ProjectExplorerProjectBreadcrumbBadge[]
  >('project-explorer-project-breadcrumb-badges', (inputs) =>
    inputs.length ? ((items) => items.toSorted(byOrder))(inputs) : []
  ),
  projectExplorerRowContextMenuItemsFacet: new Facet<
    ProjectExplorerRowContextMenuItem,
    ProjectExplorerRowContextMenuItem[]
  >('project-explorer-row-context-menu-items', (inputs) =>
    inputs.length ? ((items) => items.toSorted(byOrder))(inputs) : []
  ),
})

export const {
  projectExplorerProjectBreadcrumbBadgesFacet,
  projectExplorerProjectMenuItemsFacet,
  projectExplorerRowContextMenuItemsFacet,
} = projectExplorerContract

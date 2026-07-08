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

export interface ProjectExplorerProjectMenuItemComponentProps {
  context: ProjectExplorerProjectMenuItemContext
  className: string
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
  | (ProjectExplorerProjectMenuItemBase &
      ProjectExplorerProjectMenuItemSlotProps & {
        onSelect: (context: ProjectExplorerProjectMenuItemContext) => void
        Component?: undefined
      })
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

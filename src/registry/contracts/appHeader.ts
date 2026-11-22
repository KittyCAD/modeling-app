import type { App } from '@src/lib/app'
import type { FileEntry, Project } from '@src/lib/project'
import type { OpenProjectSession } from '@src/lib/projectSession/next/contract'
import { contract, Facet } from 'plankton'
import type { ComponentType, ReactNode } from 'react'

/** Header contributions receive the project opening rendered by their host. */
export type AppHeaderContext =
  | { type: 'home' }
  | {
      type: 'legacy-project'
      project?: Project
      file?: FileEntry
      absoluteFilePath?: string
      onProjectClose: (
        file: FileEntry | null,
        projectPath: string | null,
        redirect: boolean
      ) => void
      onHomeNavigate: () => void
      projectMenuChildren?: ReactNode
    }
  | { type: 'project'; session: OpenProjectSession }

export interface AppHeaderItemProps {
  className: string
  app: App
  context: AppHeaderContext
}

/** An independently ordered contribution to one end of the application header. */
export interface AppHeaderItem {
  id: string
  order?: number
  Component: ComponentType<AppHeaderItemProps>
}

const sortByOrderProperty = (inputs: readonly AppHeaderItem[]) =>
  inputs.toSorted((a, b) => (a.order || 0) - (b.order || 0))
export const appHeaderContract = contract({
  appHeaderStartItemsFacet: new Facet<AppHeaderItem, AppHeaderItem[]>(
    'app-header-start-items',
    (inputs) => (inputs.length ? sortByOrderProperty(inputs) : [])
  ),
  appHeaderEndItemsFacet: new Facet<AppHeaderItem, AppHeaderItem[]>(
    'app-header-end-items',
    (inputs) => (inputs.length ? sortByOrderProperty(inputs) : [])
  ),
})

export const { appHeaderStartItemsFacet, appHeaderEndItemsFacet } =
  appHeaderContract

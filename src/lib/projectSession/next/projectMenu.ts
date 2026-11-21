import type { App } from '@src/lib/app'
import type { OpenProjectSession } from '@src/lib/projectSession/next/contract'
import { Facet } from 'plankton'
import type { ComponentType } from 'react'

/** Menu actions receive the captured opening, independently of the legacy project context. */
export interface ProjectMenuItemProps {
  app: App
  session: OpenProjectSession
  className: string
  close: () => void
}

export interface ProjectMenuItem {
  id: string
  order?: number
  Component: ComponentType<ProjectMenuItemProps>
}

// TODO: Contribute reveal, file creation, duplication, and project settings from
// their owning lib extensions/factories as those capabilities adopt new sessions.
export const projectMenuItemsFacet = new Facet<
  ProjectMenuItem,
  readonly ProjectMenuItem[]
>('project-session.menu-items', (items) =>
  items.toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))
)

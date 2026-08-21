import type { ReadonlySignal } from '@preact/signals-core'
import type { Project } from '@src/lib/project'

export type ProjectTitleUpdate = {
  projectPath: string
  title: string
}

export interface ProjectTitleService {
  updates: ReadonlySignal<ProjectTitleUpdate | undefined>
  canUpdateTitle: (project: Project) => boolean
  updateTitle: (project: Project, title: string) => Promise<void>
}

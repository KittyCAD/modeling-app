import type { Project } from '@src/lib/project'

export interface ProjectTitleService {
  getTitle: (project: Project) => string
  canUpdateTitle: (project: Project) => boolean
  updateTitle: (project: Project, title: string) => Promise<void>
}

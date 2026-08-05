import type { Project } from '@src/lib/project'

export interface ProjectTitleService {
  canUpdateTitle: (project: Project) => boolean
  updateTitle: (project: Project, title: string) => Promise<void>
}

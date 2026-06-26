import type { Project } from '@src/lib/project'

export function getProjectDisplayName(project: Project) {
  return project.title?.trim() || project.name || 'project'
}

import type { Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'

export type OptimisticProjectRename = {
  title: string
  modified: number
}

export type OptimisticProjectRenames = Record<string, OptimisticProjectRename>

export function applyOptimisticProjectRenames(
  projects: Project[] | undefined,
  optimisticProjectRenames: OptimisticProjectRenames
) {
  if (!projects || Object.keys(optimisticProjectRenames).length === 0) {
    return projects
  }

  return projects.map((project) => {
    const optimisticProjectRename = project.cloudProjectId
      ? optimisticProjectRenames[project.cloudProjectId]
      : undefined
    if (!optimisticProjectRename) {
      return project
    }

    return {
      ...project,
      title: optimisticProjectRename.title,
      metadata: project.metadata
        ? {
            ...project.metadata,
            modified: Math.max(
              project.metadata.modified ?? Number.NEGATIVE_INFINITY,
              optimisticProjectRename.modified
            ),
          }
        : project.metadata,
    }
  })
}

export function pruneSettledOptimisticProjectRenames(
  projects: Project[] | undefined,
  optimisticProjectRenames: OptimisticProjectRenames
) {
  if (!projects || Object.keys(optimisticProjectRenames).length === 0) {
    return optimisticProjectRenames
  }

  let changed = false
  const nextOptimisticProjectRenames = { ...optimisticProjectRenames }

  for (const project of projects) {
    if (!project.cloudProjectId) {
      continue
    }

    const optimisticProjectRename =
      optimisticProjectRenames[project.cloudProjectId]
    if (
      optimisticProjectRename &&
      getProjectDisplayName(project) === optimisticProjectRename.title &&
      (project.metadata?.modified ?? Number.NEGATIVE_INFINITY) >=
        optimisticProjectRename.modified
    ) {
      delete nextOptimisticProjectRenames[project.cloudProjectId]
      changed = true
    }
  }

  return changed ? nextOptimisticProjectRenames : optimisticProjectRenames
}

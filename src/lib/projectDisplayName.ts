import type { Project } from '@src/lib/project'

/**
 * Users should interact with projects by their title first,
 * which is a metadata field in their project.toml,
 * falling back to their directory in storage.
 */
export function getProjectDisplayName(project: Project) {
  return project.title?.trim() || project.name || 'project'
}

export function getProjectOptionName(project: Project) {
  const displayName = getProjectDisplayName(project)
  return displayName === project.name
    ? displayName
    : `${displayName} (${project.name})`
}

export function getProjectDirectoryOptions(
  projects: readonly Project[] | undefined
) {
  return (
    projects?.map((project) => ({
      name: getProjectOptionName(project),
      value: project.name,
      isCurrent: false,
    })) ?? []
  )
}

export function getProjectOptionNameFromDirectoryName({
  projects,
  directoryName,
}: {
  projects: readonly Project[] | undefined
  directoryName: string
}) {
  const project = projects?.find((folder) => folder.name === directoryName)
  return project ? getProjectOptionName(project) : directoryName
}

import type { Project } from '@src/lib/project'

/**
 * Users should interact with projects by their title first,
 * which is a metadata field in their project.toml,
 * falling back to their directory in storage.
 */
export function getProjectDisplayName(project: Project) {
  return project.title?.trim() || project.name || 'project'
}

export function getProjectDirectoryOptions(
  projects: readonly Project[] | undefined,
  {
    defaultValue,
  }: {
    defaultValue?: string
  } = {}
) {
  return (
    projects?.map((project) => ({
      name: getProjectDisplayName(project),
      value: project.name,
      isCurrent: project.name === defaultValue,
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
  return project ? getProjectDisplayName(project) : directoryName
}

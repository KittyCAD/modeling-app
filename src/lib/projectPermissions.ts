type ProjectReadPermissions = {
  readAccess?: boolean
  readWriteAccess: boolean
}

/**
 * Older project contributions only expose the combined read/write flag. Keep
 * those working while allowing a separately detected read permission to make
 * read-only projects valid copy sources.
 */
export function projectHasReadAccess(project: ProjectReadPermissions) {
  return project.readAccess ?? project.readWriteAccess
}

export function canDuplicateLocalProject(
  project: ProjectReadPermissions & {
    localProjectName?: string
    localProjectPath?: string
  },
  canWriteProjectDirectory: boolean
) {
  return Boolean(
    project.localProjectName &&
      project.localProjectPath &&
      projectHasReadAccess(project) &&
      canWriteProjectDirectory
  )
}

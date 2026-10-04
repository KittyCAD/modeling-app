import { addPlaceHoldersForNewFileAndFolder } from '@src/components/Explorer/placeholders'
import type { Project } from '@src/lib/project'

export function getProjectExplorerProjectWithPlaceholders({
  loadedProject,
  projects,
}: {
  loadedProject: Project
  projects: Project[] | undefined
}) {
  const sourceProject =
    projects?.find((p) => p.path === loadedProject.path) ??
    (projects === undefined || loadedProject.cloudSource ? loadedProject : null)

  if (!sourceProject) {
    return null
  }

  const duplicated = structuredClone(sourceProject)
  duplicated.cloudSource = loadedProject.cloudSource
  addPlaceHoldersForNewFileAndFolder(duplicated.children, duplicated.path)
  return duplicated
}

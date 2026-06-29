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
    projects?.find((p) => p.name === loadedProject.name) ??
    (projects === undefined ? loadedProject : null)

  if (!sourceProject) {
    return null
  }

  const duplicated = structuredClone(sourceProject)
  addPlaceHoldersForNewFileAndFolder(duplicated.children, duplicated.path)
  return duplicated
}

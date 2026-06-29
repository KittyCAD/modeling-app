import { addPlaceHoldersForNewFileAndFolder } from '@src/components/Explorer/utils'
import type { Project } from '@src/lib/project'

export function getProjectExplorerProjectForRender({
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

import { addPlaceHoldersForNewFileAndFolder } from '@src/components/Explorer/placeholders'
import type { Project } from '@src/lib/project'

export function getProjectExplorerProjectWithPlaceholders({
  loadedProject,
}: {
  loadedProject: Project
}) {
  const duplicated = structuredClone(loadedProject)
  addPlaceHoldersForNewFileAndFolder(duplicated.children, duplicated.path)
  return duplicated
}

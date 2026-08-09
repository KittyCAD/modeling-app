import { addPlaceHoldersForNewFileAndFolder } from '@src/components/Explorer/placeholders'
import type { Project } from '@src/lib/project'

export function getProjectExplorerProjectWithPlaceholders({
  project,
}: {
  project: Project
}) {
  const duplicated = structuredClone(project)
  addPlaceHoldersForNewFileAndFolder(duplicated.children, duplicated.path)
  return duplicated
}

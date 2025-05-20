import type { FileEntry } from '@src/lib/project'
import { systemIOActor } from '@src/lib/singletons'
import { isArray } from '@src/lib/utils'

export const folderSnapshot = () => {
  const { folders } = systemIOActor.getSnapshot().context
  return folders
}

export const defaultProjectFolderNameSnapshot = () => {
  const { defaultProjectFolderName } = systemIOActor.getSnapshot().context
  return defaultProjectFolderName
}

// assumes /file/<encodedURIComponent>
// e.g '/file/%2Fhome%2Fkevin-nadro%2FDocuments%2Fzoo-modeling-app-projects%2Fbracket-1%2Fbracket.kcl'
/**
 * From the application project directory go down to a project folder and list all the folders at that directory level
 * application project directory: /home/documents/zoo-modeling-app-projects/
 *
 * /home/documents/zoo-modeling-app-projects/car-door/
 * ├── handle
 * ├── main.kcl
 * └── window
 *
 * The two folders are handle and window
 *
 * @param {Object} params
 * @param {string} params.projectFolderName - The name with no path information.
 * @returns {FileEntry[]} An array of subdirectory names found at the root level of the specified project folder.
 */
export const getAllSubDirectoriesAtProjectRoot = ({
  projectFolderName,
}: { projectFolderName: string }): FileEntry[] => {
  const subDirectories: FileEntry[] = []
  const { folders } = systemIOActor.getSnapshot().context

  const projectFolder = folders.find((folder) => {
    return folder.name === projectFolderName
  })

  // Find the subdirectories
  if (projectFolder) {
    // 1st level
    const children = projectFolder.children
    if (children) {
      children.forEach((childFileOrDirectory) => {
        // 2nd level
        const secondLevelChild = childFileOrDirectory.children
        // if secondLevelChild is null then it is a file
        if (secondLevelChild && isArray(secondLevelChild)) {
          // this is a directory!
          subDirectories.push(childFileOrDirectory)
        }
      })
    }
  }

  return subDirectories
}

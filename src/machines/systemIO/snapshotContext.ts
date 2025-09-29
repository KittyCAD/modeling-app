import type { FileEntry } from '@src/lib/project'
import { isArray } from '@src/lib/utils'
import type { SystemIOContext } from '@src/machines/systemIO/utils'

export function getAllSubDirectoriesAtProjectRoot(
  context: SystemIOContext,
  { projectFolderName }: { projectFolderName: string }
): FileEntry[] {
  const subDirectories: FileEntry[] = []
  const { folders } = context

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

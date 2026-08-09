import fsZds from '@src/lib/fs-zds'
import { getEXTNoPeriod, isExtensionAnImportExtension } from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import { isArray } from '@src/lib/utils'

export type ProjectTreeContext = {
  folders?: readonly Project[]
}

export function getAllSubDirectoriesAtProjectRoot(
  context: ProjectTreeContext,
  { projectFolderName }: { projectFolderName: string }
): FileEntry[] {
  const subDirectories: FileEntry[] = []
  const projectFolder = (context.folders ?? []).find(
    (folder) => folder.name === projectFolderName
  )

  if (projectFolder?.children) {
    projectFolder.children.forEach((childFileOrDirectory) => {
      const secondLevelChild = childFileOrDirectory.children
      if (secondLevelChild && isArray(secondLevelChild)) {
        subDirectories.push(childFileOrDirectory)
      }
    })
  }

  return subDirectories
}

export function listAllImportFilesWithinProject(
  context: ProjectTreeContext,
  {
    projectFolderName,
    importExtensions,
  }: { projectFolderName: string; importExtensions: string[] }
) {
  const relativeFilePaths: string[] = []
  const projectFolder = (context.folders ?? []).find(
    (folder) => folder.name === projectFolderName
  )

  const clonedProjectFolder = structuredClone(projectFolder)
  if (clonedProjectFolder?.children) {
    const projectPath = clonedProjectFolder.path
    let children = clonedProjectFolder.children
    while (children.length > 0) {
      const entry = children.pop()
      if (!entry) {
        continue
      }

      if (entry.children) {
        children.push(...entry.children)
        continue
      }

      const relativeFilePath = entry.path.replace(projectPath + fsZds.sep, '')
      const extension = getEXTNoPeriod(relativeFilePath)
      if (
        extension &&
        isExtensionAnImportExtension(extension, importExtensions)
      ) {
        relativeFilePaths.push(relativeFilePath)
      }
    }
  }

  return relativeFilePaths
}

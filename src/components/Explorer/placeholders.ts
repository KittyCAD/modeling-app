import type { FileEntry } from '@src/lib/project'

export const FOLDER_PLACEHOLDER_NAME = '.zoo-placeholder-folder'
export const FILE_PLACEHOLDER_NAME = '.zoo-placeholder-file.kcl'

function joinProjectPath(parentPath: string, childName: string) {
  const separator = parentPath.includes('\\') ? '\\' : '/'
  const trimPattern = separator === '\\' ? /^\\+|\\+$/g : /^\/+|\/+$/g
  const parts = [parentPath, childName]
    .map((part) => part.replace(trimPattern, ''))
    .filter((part) => part.length > 0)

  return `${separator === '\\' ? '' : separator}${parts.join(separator)}`
}

export const addPlaceHoldersForNewFileAndFolder = (
  children: FileEntry[] | null,
  parentPath: string
) => {
  if (children === null) {
    return
  }

  for (let i = 0; i < children.length; i++) {
    addPlaceHoldersForNewFileAndFolder(
      children[i].children,
      joinProjectPath(parentPath, children[i].name)
    )
  }

  const placeHolderFolderEntry: FileEntry = {
    path: joinProjectPath(parentPath, FOLDER_PLACEHOLDER_NAME),
    name: FOLDER_PLACEHOLDER_NAME,
    children: [],
  }
  children.unshift(placeHolderFolderEntry)

  const placeHolderFileEntry: FileEntry = {
    path: joinProjectPath(parentPath, FILE_PLACEHOLDER_NAME),
    name: FILE_PLACEHOLDER_NAME,
    children: null,
  }
  children.push(placeHolderFileEntry)
}

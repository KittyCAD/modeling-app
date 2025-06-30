import type { ReactNode } from 'react'
import type { CustomIconName } from '@src/components/CustomIcon'
import { sortFilesAndDirectories } from '@src/lib/desktopFS'
import type { FileEntry } from '@src/lib/project'
import { desktopSafePathJoin } from '@src/lib/paths'
import type { SubmitByPressOrBlur } from '@src/lib/types'

/**
 * Remap FileEntry data into another data structure for the Project Explorer
 * This will be transformed into a DOM one called FileExplorerRow
 */
export interface FileExplorerEntry extends FileEntry {
  parentPath: string
  level: number
  index: number
  setSize: number
  positionInSet?: number
}

/**
 * Pass this to the FileExplorer to render
 */
export interface FileExplorerRow extends FileExplorerEntry {
  icon: CustomIconName
  name: string
  isFolder: boolean
  status?: ReactNode
  isOpen: boolean
  render: boolean
  /**
   * Fake file or folder rows are the placeholders for users to input a value
   * and write that to disk to be read as a real one.
   * they are placed in the DOM as if they are real but not from the source of truth
   */
  isFake: boolean
  activeIndex: number

  /* handlers */
  onClick: (domIndex: number) => void
  onOpen: () => void
  onContextMenuOpen: (domIndex: number) => void
  onOpenInNewWindow: () => void
  onDelete: () => void
  onRenameStart: () => void
  onRenameEnd: SubmitByPressOrBlur
}

/**
 * Last conversion for linear rendering of DOM elements, we need the index.
 */
export interface FileExplorerRender extends FileExplorerRow {
  domIndex: number
  domLength: number
  isRenaming: boolean
  selectedRow: FileExplorerEntry | null
  contextMenuRow: FileExplorerEntry | null
}

export interface FileExplorerRowContextMenuProps {
  itemRef: React.RefObject<HTMLElement>
  onRename: () => void
  onDelete: () => void
  onOpenInNewWindow: () => void
  callback: () => void
}

/**
 * Create a key that can be used for a hash table for opened rows
 * this is also used for key={} in React.
 */
export const constructPath = ({
  parentPath,
  name,
}: {
  parentPath: string
  name: string
}) => {
  return desktopSafePathJoin([parentPath, name])
}

/**
 * Recursive helper function to traverse the project tree and flatten the tree structure
 * into an array called list.
 */
const flattenProjectHelper = (
  f: FileEntry,
  list: FileExplorerEntry[], // accumulator list that is built up through recursion
  parentPath: string, // the parentPath for the given f:FileEntry passed in
  level: number, // the level within the tree for the given f:FileEntry, level starts at 0 goes to positive N
  numberOfSiblings: number,
  iterationIndex: number
) => {
  const index = list.length
  const setSize = numberOfSiblings - 2 // for fake folder and file!
  const positionInSet = iterationIndex - 2
  // mark the parent and level of the FileEntry
  const content: FileExplorerEntry = {
    ...f,
    parentPath,
    level,
    index,
    setSize,
    positionInSet,
  }
  // keep track of the file once within the recursive list that will be built up
  list.push(content)

  // if a FileEntry has no children stop
  if (f.children === null) {
    return
  }

  const nextParentPath = desktopSafePathJoin([parentPath, f.name])
  const sortedChildren = sortFilesAndDirectories(f.children.slice())
  // keep recursing down the children
  for (let i = 0; i < sortedChildren.length; i++) {
    flattenProjectHelper(
      sortedChildren[i],
      list,
      nextParentPath,
      level + 1,
      f.children.length,
      i + 1
    )
  }
}

/**
 * A Project type will have a set of children, pass the children as fileEntries
 * since that is level 0 of the tree, everything is under the projectName
 *
 * fileEntries should be sorted already with sortFilesAndDirectories
 */
export const flattenProject = (
  projectChildren: FileEntry[],
  projectPath: string
): FileExplorerEntry[] => {
  const flattenTreeInOrder: FileExplorerEntry[] = []
  // For all children of the project, start the recursion to flatten the tree data structure
  for (let index = 0; index < projectChildren.length; index++) {
    flattenProjectHelper(
      projectChildren[index],
      flattenTreeInOrder,
      projectPath, // first parent
      0,
      projectChildren.length,
      index + 1
    )
  }
  return flattenTreeInOrder
}

/**
 * In memory add fake placeholders for folder and files.
 * @param children
 * @param parentPath absolute path
 * @returns
 */
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
      desktopSafePathJoin([parentPath, children[i].name])
    )
  }

  const placeHolderFolderEntry: FileEntry = {
    path: desktopSafePathJoin([parentPath, FOLDER_PLACEHOLDER_NAME]),
    name: FOLDER_PLACEHOLDER_NAME,
    children: [],
  }
  children.unshift(placeHolderFolderEntry)

  const placeHolderFileEntry: FileEntry = {
    path: desktopSafePathJoin([parentPath, FILE_PLACEHOLDER_NAME]),
    name: FILE_PLACEHOLDER_NAME,
    children: null,
  }
  children.push(placeHolderFileEntry)
}

export const isRowFake = (
  row: FileExplorerRender | FileExplorerRow | FileExplorerEntry
): boolean => {
  return (
    row.name === FOLDER_PLACEHOLDER_NAME || row.name === FILE_PLACEHOLDER_NAME
  )
}

// Used for focused which is different from the selection when you mouse click.
export const NOTHING_IS_SELECTED: number = -2
export const CONTAINER_IS_SELECTED: number = -1
export const STARTING_INDEX_TO_SELECT: number = 0
export const FOLDER_PLACEHOLDER_NAME = '.zoo-placeholder-folder'
export const FILE_PLACEHOLDER_NAME = '.zoo-placeholder-file.kcl'

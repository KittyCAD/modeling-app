import type { ReactNode } from 'react'
import type { CustomIconName } from '@src/components/CustomIcon'
import { sortFilesAndDirectories } from '@src/lib/desktopFS'
import type { FileEntry } from '@src/lib/project'

export interface FileExplorerEntry extends FileEntry {
  parentPath: string
  level: number
  index: number
}

export interface FileExplorerRow extends FileExplorerEntry {
  icon: CustomIconName
  name: string
  isFolder: boolean
  status?: ReactNode
  isOpen: boolean
  render: boolean
  rowClicked: (domIndex: number) => void
  /**
   * Fake file or folder rows are the placeholders for users to input a value
   * and write that to disk to be read as a real one.
   * they are placed in the DOM as if they are real but not from the source of truth
   */
  isFake: boolean
  activeIndex: number,
  rowOpen: () => void
}

export interface FileExplorerRender extends FileExplorerRow {
  domIndex: number
  domLength: number
}

export interface FileExplorerRowContextMenuProps {
  itemRef: React.RefObject<HTMLElement>
  onRename: () => void
  onDelete: () => void
  onClone: () => void
  onOpenInNewWindow: () => void
}

export const constructPath = ({
  parentPath,
  name,
}: {
  parentPath: string
  name: string
}) => {
  // do not worry about the forward slash, this is not a real disk path
  // the slash could be any delimiter this will be used as a key to parse
  // and use in a hash table
  return parentPath + '/' + name
}

/**
 * Recursive helper function to traverse the project tree and flatten the tree structure
 * into an array called list.
 */
const flattenProjectHelper = (
  f: FileEntry,
  list: FileExplorerEntry[], // accumulator list that is built up through recursion
  parentPath: string, // the parentPath for the given f:FileEntry passed in
  level: number // the level within the tree for the given f:FileEntry, level starts at 0 goes to positive N
) => {
  const index = list.length
  // mark the parent and level of the FileEntry
  const content: FileExplorerEntry = {
    ...f,
    parentPath,
    level,
    index,
  }
  // keep track of the file once within the recursive list that will be built up
  list.push(content)

  // if a FileEntry has no children stop
  if (f.children === null) {
    return
  }

  const sortedChildren = sortFilesAndDirectories(f.children.slice())
  // keep recursing down the children
  for (let i = 0; i < sortedChildren.length; i++) {
    flattenProjectHelper(
      sortedChildren[i],
      list,
      constructPath({ parentPath: parentPath, name: f.name }),
      level + 1
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
  projectName: string
): FileExplorerEntry[] => {
  const flattenTreeInOrder: FileExplorerEntry[] = []

  // For all children of the project, start the recursion to flatten the tree data structure
  for (let index = 0; index < projectChildren.length; index++) {
    flattenProjectHelper(
      projectChildren[index],
      flattenTreeInOrder,
      projectName, // first parent
      0
    )
  }
  return flattenTreeInOrder
}

// Used for focused which is different from the selection when you mouse click.
export const NOTHING_IS_SELECTED: number = -2
export const CONTAINER_IS_SELECTED: number = -1
export const STARTING_INDEX_TO_SELECT: number = 0

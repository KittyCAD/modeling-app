import type { CustomIconName } from '@src/components/CustomIcon'
import { sortFilesAndDirectories } from '@src/lib/desktopFS'
import {
  desktopSafePathJoin,
  getEXTWithPeriod,
  getParentAbsolutePath,
  getStringAfterLastSeparator,
  joinOSPaths,
} from '@src/lib/paths'
import type { FileEntry } from '@src/lib/project'
import type { SubmitByPressOrBlur } from '@src/lib/types'
import type { ReactNode } from 'react'

/**
 * Remap FileEntry data into another data structure for the Project Explorer
 * This will be transformed into a DOM one called FileExplorerRow
 */
export interface FileExplorerEntry extends FileEntry {
  parentPath: string
  level: number
  index: number
  key: string
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
  onCopy: () => void
  onPaste: () => void
  onRenameStart: () => void
  onRenameEnd: SubmitByPressOrBlur
}

/**
 * Last conversion for linear rendering of DOM elements, we need the index.
 */
export interface FileExplorerRender extends FileExplorerRow {
  domIndex: number
  domLength: number
}

export interface FileExplorerRowContextMenuProps {
  itemRef: React.RefObject<HTMLElement>
  onRename: () => void
  onDelete: () => void
  onOpenInNewWindow: () => void
  callback: () => void
  onCopy: () => void
  onPaste: () => void
  isCopying: boolean
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
    key: constructPath({
      parentPath,
      name: f.name,
    }),
    setSize,
    positionInSet,
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
  projectName: string
): FileExplorerEntry[] => {
  const flattenTreeInOrder: FileExplorerEntry[] = []

  // For all children of the project, start the recursion to flatten the tree data structure
  for (let index = 0; index < projectChildren.length; index++) {
    flattenProjectHelper(
      projectChildren[index],
      flattenTreeInOrder,
      projectName, // first parent
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
      joinOSPaths(parentPath, children[i].name)
    )
  }

  const placeHolderFolderEntry: FileEntry = {
    path: joinOSPaths(parentPath, FOLDER_PLACEHOLDER_NAME),
    name: FOLDER_PLACEHOLDER_NAME,
    children: [],
  }
  children.unshift(placeHolderFolderEntry)

  const placeHolderFileEntry: FileEntry = {
    path: joinOSPaths(parentPath, FILE_PLACEHOLDER_NAME),
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

/**
 * Assumes possibleCollisions is sorted
 */
export const getUniqueCopyPath = (
  possibleCollisions: string[],
  possibleCopyPath: string,
  identifier: string,
  isFile: boolean
) => {
  const formattedPossibleCollisions = possibleCollisions.map((path) => {
    const hasPeriodIndex = path.lastIndexOf('.')
    const formattedPath =
      hasPeriodIndex !== -1 ? path.slice(0, hasPeriodIndex) : path
    return formattedPath
  })

  const hasPeriodIndex = possibleCopyPath.lastIndexOf('.')
  const formattedPossibleCopyPath =
    hasPeriodIndex !== -1
      ? possibleCopyPath.slice(0, hasPeriodIndex)
      : possibleCopyPath

  const matches = formattedPossibleCollisions.filter((path) => {
    return path.startsWith(formattedPossibleCopyPath)
  })

  if (matches.length === 0) {
    if (isFile) {
      const fileNameAndExtension = getStringAfterLastSeparator(possibleCopyPath)
      const fileName = fileNameAndExtension.slice(
        0,
        fileNameAndExtension.lastIndexOf('.')
      )
      const extWithPeriod = getEXTWithPeriod(possibleCopyPath) || ''
      return joinOSPaths(
        getParentAbsolutePath(possibleCopyPath),
        fileName + extWithPeriod
      )
    }
    return possibleCopyPath
  }

  const takenNumberHash = new Map()
  const fileNameAndExtension = getStringAfterLastSeparator(possibleCopyPath)
  const indexOfFileExt = fileNameAndExtension.lastIndexOf('.')
  const endingSliceIndex =
    indexOfFileExt === -1 ? fileNameAndExtension.length : indexOfFileExt
  const fileName = fileNameAndExtension.slice(0, endingSliceIndex)
  const takenNumbers = matches
    .map((matchedPath) => {
      const folderOrFileName = getStringAfterLastSeparator(matchedPath)
      matchedPath = matchedPath.replace(fileName, '')
      // need to do regex matching... this is gonna be bricked otherwise
      const split = matchedPath.split(identifier)
      if (split.length === 1) {
        if (folderOrFileName === fileName) {
          return '0'
        }
        return ''
      }
      return split[split.length - 1]
    })
    .filter((last) => {
      if (!last) {
        return false
      }
      const number = parseInt(last, 10)
      return last.length === number.toString().length
    })
    .map((takenNumberString) => {
      return parseInt(takenNumberString, 10)
    })

  takenNumbers.forEach((takenNumber) => {
    takenNumberHash.set(takenNumber, true)
  })

  let possibleNumber = 1
  for (; possibleNumber <= takenNumbers.length; possibleNumber++) {
    if (!takenNumberHash.has(possibleNumber)) {
      break
    }
  }

  if (isFile) {
    const fileNameAndExtension = getStringAfterLastSeparator(possibleCopyPath)
    const fileName = fileNameAndExtension.slice(
      0,
      fileNameAndExtension.lastIndexOf('.')
    )
    const extWithPeriod = getEXTWithPeriod(possibleCopyPath) || ''
    /**
     * Just because a name will start with the same name like
     * rigg.kcl and you are trying to copy rig.kcl into that folder it should not become
     * rig<identifier>1.kcl
     */
    const uniqueBits =
      takenNumbers.length === 0 && possibleNumber === 1
        ? ''
        : identifier + possibleNumber
    return joinOSPaths(
      getParentAbsolutePath(possibleCopyPath),
      fileName + uniqueBits + extWithPeriod
    )
  }

  return takenNumbers.length === 0
    ? possibleCopyPath
    : possibleCopyPath + identifier + possibleNumber
}

/**
 * Give two file entries of a src and a target and the children within those locations
 * this will generate a new src and target for the SystemIO otherwise it will be null
 * Handles the logic for determining folder into folder etc... and the unique make collision
 * detection based on the array of possible collisions
 */
export const copyPasteSourceAndTarget = (
  possibleCollisions: string[],
  possibleParentCollisions: string[],
  src: FileEntry,
  target: FileEntry,
  identifier: string
): { src: string; target: string } | null => {
  let possibleCopyPath = ''
  let collisionsToCheck = possibleCollisions
  // Copy a folder to the same folder
  if (src.children && target.children && src.path === target.path) {
    // Make them siblings, copy itself to the same level
    possibleCopyPath = joinOSPaths(getParentAbsolutePath(src.path), src.name)
    collisionsToCheck = possibleParentCollisions
  } else if (src.children && target.children) {
    // Copy a folder into another folder
    possibleCopyPath = joinOSPaths(target.path, src.name)
  } else if (src.children && target.children === null) {
    // Copying a folder to a file would make them siblings
    possibleCopyPath = joinOSPaths(getParentAbsolutePath(src.path), src.name)
    collisionsToCheck = possibleParentCollisions
  } else if (src.children === null && target.children) {
    // Copying a file into a folder
    possibleCopyPath = joinOSPaths(target.path, src.name)
  } else if (src.children === null && target.children === null) {
    // Copying a file into a file would make them siblings
    possibleCopyPath = joinOSPaths(getParentAbsolutePath(src.path), src.name)
    collisionsToCheck = possibleParentCollisions
  }

  if (possibleCopyPath === '') {
    return null
  }

  const isFile = src.children === null
  let uniquePath = getUniqueCopyPath(
    collisionsToCheck,
    possibleCopyPath,
    identifier,
    isFile
  )

  return {
    src: src.path,
    target: uniquePath,
  }
}

// Used for focused which is different from the selection when you mouse click.
export const NOTHING_IS_SELECTED: number = -2
export const CONTAINER_IS_SELECTED: number = -1
export const STARTING_INDEX_TO_SELECT: number = 0
export const FOLDER_PLACEHOLDER_NAME = '.zoo-placeholder-folder'
export const FILE_PLACEHOLDER_NAME = '.zoo-placeholder-file.kcl'

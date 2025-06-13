import type { Project, FileEntry } from '@src/lib/project'
import { FILE_EXT } from '@src/lib/constants'
import type { ReactNode } from 'react'
import { useState, useEffect } from 'react'
import type { CustomIconName } from '@src/components/CustomIcon'
import { CustomIcon } from '@src/components/CustomIcon'
import { sortFilesAndDirectories } from '@src/lib/desktopFS'

export interface FileExplorerEntry extends FileEntry {
  parentPath: string
  level: number
  index: number
}

interface FileExplorerRow extends FileExplorerEntry {
  icon: CustomIconName
  name: string
  isFolder: boolean
  status?: ReactNode
  isOpen: boolean
  rowClicked: () => void
  /**
   * Fake file or folder rows are the placeholders for users to input a value
   * and write that to disk to be read as a real one.
   * they are placed in the DOM as if they are real but not from the source of truth
   */
  isFake: boolean
}

const StatusDot = () => {
  return <span>•</span>
}

/**
 * Implement a dynamic spacer with rem to offset the row
 * in the tree based on the level within the tree
 * level 0 to level N
 */
const Spacer = (level: number) => {
  const containerRemSpacing = `${level}rem`
  return level === 0 ? <div></div> : (
    <div style={{width: containerRemSpacing}} className="h-full flex flex-row">
      {
        Array(level).fill(0).map((value, index)=>{
          const remSpacing = `${0.5}rem`
          return (<>
            <div key={index} style={{ width: remSpacing }} className={`h-full border-r border-sky-600`}></div>
            <div key={index} style={{ width: remSpacing }} className={`h-full`}></div>
            </>)
        })
      }
    </div>
  )
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
const flattenProject = (
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

const insertFakeRowAtFirstPositionUnderParentAfterFolder = (
  fileExplorerEntries: FileExplorerEntry[],
  fakeRow: { entry: FileExplorerEntry | null; isFile: boolean } | null
): void => {
  if (!fakeRow) {
    // no op
    return
  }

  console.log(fakeRow.entry)

  // const requestedEntry: FileExplorerEntry = {
  //   ...fakeRow,
  // }
  // fileExplorerEntries.splice(insertIndex, 0, requestedEntry)
}

/**
 * Render all the rows of the file explorer in linear layout in the DOM.
 * each row is rendered one after another in the same parent DOM element
 * rows will have aria support to understand the linear div soup layout
 *

 * what is opened and selected outside of this logic level.
 *
 */
export const FileExplorer = ({
  parentProject,
  openedRows,
  selectedRow,
  onRowClickCallback,
  fakeRow,
}: {
  parentProject: Project
  openedRows: { [key: string]: boolean }
  selectedRow: FileExplorerEntry | null
  onRowClickCallback: (file: FileExplorerEntry) => void
  fakeRow: { entry: FileExplorerEntry | null; isFile: boolean } | null
}) => {
  // Wrap the FileEntry in a FileExplorerEntry to keep track for more metadata
  let flattenedData: FileExplorerEntry[] = []

  if (parentProject && parentProject.children) {
    // moves all folders up and files down, files are sorted within folders
    const sortedData = sortFilesAndDirectories(parentProject.children)
    // pre order traversal of the tree
    flattenedData = flattenProject(sortedData, parentProject.name)
    // insert fake row if one is present
    // insertFakeRowAtFirstPositionUnderParentAfterFolder(flattenedData, fakeRow)
  }

  const [rowsToRender, setRowsToRender] = useState<FileExplorerRow[]>([])

  useEffect(() => {
    // TODO What to do when a different parentProject comes in? Clear old state.
    // Clear openedRows
    // Clear rowsToRender
    // Clear selected information

    const requestedRowsToRender: FileExplorerRow[] =
      flattenedData.map((child) => {
        const isFile = child.children === null
        const isKCLFile = isFile && child.name?.endsWith(FILE_EXT)

        /**
         * If any parent is closed, keep the history of open children
         */
        let isAnyParentClosed = false
        const pathIterator = child.parentPath.split('/')
        while (pathIterator.length > 0) {
          const key = pathIterator.join('/')
          const isOpened = openedRows[key] || parentProject.name === key
          isAnyParentClosed = isAnyParentClosed || !isOpened
          pathIterator.pop()
        }

        const amIOpen =
          openedRows[
            constructPath({ parentPath: child.parentPath, name: child.name })
          ]
        const isOpen =
          (openedRows[child.parentPath] ||
            parentProject.name === child.parentPath) &&
          !isAnyParentClosed

        let icon: CustomIconName = 'file'
        if (isKCLFile) {
          icon = 'kcl'
        } else if (!isFile && !amIOpen) {
          icon = 'folder'
        } else if (!isFile && amIOpen) {
          icon = 'folderOpen'
        }

        const row: FileExplorerRow = {
          // copy over all the other data that was built up to the DOM render row
          ...child,
          icon: icon,
          isFolder: !isFile,
          status: StatusDot(),
          isOpen,
          rowClicked: () => {
            onRowClickCallback(child)
          },
          isFake: false,
        }

        return row
      }) || []

    setRowsToRender(requestedRowsToRender)
  }, [parentProject, openedRows, fakeRow])

  // Local state for selection and what is opened
  // diff this against new Project value that comes in
  return (
    <div>
      {rowsToRender.map((row, index) => {
        return row.isOpen ? (
          <FileExplorerRow
            key={index}
            row={row}
            selectedRow={selectedRow}
          ></FileExplorerRow>
        ) : null
      })}
    </div>
  )
}

/**
 * Making div soup!
 * A row is a folder or a file.
 */
export const FileExplorerRow = ({
  row,
  selectedRow,
}: {
  row: FileExplorerRow
  selectedRow: FileExplorerEntry | null
}) => {
  return (
    <div
      className={`h-6 flex flex-row items-center text-xs cursor-pointer hover:bg-sky-400 ${row.name === selectedRow?.name && row.parentPath === selectedRow?.parentPath ? 'bg-sky-800' : ''}`}
      onClick={() => {
        row.rowClicked()
      }}
    >
      {Spacer(row.level)}
      <CustomIcon
        name={row.icon}
        className="inline-block w-4 text-current mr-1"
      />
      <span className="overflow-hidden whitespace-nowrap text-ellipsis">
        {row.name}
      </span>
      <div className="ml-auto">{row.status}</div>
    </div>
  )
}

import type { FileEntry } from '@src/lib/project'
import type { ReactNode } from 'react'
import type { CustomIconName } from '@src/components/CustomIcon'
import { CustomIcon } from '@src/components/CustomIcon'
import { sortFilesAndDirectories } from '@src/lib/desktopFS'
import { uuidv4 } from '@src/lib/utils'

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
  rowClicked: (domIndex: number) => void
  /**
   * Fake file or folder rows are the placeholders for users to input a value
   * and write that to disk to be read as a real one.
   * they are placed in the DOM as if they are real but not from the source of truth
   */
  isFake: boolean
  activeIndex: number
}

export const StatusDot = () => {
  return <span>•</span>
}

/**
 * Implement a dynamic spacer with rem to offset the row
 * in the tree based on the level within the tree
 * level 0 to level N
 */
const Spacer = (level: number) => {
  const containerRemSpacing = `${level}rem`
  return level === 0 ? (
    <div></div>
  ) : (
    <div
      style={{ width: containerRemSpacing }}
      className="h-full flex flex-row"
    >
      {Array(level)
        .fill(0)
        .map((value, index) => {
          const remSpacing = `${0.5}rem`
          return (
            <div className="h-full w-full" key={uuidv4()}>
              <div
                style={{ width: remSpacing }}
                className={`h-full border-r border-sky-600`}
              ></div>
              <div style={{ width: remSpacing }} className={`h-full`}></div>
            </div>
          )
        })}
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

const insertFakeRowAtFirstPositionUnderParentAfterFolder = (
  fileExplorerEntries: FileExplorerEntry[],
  fakeRow: { entry: FileExplorerEntry | null; isFile: boolean } | null
): void => {
  if (!fakeRow) {
    // no op
    return
  }

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
  rowsToRender,
  selectedRow
}: {
  rowsToRender: FileExplorerRow[]
  selectedRow: FileExplorerEntry | null
}) => {
  // Local state for selection and what is opened
  // diff this against new Project value that comes in
  return (
    <div role="presentation" className="p-px">
      {rowsToRender
        .filter((row) => {
          return row.isOpen
        })
        .map((row, index, original) => {
          row.domIndex = index
          row.domLength = original.length
          return (
            <FileExplorerRow
              key={uuidv4()}
              row={row}
              selectedRow={selectedRow}
            ></FileExplorerRow>
          )
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
  domLength: number
}) => {
  const isSelected =
    row.name === selectedRow?.name && row.parentPath === selectedRow?.parentPath
  const isIndexActive = row.domIndex === row.activeIndex
  const outlineCSS = isIndexActive
    ? 'outline outline-1 outline-sky-500 '
    : 'outline-0 outline-none'
  return (
    <div
      role="treeitem"
      className={`h-6 flex flex-row items-center text-xs cursor-pointer -outline-offset-1 ${outlineCSS} hover:outline hover:outline-1 hover:outline-sky-500 hover:bg-sky-400 ${isSelected ? 'bg-sky-800' : ''}`}
      data-index={row.domIndex}
      data-last-element={row.domIndex === row.domLength - 1}
      data-parity={row.domIndex % 2 === 0}
      aria-setsize={row.domLength}
      aria-posinset={row.domIndex + 1}
      aria-label={row.name}
      aria-selected={isSelected}
      aria-level={row.level + 1}
      aria-expanded={row.isFolder && row.isOpen}
      onClick={() => {
        row.rowClicked(row.domIndex)
      }}
    >
      <div style={{ width: '0.25rem' }}></div>
      {Spacer(row.level)}
      <CustomIcon
        name={row.icon}
        className="inline-block w-4 text-current mr-1"
      />
      <span className="overflow-hidden whitespace-nowrap text-ellipsis">
        {row.name}
      </span>
      <div className="ml-auto">{row.status}</div>
      <div style={{ width: '0.25rem' }}></div>
    </div>
  )
}

import type { Project } from '@src/lib/project'
import type { CustomIconName } from '@src/components/CustomIcon'
import { FILE_EXT } from '@src/lib/constants'
import { FileExplorer, StatusDot } from '@src/components/Explorer/FileExplorer'
import {
  constructPath,
  flattenProject,
  NOTHING_IS_SELECTED,
  CONTAINER_IS_SELECTED,
  STARTING_INDEX_TO_SELECT,
} from '@src/components/Explorer/utils'
import type {
  FileExplorerEntry,
  FileExplorerRow,
} from '@src/components/Explorer/utils'
import { FileExplorerHeaderActions } from '@src/components/Explorer/FileExplorerHeaderActions'
import { useState, useRef, useEffect } from 'react'
import { systemIOActor } from '@src/lib/singletons'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { sortFilesAndDirectories } from '@src/lib/desktopFS'
import {
  alwaysEndFileWithEXT,
  getEXTWithPeriod,
  joinOSPaths,
} from '@src/lib/paths'
import { useProjectDirectoryPath } from '@src/machines/systemIO/hooks'

const isFileExplorerEntryOpened = (
  rows: { [key: string]: boolean },
  entry: FileExplorerEntry
): boolean => {
  return rows[entry.key]
}

/**
 * Wrap the header and the tree into a single component
 * This is important because the action header buttons need to know
 * the selection logic of the tree since add file will be based on your
 * selection within the tree.
 *
 * pass a Project type which is compatiable with the data stored in
 * the systemIOMachine
 *
 */
export const ProjectExplorer = ({
  project,
}: {
  project: Project
}) => {
  const projectDirectoryPath = useProjectDirectoryPath()

  // cache the state of opened rows to allow nested rows to be opened if a parent one is closed
  // when the parent opens the children will already be opened
  const [openedRows, setOpenedRows] = useState<{ [key: string]: boolean }>({})
  const [selectedRow, setSelectedRow] = useState<FileExplorerEntry | null>(null)
  // -1 is the parent container, -2 is nothing is selected
  const [activeIndex, setActiveIndex] = useState<number>(NOTHING_IS_SELECTED)
  const [rowsToRender, setRowsToRender] = useState<FileExplorerRow[]>([])
  const [contextMenuRow, setContextMenuRow] = useState<FileExplorerRow | null>(
    null
  )
  const [isRenaming, setIsRenaming] = useState<boolean>(false)

  const fileExplorerContainer = useRef(null)
  const openedRowsRef = useRef(openedRows)
  const rowsToRenderRef = useRef(rowsToRender)
  const activeIndexRef = useRef(activeIndex)
  const selectedRowRef = useRef(selectedRow)
  const isRenamingRef = useRef(isRenaming)

  // fake row is used for new files or folders, you should not be able to have multiple fake rows for creation
  const [fakeRow, setFakeRow] = useState<{
    entry: FileExplorerEntry | null
    isFile: boolean
  } | null>(null)

  const setSelectedRowWrapper = (row: FileExplorerEntry | null) => {
    setSelectedRow(row)
    selectedRowRef.current = row
  }

  /**
   * Gotcha: closure
   * Needs a reference to openedRows since it is a callback
   */
  const onRowClickCallback = (file: FileExplorerEntry, domIndex: number) => {
    const newOpenedRows = { ...openedRowsRef.current }
    const key = file.key
    const value = openedRowsRef.current[key]
    newOpenedRows[key] = !value
    setOpenedRows(newOpenedRows)
    setSelectedRowWrapper(file)
    setActiveIndex(domIndex)
  }

  useEffect(() => {
    // TODO What to do when a different project comes in? Clear old state.
    // Clear openedRows
    // Clear rowsToRender
    // Clear selected information

    // gotcha: sync state
    openedRowsRef.current = openedRows
    activeIndexRef.current = activeIndex

    // Wrap the FileEntry in a FileExplorerEntry to keep track for more metadata
    let flattenedData: FileExplorerEntry[] = []

    if (project && project.children) {
      // moves all folders up and files down, files are sorted within folders
      // gotcha: this only sorts the current level, not recursive for all children!

      const sortedData = sortFilesAndDirectories(project.children)
      flattenedData = flattenProject(sortedData, project.name)
      // insert fake row if one is present
    }

    const requestedRows: FileExplorerRow[] =
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
          const isOpened = openedRows[key] || project.name === key
          isAnyParentClosed = isAnyParentClosed || !isOpened
          pathIterator.pop()
        }

        const isOpen = openedRows[child.key]
        const render =
          (openedRows[child.parentPath] || project.name === child.parentPath) &&
          !isAnyParentClosed

        let icon: CustomIconName = 'file'
        if (isKCLFile) {
          icon = 'kcl'
        } else if (!isFile && !isOpen) {
          icon = 'folder'
        } else if (!isFile && isOpen) {
          icon = 'folderOpen'
        }

        const row: FileExplorerRow = {
          // copy over all the other data that was built up to the DOM render row
          ...child,
          icon: icon,
          isFolder: !isFile,
          status: StatusDot(),
          isOpen,
          render: render,
          rowClicked: (domIndex: number) => {
            onRowClickCallback(child, domIndex)
          },
          rowOpen: () => {
            const newOpenedRows = { ...openedRowsRef.current }
            const key = child.key
            newOpenedRows[key] = true
            setOpenedRows(newOpenedRows)
          },
          rowContextMenu: () => {
            // NO OP
          },
          isFake: false,
          activeIndex: activeIndex,
          rowDelete: () => {
            systemIOActor.send({
              type: SystemIOMachineEvents.deleteFileOrFolder,
              data: {
                requestedPath: child.path,
              },
            })
          },
          rowRenameStart: () => {
            setIsRenaming(true)
            isRenamingRef.current = true
          },
          rowRenameEnd: (event) => {
            // TODO: Implement renameFolder and renameFile to navigate
            setIsRenaming(false)
            isRenamingRef.current = false
            const requestedName = String(event?.target?.value || '')
            if (!requestedName) {
              // user pressed esc
              return
            }
            const name = row.name
            // Rename a folder
            if (row.isFolder) {
              if (requestedName !== name) {
                systemIOActor.send({
                  type: SystemIOMachineEvents.renameFolder,
                  data: {
                    requestedFolderName: requestedName,
                    folderName: name,
                    absolutePathToParentDirectory: joinOSPaths(
                      projectDirectoryPath,
                      child.parentPath
                    ),
                  },
                })
                // TODO: Gotcha... Set new string open even if it fails?
                if (openedRowsRef.current[child.key]) {
                  // If the file tree had the folder opened make the new one open.
                  const newOpenedRows = { ...openedRowsRef.current }
                  const key = constructPath({
                    parentPath: child.parentPath,
                    name: requestedName,
                  })
                  newOpenedRows[key] = true
                  setOpenedRows(newOpenedRows)
                }
              }
            } else {
              // rename a file
              const originalExt = getEXTWithPeriod(name)
              const fileNameForcedWithOriginalExt = alwaysEndFileWithEXT(
                requestedName,
                originalExt
              )
              if (!fileNameForcedWithOriginalExt) {
                // TODO: OH NO!
                return
              }
              systemIOActor.send({
                type: SystemIOMachineEvents.renameFile,
                data: {
                  requestedFileNameWithExtension: fileNameForcedWithOriginalExt,
                  fileNameWithExtension: name,
                  absolutePathToParentDirectory: joinOSPaths(
                    projectDirectoryPath,
                    child.parentPath
                  ),
                },
              })
            }
          },
        }

        return row
      }) || []

    const requestedRowsToRender = requestedRows.filter((row) => {
      return row.render
    })

    // update the callback for rowContextMenu to be the index based on rendering
    // Gotcha: you will see if you spam the context menu you will not be able to select a new one
    // until closing
    requestedRowsToRender.forEach((r, index) => {
      r.rowContextMenu = () => {
        setActiveIndex(index)
        setContextMenuRow(r)
      }
    })

    setRowsToRender(requestedRowsToRender)
    rowsToRenderRef.current = requestedRowsToRender
    console.log(activeIndex)
  }, [project, openedRows, fakeRow, activeIndex])

  // Handle clicks and keyboard presses within the global DOM level
  useEffect(() => {
    const handleClickOutside = (event) => {
      const path = event.composedPath ? event.composedPath() : []

      if (!path.includes(fileExplorerContainer.current)) {
        setActiveIndex(NOTHING_IS_SELECTED)
      }
    }

    const keyDownHandler = (event) => {
      if (
        activeIndexRef.current === NOTHING_IS_SELECTED ||
        isRenamingRef.current
      ) {
        // NO OP you are not focused in this DOM element
        return
      }

      const key = event.key
      const focusedEntry = rowsToRenderRef.current[activeIndexRef.current]
      const shouldCheckOpened = focusedEntry
      const isEntryOpened =
        shouldCheckOpened &&
        isFileExplorerEntryOpened(openedRowsRef.current, focusedEntry)
      switch (key) {
        case 'ArrowLeft':
          if (activeIndexRef.current === CONTAINER_IS_SELECTED) {
            // NO OP
          } else if (shouldCheckOpened && isEntryOpened) {
            // close
            const newOpenedRows = { ...openedRowsRef.current }
            const key = focusedEntry.key
            const value = openedRowsRef.current[key]
            newOpenedRows[key] = !value
            setOpenedRows(newOpenedRows)
          }
          break
        case 'ArrowRight':
          if (activeIndexRef.current === CONTAINER_IS_SELECTED) {
            // NO OP
          } else if (shouldCheckOpened && !isEntryOpened) {
            // open!
            const newOpenedRows = { ...openedRowsRef.current }
            const key = focusedEntry.key
            const value = openedRowsRef.current[key]
            newOpenedRows[key] = !value
            setOpenedRows(newOpenedRows)
          }
          break
        case 'ArrowUp':
          setActiveIndex((previous) => {
            if (previous === NOTHING_IS_SELECTED) {
              return STARTING_INDEX_TO_SELECT
            }
            return Math.max(STARTING_INDEX_TO_SELECT, previous - 1)
          })
          break
        case 'ArrowDown':
          setActiveIndex((previous) => {
            if (previous === NOTHING_IS_SELECTED) {
              return STARTING_INDEX_TO_SELECT
            }
            const numberOfDOMRows =
              fileExplorerContainer.current.children[0].children.length - 1
            return Math.min(numberOfDOMRows, previous + 1)
          })
          break
        case 'Enter':
          if (activeIndexRef.current >= STARTING_INDEX_TO_SELECT) {
            // open close folder
            const newOpenedRows = { ...openedRowsRef.current }
            const key = focusedEntry.key
            const value = openedRowsRef.current[key]
            newOpenedRows[key] = !value
            setOpenedRows(newOpenedRows)
          }
          break
      }
    }
    document.addEventListener('keydown', keyDownHandler)
    document.addEventListener('click', handleClickOutside)
    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', keyDownHandler)
    }
  }, [])

  return (
    <div>
      <div className="flex flex-row justify-between">
        <div>{project?.name || 'No Project Selected'}</div>
        <div className="h-6 flex flex-row gap-1">
          <FileExplorerHeaderActions
            onCreateFile={() => {
              setFakeRow({ entry: selectedRow, isFile: true })
            }}
            onCreateFolder={() => {
              console.log('onCreateFolder TODO')
            }}
            onRefreshExplorer={() => {
              // TODO: Refresh only this path from the Project. This will refresh your entire application project directory
              // It is correct but can be slow if there are many projects
              systemIOActor.send({
                type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
              })
            }}
            onCollapseExplorer={() => {
              setOpenedRows({})
            }}
          ></FileExplorerHeaderActions>
        </div>
      </div>
      <div
        className={`h-96 overflow-y-auto overflow-x-hidden border border-transparent ${activeIndex === -1 ? 'border-sky-500' : ''}`}
        tabIndex={0}
        role="tree"
        aria-label="Files Explorer"
        ref={fileExplorerContainer}
        onClick={(event) => {
          if (event.target === fileExplorerContainer.current) {
            setActiveIndex(CONTAINER_IS_SELECTED)
            setSelectedRowWrapper(null)
          }
        }}
      >
        {activeIndex}
        {project && (
          <FileExplorer
            rowsToRender={rowsToRender}
            selectedRow={selectedRow}
            contextMenuRow={contextMenuRow}
            isRenaming={isRenaming}
          ></FileExplorer>
        )}
      </div>
    </div>
  )
}

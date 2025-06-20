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
  FILE_PLACEHOLDER_NAME,
  FOLDER_PLACEHOLDER_NAME,
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
  getParentAbsolutePath,
  joinOSPaths,
} from '@src/lib/paths'

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
  createFilePressed,
  createFolderPressed,
  refreshExplorerPressed,
  collapsePressed,
  onRowClicked,
}: {
  project: Project
  createFilePressed: number
  createFolderPressed: number
  refreshExplorerPressed: number
  collapsePressed: number
  onRowClicked: (row: FileExplorerEntry, domIndex: number) => void
}) => {
  // cache the state of opened rows to allow nested rows to be opened if a parent one is closed
  // when the parent opens the children will already be opened
  const [openedRows, setOpenedRows] = useState<{ [key: string]: boolean }>({})
  const [selectedRow, setSelectedRow] = useState<FileExplorerEntry | null>(null)
  // -1 is the parent container, -2 is nothing is selected
  const [activeIndex, setActiveIndex] = useState<number>(NOTHING_IS_SELECTED)
  const [rowsToRender, setRowsToRender] = useState<FileExplorerRow[]>([])
  const [contextMenuRow, setContextMenuRow] =
    useState<FileExplorerEntry | null>(null)
  const [isRenaming, setIsRenaming] = useState<boolean>(false)

  const fileExplorerContainer = useRef<HTMLDivElement | null>(null)
  const projectExplorerRef = useRef<HTMLDivElement | null>(null)
  const openedRowsRef = useRef(openedRows)
  const rowsToRenderRef = useRef(rowsToRender)
  const activeIndexRef = useRef(activeIndex)
  const selectedRowRef = useRef(selectedRow)
  const isRenamingRef = useRef(isRenaming)
  const previousProject = useRef(project)

  // fake row is used for new files or folders, you should not be able to have multiple fake rows for creation
  const [fakeRow, setFakeRow] = useState<{
    entry: FileExplorerEntry | null
    isFile: boolean
  } | null>(null)

  /**
   * External state handlers since the callback logic lives here.
   * If code wants to externall trigger creating a file pass in a new timestamp.
   */
  useEffect(() => {
    if (createFilePressed <= 0) {
      return
    }

    const row = rowsToRenderRef.current[activeIndexRef.current] || null
    setFakeRow({ entry: row, isFile: true })
    if (row?.key) {
      // If the file tree had the folder opened make the new one open.
      const newOpenedRows = { ...openedRowsRef.current }
      newOpenedRows[row?.key] = true
      setOpenedRows(newOpenedRows)
    }
  }, [createFilePressed])

  useEffect(() => {
    if (createFolderPressed <= 0) {
      return
    }
    const row = rowsToRenderRef.current[activeIndexRef.current] || null
    setFakeRow({ entry: row, isFile: false })
    if (row?.key) {
      // If the file tree had the folder opened make the new one open.
      const newOpenedRows = { ...openedRowsRef.current }
      newOpenedRows[row?.key] = true
      setOpenedRows(newOpenedRows)
    }
  }, [createFolderPressed])

  useEffect(() => {
    if (refreshExplorerPressed <= 0) {
      return
    }
    // TODO: Refresh only this path from the Project. This will refresh your entire application project directory
    // It is correct but can be slow if there are many projects
    systemIOActor.send({
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
    })
  }, [refreshExplorerPressed])

  useEffect(() => {
    if (collapsePressed <= 0) {
      return
    }
    setOpenedRows({})
  }, [collapsePressed])

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
    /**
     * You are loading a new project, clear the internal state!
     */
    if (previousProject.current.name !== project.name) {
      setOpenedRows({})
      setSelectedRow(null)
      setActiveIndex(NOTHING_IS_SELECTED)
      setRowsToRender([])
      setContextMenuRow(null)
      setIsRenaming(false)
    }

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
        // Not a real path
        /* eslint-disable */
        const pathIterator = child.parentPath.split('/')
        while (pathIterator.length > 0) {
          // Not a real path
          /* eslint-disable */
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
          onClick: (domIndex: number) => {
            onRowClickCallback(child, domIndex)
            onRowClicked(child, domIndex)
          },
          onOpen: () => {
            const newOpenedRows = { ...openedRowsRef.current }
            const key = child.key
            newOpenedRows[key] = true
            setOpenedRows(newOpenedRows)
          },
          onContextMenuOpen: (domIndex: number) => {
            setActiveIndex(domIndex)
            setContextMenuRow(child)
          },
          isFake: false,
          activeIndex: activeIndex,
          onDelete: () => {
            systemIOActor.send({
              type: SystemIOMachineEvents.deleteFileOrFolder,
              data: {
                requestedPath: child.path,
              },
            })
          },
          onOpenInNewWindow: () => {
            window.electron.openInNewWindow(row.path)
          },
          onRenameStart: () => {
            setIsRenaming(true)
            isRenamingRef.current = true
          },
          onRenameEnd: (event: React.KeyboardEvent<HTMLElement> | null) => {
            // TODO: Implement renameFolder and renameFile to navigate
            setIsRenaming(false)
            isRenamingRef.current = false
            setFakeRow(null)

            if (!event) {
              return
            }

            const requestedName = String(event?.target?.value || '')
            if (!requestedName) {
              // user pressed esc
              return
            }
            const name = row.name
            // Rename a folder
            if (row.isFolder) {
              if (requestedName !== name) {
                if (row.isFake) {
                  // create
                  systemIOActor.send({
                    type: SystemIOMachineEvents.createBlankFolder,
                    data: {
                      requestedAbsolutePath: joinOSPaths(
                        getParentAbsolutePath(row.path),
                        requestedName
                      ),
                    },
                  })
                } else {
                  // rename
                  systemIOActor.send({
                    type: SystemIOMachineEvents.renameFolder,
                    data: {
                      requestedFolderName: requestedName,
                      folderName: name,
                      absolutePathToParentDirectory: getParentAbsolutePath(
                        row.path
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

              // create a file if it is fake
              if (row.isFake) {
                systemIOActor.send({
                  type: SystemIOMachineEvents.createBlankFile,
                  data: {
                    requestedAbsolutePath: joinOSPaths(
                      getParentAbsolutePath(row.path),
                      fileNameForcedWithOriginalExt
                    ),
                  },
                })
              } else {
                // rename the file otherwise
                systemIOActor.send({
                  type: SystemIOMachineEvents.renameFile,
                  data: {
                    requestedFileNameWithExtension:
                      fileNameForcedWithOriginalExt,
                    fileNameWithExtension: name,
                    absolutePathToParentDirectory: getParentAbsolutePath(
                      row.path
                    ),
                  },
                })
              }
            }
          },
        }
        return row
      }) || []

    const requestedRowsToRender = requestedRows.filter((row) => {
      let showPlaceHolder = false
      if (fakeRow?.isFile) {
        // fake row is a file
        const showFileAtSameLevel =
          fakeRow?.entry?.parentPath === row.parentPath &&
          !row.isFolder === (fakeRow?.entry?.children === null) &&
          row.name === FILE_PLACEHOLDER_NAME
        const showFileWithinFolder =
          !row.isFolder &&
          !!fakeRow?.entry?.children &&
          fakeRow?.entry?.key === row.parentPath &&
          row.name === FILE_PLACEHOLDER_NAME
        const fakeRowIsNullShowRootFile =
          fakeRow.entry === null &&
          row.parentPath === project.name &&
          row.name === FILE_PLACEHOLDER_NAME
        showPlaceHolder =
          showFileAtSameLevel ||
          showFileWithinFolder ||
          fakeRowIsNullShowRootFile
      } else if (fakeRow?.isFile === false) {
        // fake row is a folder
        const showFolderAtSameLevel =
          fakeRow?.entry?.parentPath === row.parentPath &&
          !row.isFolder === !!fakeRow?.entry?.children &&
          row.name === FOLDER_PLACEHOLDER_NAME
        const showFolderWithinFolder =
          row.isFolder &&
          !!fakeRow?.entry?.children &&
          fakeRow?.entry?.key === row.parentPath &&
          row.name === FOLDER_PLACEHOLDER_NAME
        const fakeRowIsNullShowRootFolder =
          fakeRow.entry === null &&
          row.parentPath === project.name &&
          row.name === FOLDER_PLACEHOLDER_NAME
        showPlaceHolder =
          showFolderAtSameLevel ||
          showFolderWithinFolder ||
          fakeRowIsNullShowRootFolder
      }
      const skipPlaceHolder =
        !(
          row.name === FILE_PLACEHOLDER_NAME ||
          row.name === FOLDER_PLACEHOLDER_NAME
        ) || showPlaceHolder
      row.isFake = showPlaceHolder
      return row.render && skipPlaceHolder
    })

    setRowsToRender(requestedRowsToRender)
    rowsToRenderRef.current = requestedRowsToRender
    previousProject.current = project
  }, [project, openedRows, fakeRow, activeIndex])

  // Handle clicks and keyboard presses within the global DOM level
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const path = event.composedPath ? event.composedPath() : []

      if (
        projectExplorerRef.current &&
        !path.includes(projectExplorerRef.current)
      ) {
        setActiveIndex(NOTHING_IS_SELECTED)
      }
    }

    const keyDownHandler = (event: KeyboardEvent) => {
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
          if (fileExplorerContainer.current) {
            const numberOfDOMRows =
              fileExplorerContainer.current.children[0].children.length - 1
            setActiveIndex((previous) => {
              if (previous === NOTHING_IS_SELECTED) {
                return STARTING_INDEX_TO_SELECT
              }
              return Math.min(numberOfDOMRows, previous + 1)
            })
          }
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

    const handleFocus = () => {
      setActiveIndex(CONTAINER_IS_SELECTED)
    }

    const handleBlur = (event) => {
      const path = event.composedPath ? event.composedPath() : []
      if (
        fileExplorerContainer.current &&
        !path.includes(projectExplorerRef.current)
      ) {
        setActiveIndex(NOTHING_IS_SELECTED)
      }
    }

    document.addEventListener('keydown', keyDownHandler)
    document.addEventListener('click', handleClickOutside)
    fileExplorerContainer.current?.addEventListener('focus', handleFocus)
    fileExplorerContainer.current?.addEventListener('blur', handleBlur)
    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', keyDownHandler)
      fileExplorerContainer.current?.removeEventListener('focus', handleFocus)
      fileExplorerContainer.current?.addEventListener('blur', handleBlur)
    }
  }, [])

  return (
    <div
      className="h-full relative overflow-y-auto overflow-x-hidden"
      ref={projectExplorerRef}
    >
      <div
        className={`absolute w-full ${activeIndex === -1 ? 'border-sky-500' : ''}`}
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

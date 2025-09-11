import type { CustomIconName } from '@src/components/CustomIcon'
import { FileExplorer, StatusDot } from '@src/components/Explorer/FileExplorer'
import {
  CONTAINER_IS_SELECTED,
  FILE_PLACEHOLDER_NAME,
  FOLDER_PLACEHOLDER_NAME,
  NOTHING_IS_SELECTED,
  STARTING_INDEX_TO_SELECT,
  constructPath,
  copyPasteSourceAndTarget,
  flattenProject,
} from '@src/components/Explorer/utils'
import type {
  FileExplorerEntry,
  FileExplorerRow,
} from '@src/components/Explorer/utils'
import { useKclContext } from '@src/lang/KclProvider'
import { kclErrorsByFilename } from '@src/lang/errors'
import { FILE_EXT } from '@src/lib/constants'
import { sortFilesAndDirectories } from '@src/lib/desktopFS'
import {
  desktopSafePathJoin,
  desktopSafePathSplit,
  enforceFileEXT,
  getEXTWithPeriod,
  getParentAbsolutePath,
  joinOSPaths,
  parentPathRelativeToApplicationDirectory,
  parentPathRelativeToProject,
} from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import { systemIOActor, useSettings } from '@src/lib/singletons'
import type { MaybePressOrBlur } from '@src/lib/types'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

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
 * pass a Project type which is compatible with the data stored in
 * the systemIOMachine
 *
 */
export const ProjectExplorer = ({
  project,
  file,
  createFilePressed,
  createFolderPressed,
  refreshExplorerPressed,
  collapsePressed,
  onRowClicked,
  onRowEnter,
  readOnly,
  canNavigate,
  overrideApplicationProjectDirectory,
}: {
  project: Project
  file: FileEntry | undefined
  createFilePressed: number
  createFolderPressed: number
  refreshExplorerPressed: number
  collapsePressed: number
  onRowClicked: (row: FileExplorerEntry, domIndex: number) => void
  onRowEnter: (row: FileExplorerEntry, domIndex: number) => void
  readOnly: boolean
  canNavigate: boolean
  overrideApplicationProjectDirectory?: string
}) => {
  const { errors } = useKclContext()
  const settings = useSettings()
  const applicationProjectDirectory = settings.app.projectDirectory.current

  /**
   * Read the file you are loading into and open all of the parent paths to that file
   * If there is no file passed in take the default_file from the project type
   */
  const defaultFileKey = parentPathRelativeToApplicationDirectory(
    file?.path || project.default_file,
    overrideApplicationProjectDirectory || applicationProjectDirectory
  )
  const defaultOpenedRows: { [key: string]: boolean } = {}
  const pathIterator = desktopSafePathSplit(defaultFileKey)
  while (pathIterator.length > 0) {
    const key = desktopSafePathJoin(pathIterator)
    defaultOpenedRows[key] = true
    pathIterator.pop()
  }

  // cache the state of opened rows to allow nested rows to be opened if a parent one is closed
  // when the parent opens the children will already be opened
  const [openedRows, setOpenedRows] = useState<{ [key: string]: boolean }>(
    defaultOpenedRows
  )
  const [selectedRow, setSelectedRow] = useState<FileExplorerEntry | null>(null)
  // -1 is the parent container, -2 is nothing is selected
  const [activeIndex, setActiveIndex] = useState<number>(NOTHING_IS_SELECTED)
  const [rowsToRender, setRowsToRender] = useState<FileExplorerRow[]>([])
  const [contextMenuRow, setContextMenuRow] =
    useState<FileExplorerEntry | null>(null)
  const [isRenaming, setIsRenaming] = useState<boolean>(false)
  const [isCopying, setIsCopying] = useState<boolean>(false)
  const lastIndexBeforeNothing = useRef<number>(-2)

  // Store a path to copy and paste! Works for folders and files
  const copyToClipBoard = useRef<FileEntry | null>(null)

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
    if (createFilePressed <= 0 || readOnly) {
      return
    }

    const row =
      rowsToRenderRef.current[activeIndexRef.current] ||
      rowsToRenderRef.current[lastIndexBeforeNothing.current] ||
      null
    setFakeRow({ entry: row, isFile: true })
    if (row?.key) {
      // If the file tree had the folder opened make the new one open.
      const newOpenedRows = { ...openedRowsRef.current }
      newOpenedRows[row?.key] = true
      setOpenedRows(newOpenedRows)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [createFilePressed])

  useEffect(() => {
    if (createFolderPressed <= 0 || readOnly) {
      return
    }
    const row =
      rowsToRenderRef.current[activeIndexRef.current] ||
      rowsToRenderRef.current[lastIndexBeforeNothing.current] ||
      null
    setFakeRow({ entry: row, isFile: false })
    if (row?.key) {
      // If the file tree had the folder opened make the new one open.
      const newOpenedRows = { ...openedRowsRef.current }
      newOpenedRows[row?.key] = true
      setOpenedRows(newOpenedRows)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
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

    const runtimeErrors = kclErrorsByFilename(errors)

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
        const pathIterator = desktopSafePathSplit(child.parentPath)
        while (pathIterator.length > 0) {
          const key = desktopSafePathJoin(pathIterator)
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

        const errorsAsKeyValue = Array.from(runtimeErrors, ([key, value]) => ({
          key,
          value,
        }))
        const anyParentFolderHasError = errorsAsKeyValue.some(
          ({ key, value }) => {
            return key.indexOf(child.path) >= 0
          }
        )
        const hasRuntimeError =
          runtimeErrors.has(child.path) || anyParentFolderHasError

        const row: FileExplorerRow = {
          // copy over all the other data that was built up to the DOM render row
          ...child,
          icon: icon,
          isFolder: !isFile,
          status: hasRuntimeError ? StatusDot() : <></>,
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
            if (readOnly) {
              return
            }

            const shouldWeNavigate =
              file?.path?.startsWith(child.path) && canNavigate

            if (shouldWeNavigate && file && file.path) {
              systemIOActor.send({
                type: SystemIOMachineEvents.deleteFileOrFolderAndNavigate,
                data: {
                  requestedPath: child.path,
                  requestedProjectName: project.name,
                },
              })
            } else {
              systemIOActor.send({
                type: SystemIOMachineEvents.deleteFileOrFolder,
                data: {
                  requestedPath: child.path,
                },
              })
            }
          },
          onOpenInNewWindow: () => {
            window.electron?.openInNewWindow(row.path)
          },
          onCopy: () => {
            copyToClipBoard.current = {
              path: row.path,
              name: row.name,
              children: row.children,
            }
            setIsCopying(true)
          },
          onPaste: () => {
            if (copyToClipBoard.current) {
              const absoluteParentPath = getParentAbsolutePath(row.path)
              const parentIndex = flattenedData.findIndex((entry) => {
                return entry.path === absoluteParentPath
              })
              const parent =
                parentIndex >= 0 ? flattenedData[parentIndex] : project
              const result = copyPasteSourceAndTarget(
                row.children?.map((child) => child.path) || [],
                parent.children?.map((child) => child.path) || [],
                copyToClipBoard.current,
                {
                  path: row.path,
                  name: row.name,
                  children: row.children,
                },
                '-copy-'
              )
              if (result && result.src && result.target) {
                systemIOActor.send({
                  type: SystemIOMachineEvents.copyRecursive,
                  data: {
                    src: result.src,
                    target: result.target,
                  },
                })
              } else {
                toast.error('Failed to copy and paste the result is null')
              }
            }

            // clear the path
            copyToClipBoard.current = null
            setIsCopying(false)
          },
          onRenameStart: () => {
            if (readOnly) {
              return
            }

            setIsRenaming(true)
            isRenamingRef.current = true
          },
          onRenameEnd: (event: MaybePressOrBlur) => {
            // TODO: Implement renameFolder and renameFile to navigate
            setIsRenaming(false)
            isRenamingRef.current = false
            setFakeRow(null)

            if (!event) {
              return
            }

            const requestedName = String(
              (event?.target &&
                'value' in event.target &&
                event.target.value) ||
                ''
            )
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
                  const absolutePathToParentDirectory = getParentAbsolutePath(
                    row.path
                  )
                  const oldPath = window.electron?.path.join(
                    absolutePathToParentDirectory,
                    name
                  )
                  const newPath = window.electron?.path.join(
                    absolutePathToParentDirectory,
                    requestedName
                  )
                  const shouldWeNavigate =
                    oldPath !== undefined &&
                    newPath !== undefined &&
                    file?.path?.startsWith(oldPath) &&
                    canNavigate

                  if (shouldWeNavigate && file && file.path) {
                    const requestedFileNameWithExtension =
                      parentPathRelativeToProject(
                        file?.path?.replace(oldPath, newPath),
                        applicationProjectDirectory
                      )
                    systemIOActor.send({
                      type: SystemIOMachineEvents.renameFolderAndNavigateToFile,
                      data: {
                        requestedFolderName: requestedName,
                        folderName: name,
                        absolutePathToParentDirectory,
                        requestedProjectName: project.name,
                        requestedFileNameWithExtension,
                      },
                    })
                  } else {
                    systemIOActor.send({
                      type: SystemIOMachineEvents.renameFolder,
                      data: {
                        requestedFolderName: requestedName,
                        folderName: name,
                        absolutePathToParentDirectory,
                      },
                    })
                  }

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
              const fileNameForcedWithOriginalExt = enforceFileEXT(
                requestedName,
                originalExt
              )
              if (!fileNameForcedWithOriginalExt) {
                // TODO: OH NO!
                return
              }

              const pathRelativeToParent = parentPathRelativeToProject(
                joinOSPaths(
                  getParentAbsolutePath(row.path),
                  fileNameForcedWithOriginalExt
                ),
                applicationProjectDirectory
              )

              if (row.isFake) {
                // create a file if it is fake and navigate to that file!
                if (file && canNavigate) {
                  systemIOActor.send({
                    type: SystemIOMachineEvents.importFileFromURL,
                    data: {
                      requestedCode: '',
                      requestedProjectName: project.name,
                      requestedFileNameWithExtension: pathRelativeToParent,
                    },
                  })
                } else {
                  systemIOActor.send({
                    type: SystemIOMachineEvents.createBlankFile,
                    data: {
                      requestedAbsolutePath: joinOSPaths(
                        getParentAbsolutePath(row.path),
                        fileNameForcedWithOriginalExt
                      ),
                    },
                  })
                }
              } else {
                const requestedAbsoluteFilePathWithExtension = joinOSPaths(
                  getParentAbsolutePath(row.path),
                  name
                )
                // If your router loader is within the file you are renaming then reroute to the new path on disk
                // If you are renaming a file you are not loaded into, do not reload!
                const shouldWeNavigate =
                  requestedAbsoluteFilePathWithExtension === file?.path &&
                  canNavigate
                systemIOActor.send({
                  type: shouldWeNavigate
                    ? SystemIOMachineEvents.renameFileAndNavigateToFile
                    : SystemIOMachineEvents.renameFile,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [project, openedRows, fakeRow, activeIndex, errors])

  // Handle clicks and keyboard presses within the global DOM level
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const path = event.composedPath ? event.composedPath() : []

      if (
        projectExplorerRef.current &&
        !path.includes(projectExplorerRef.current)
      ) {
        if (activeIndexRef.current > 0) {
          lastIndexBeforeNothing.current = activeIndexRef.current
        }
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

            // If you press the left arrow and you are at the first child in a folder, run the callback on the parent
            // folder which would move your cursor up a level and close the folder
            if (
              focusedEntry.positionInSet === 1 &&
              focusedEntry.level !== 0 &&
              activeIndexRef.current > 0
            ) {
              onRowClickCallback(
                rowsToRenderRef.current[activeIndexRef.current - 1],
                activeIndexRef.current - 1
              )
            }
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
            onRowEnter(focusedEntry, activeIndexRef.current)
          }
          break
      }
    }

    const handleFocus = () => {
      setActiveIndex(CONTAINER_IS_SELECTED)
    }

    const handleBlur = (event: FocusEvent) => {
      const path = event.composedPath ? event.composedPath() : []
      if (
        projectExplorerRef.current instanceof HTMLDivElement &&
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
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
      fileExplorerContainer.current?.removeEventListener('blur', handleBlur)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])

  return (
    <div
      className="h-full relative overflow-y-auto overflow-x-hidden"
      ref={projectExplorerRef}
    >
      <div
        className={`overflow-auto absolute pb-12 inset-0 ${activeIndex === -1 ? 'border-sky-500' : ''}`}
        data-testid="file-pane-scroll-container"
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
        {project && (
          <FileExplorer
            rowsToRender={rowsToRender}
            selectedRow={selectedRow}
            contextMenuRow={contextMenuRow}
            isRenaming={isRenaming}
            isCopying={isCopying}
          ></FileExplorer>
        )}
      </div>
    </div>
  )
}

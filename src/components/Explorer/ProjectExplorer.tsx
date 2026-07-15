import { useSignals } from '@preact/signals-react/runtime'
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
  isExternalFileDrag,
} from '@src/components/Explorer/utils'
import type {
  FileExplorerEntry,
  FileExplorerRow,
} from '@src/components/Explorer/utils'
import { fsArchiveFile, fsMoveFile } from '@src/editor/plugins/fs'
import { kclErrorsByFilename } from '@src/lang/errors'
import { useApp, useSingletons } from '@src/lib/boot'
import type { Command } from '@src/lib/commandTypes'
import { FILE_EXT } from '@src/lib/constants'
import { getNextFileName, sortFilesAndDirectories } from '@src/lib/desktopFS'
import fsZds from '@src/lib/fs-zds'
import {
  desktopSafePathJoin,
  desktopSafePathSplit,
  enforceFileEXT,
  fileNameHasExtension,
  getEXTWithPeriod,
  getParentAbsolutePath,
  joinOSPaths,
  parentPathRelativeToApplicationDirectory,
  parentPathRelativeToProject,
  toArchivePath,
} from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import type { MaybePressOrBlur } from '@src/lib/types'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import {
  PROJECT_EXPLORER_FOCUSED_KEYMAP_SCOPE,
  PROJECT_EXPLORER_RENAMING_KEYMAP_SCOPE,
  keymapService,
} from '@src/registry/contracts/keymap'
import { projectExplorerRowContextMenuItemsValueSpec } from '@src/registry/contracts/projectExplorer'
import { PROJECT_EXPLORER_COMMAND_IDS } from '@src/registry/extensions/keymap/defaultKeymap'
import { useSelector } from '@xstate/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FocusEvent as ReactFocusEvent } from 'react'
import toast from 'react-hot-toast'

const isFileExplorerEntryOpened = (
  rows: { [key: string]: boolean },
  entry: FileExplorerEntry
): boolean => {
  return rows[entry.key]
}

const FILE_TREE_MUTATION_STATES = [
  SystemIOMachineStates.renamingFolder,
  SystemIOMachineStates.renamingFile,
  SystemIOMachineStates.deletingFileOrFolder,
  SystemIOMachineStates.renamingFileAndNavigateToFile,
  SystemIOMachineStates.renamingFolderAndNavigateToFile,
  SystemIOMachineStates.deletingFileOrFolderAndNavigate,
  SystemIOMachineStates.copyingRecursive,
  SystemIOMachineStates.movingRecursive,
  SystemIOMachineStates.movingRecursiveAndNavigate,
] as const

const handleExternalDragEvent = (e: React.DragEvent): boolean => {
  if (!isExternalFileDrag(e)) {
    return false
  }
  e.preventDefault()
  e.stopPropagation()
  return true
}

const getDropTargetPath = (
  target: FileExplorerEntry | null,
  projectPath: string
): string => {
  if (!target) {
    // If dropping on the root, use the project root
    return projectPath
  }
  if (target.children !== null) {
    // If dropping on a folder, use that folder
    return target.path
  }
  // If dropping on a file, use its parent directory
  return getParentAbsolutePath(target.path)
}

const rowPathMatchesTreeParent = (
  row: FileExplorerEntry,
  project: Project
): boolean => {
  const [, ...relativeParentParts] = desktopSafePathSplit(row.parentPath)
  const expectedParentPath = joinOSPaths(project.path, ...relativeParentParts)
  return getParentAbsolutePath(row.path) === expectedParentPath
}

const readAllDirectoryEntriesRecursively = async (
  dirEntry: FileSystemDirectoryEntry
): Promise<FileSystemEntry[]> => {
  const directoryReader = dirEntry.createReader()
  const entries: FileSystemEntry[] = []
  let readEntries = await new Promise<FileSystemEntry[]>((resolve) =>
    directoryReader.readEntries(resolve)
  )
  while (readEntries.length > 0) {
    entries.push(...readEntries)
    readEntries = await new Promise<FileSystemEntry[]>((resolve) =>
      directoryReader.readEntries(resolve)
    )
  }
  return entries
}

const collectDroppedFiles = async (
  entry: FileSystemEntry,
  basePath: string
): Promise<{
  supported: { file: File; relativePath: string }[]
}> => {
  const supported: { file: File; relativePath: string }[] = []

  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    const file = await new Promise<File>((resolve, reject) =>
      fileEntry.file(resolve, reject)
    )
    supported.push({ file, relativePath: basePath })
  } else if (entry.isDirectory) {
    const entries = await readAllDirectoryEntriesRecursively(
      entry as FileSystemDirectoryEntry
    )
    const newBasePath = basePath
      ? joinOSPaths(basePath, entry.name)
      : entry.name

    for (const childEntry of entries) {
      const result = await collectDroppedFiles(childEntry, newBasePath)
      supported.push(...result.supported)
    }
  }

  return { supported }
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
  wasmInstance,
  project,
  file,
  createFilePressed,
  createFolderPressed,
  refreshExplorerPressed,
  collapsePressed,
  onRowClicked,
  onRowDoubleClicked,
  onRowEnter,
  readOnly,
  canNavigate,
  overrideApplicationProjectDirectory,
}: {
  wasmInstance: ModuleType
  project: Project
  file: FileEntry | undefined
  createFilePressed: number
  createFolderPressed: number
  refreshExplorerPressed: number
  collapsePressed: number
  onRowClicked: (row: FileExplorerEntry, domIndex: number) => void
  onRowDoubleClicked?: (row: FileExplorerEntry, domIndex: number) => void
  onRowEnter: (row: FileExplorerEntry, domIndex: number) => void
  readOnly: boolean
  canNavigate: boolean
  overrideApplicationProjectDirectory?: string
}) => {
  useSignals()
  const { commands, registry, settings, systemIOActor } = useApp()
  const keymap = registry.optional(keymapService)
  const rowContextMenuItems = registry.signal(
    projectExplorerRowContextMenuItemsValueSpec
  ).value
  const { kclManager } = useSingletons()
  const isSystemIOIdle = useSelector(systemIOActor, (state) =>
    state.matches(SystemIOMachineStates.idle)
  )
  const isSystemIOFileTreeMutation = useSelector(systemIOActor, (state) =>
    FILE_TREE_MUTATION_STATES.some((fileTreeMutationState) =>
      state.matches(fileTreeMutationState)
    )
  )
  const lastRecursiveMoveTarget = useSelector(
    systemIOActor,
    (state) => state.context.lastRecursiveMoveTarget
  )
  const errors = kclManager.errorsSignal.value
  const settingsValues = settings.useSettings()
  const applicationProjectDirectory =
    settingsValues.app.projectDirectory.current

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
  const [isDeleting, setIsDeleting] = useState<boolean>(false)
  const [isCopying, setIsCopying] = useState<boolean>(false)
  const [isFileTreeMutationPending, setIsFileTreeMutationPending] =
    useState<boolean>(false)
  const lastIndexBeforeNothing = useRef<number>(-2)

  // Store a path to copy and paste! Works for folders and files
  const copyToClipBoard = useRef<FileEntry | null>(null)

  // External file drag and drop state
  const [isExternalDragOver, setIsExternalDragOver] = useState<boolean>(false)
  const [dragOverTarget, setDragOverTarget] =
    useState<FileExplorerEntry | null>(null)
  const externalDragCounter = useRef<number>(0)

  const fileExplorerContainer = useRef<HTMLDivElement | null>(null)
  const projectExplorerRef = useRef<HTMLDivElement | null>(null)
  const openedRowsRef = useRef(openedRows)
  const rowsToRenderRef = useRef(rowsToRender)
  const activeIndexRef = useRef(activeIndex)
  const selectedRowRef = useRef(selectedRow)
  const onRowEnterRef = useRef(onRowEnter)
  const isFileTreeInteractionDisabledRef = useRef(false)
  const projectExplorerCommandHandlersRef = useRef({
    arrowLeft: () => {},
    arrowRight: () => {},
    arrowUp: () => {},
    arrowDown: () => {},
    enter: () => {},
    rename: () => {},
    delete: () => {},
    copy: () => {},
    paste: () => {},
  })
  const previousProject = useRef(project)
  const lastSyncedFilePathRef = useRef<string | undefined>(undefined)
  const lastRevealedRecursiveMoveTargetRef = useRef<string | undefined>(
    undefined
  )

  onRowEnterRef.current = onRowEnter
  const isFileTreeInteractionDisabled =
    isFileTreeMutationPending || isSystemIOFileTreeMutation
  isFileTreeInteractionDisabledRef.current = isFileTreeInteractionDisabled

  const setFileTreeMutationPending = useCallback((isPending: boolean) => {
    isFileTreeInteractionDisabledRef.current = isPending
    setIsFileTreeMutationPending(isPending)
  }, [])

  const sendFileTreeMutationEvent = useCallback(
    (event: Parameters<typeof systemIOActor.send>[0]) => {
      setFileTreeMutationPending(true)
      systemIOActor.send(event)
    },
    [setFileTreeMutationPending, systemIOActor]
  )

  useEffect(() => {
    if (isSystemIOIdle && isFileTreeMutationPending) {
      setFileTreeMutationPending(false)
    }
  }, [isFileTreeMutationPending, isSystemIOIdle, setFileTreeMutationPending])

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
    if (
      createFilePressed <= 0 ||
      readOnly ||
      isFileTreeInteractionDisabledRef.current
    ) {
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
    if (
      createFolderPressed <= 0 ||
      readOnly ||
      isFileTreeInteractionDisabledRef.current
    ) {
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
  }, [refreshExplorerPressed, systemIOActor])

  useEffect(() => {
    if (collapsePressed <= 0) {
      return
    }
    setOpenedRows({})
  }, [collapsePressed])

  const setSelectedRowWrapper = useCallback((row: FileExplorerEntry | null) => {
    setSelectedRow(row)
    selectedRowRef.current = row
  }, [])

  const setActiveIndexWrapper = useCallback((index: number) => {
    setActiveIndex(index)
    activeIndexRef.current = index
  }, [])

  const setOpenedRowsWrapper = useCallback(
    (rows: { [key: string]: boolean }) => {
      setOpenedRows(rows)
      openedRowsRef.current = rows
    },
    []
  )

  const focusProjectExplorer = useCallback(() => {
    keymap?.applyScope(PROJECT_EXPLORER_FOCUSED_KEYMAP_SCOPE)
    fileExplorerContainer.current?.focus()
  }, [keymap])

  /**
   * Gotcha: closure
   * Needs a reference to openedRows since it is a callback
   */
  const onRowClickCallback = useCallback(
    (file: FileExplorerEntry, domIndex: number) => {
      focusProjectExplorer()
      const newOpenedRows = { ...openedRowsRef.current }
      const key = file.key
      const value = openedRowsRef.current[key]
      newOpenedRows[key] = !value
      setOpenedRowsWrapper(newOpenedRows)
      setSelectedRowWrapper(file)
      setActiveIndexWrapper(domIndex)
    },
    [
      focusProjectExplorer,
      setActiveIndexWrapper,
      setOpenedRowsWrapper,
      setSelectedRowWrapper,
    ]
  )

  const handleArrowLeftCommand = useCallback(() => {
    if (
      isFileTreeInteractionDisabledRef.current ||
      activeIndexRef.current === CONTAINER_IS_SELECTED
    ) {
      return
    }

    const focusedEntry = rowsToRenderRef.current[activeIndexRef.current]
    const isEntryOpened =
      focusedEntry &&
      isFileExplorerEntryOpened(openedRowsRef.current, focusedEntry)
    if (!(focusedEntry && isEntryOpened)) {
      return
    }

    const newOpenedRows = { ...openedRowsRef.current }
    const key = focusedEntry.key
    const value = openedRowsRef.current[key]
    newOpenedRows[key] = !value
    setOpenedRowsWrapper(newOpenedRows)

    // If you press the left arrow and you are at the first child in a folder,
    // move to the parent and close it.
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
  }, [onRowClickCallback, setOpenedRowsWrapper])

  const handleArrowRightCommand = useCallback(() => {
    if (
      isFileTreeInteractionDisabledRef.current ||
      activeIndexRef.current === CONTAINER_IS_SELECTED
    ) {
      return
    }

    const focusedEntry = rowsToRenderRef.current[activeIndexRef.current]
    const isEntryOpened =
      focusedEntry &&
      isFileExplorerEntryOpened(openedRowsRef.current, focusedEntry)
    if (!(focusedEntry && !isEntryOpened)) {
      return
    }

    const newOpenedRows = { ...openedRowsRef.current }
    const key = focusedEntry.key
    const value = openedRowsRef.current[key]
    newOpenedRows[key] = !value
    setOpenedRowsWrapper(newOpenedRows)
  }, [setOpenedRowsWrapper])

  const handleArrowUpCommand = useCallback(() => {
    if (isFileTreeInteractionDisabledRef.current) {
      return
    }

    setActiveIndex((previous) => {
      const next =
        previous === NOTHING_IS_SELECTED
          ? STARTING_INDEX_TO_SELECT
          : Math.max(STARTING_INDEX_TO_SELECT, previous - 1)
      activeIndexRef.current = next
      return next
    })
  }, [])

  const handleArrowDownCommand = useCallback(() => {
    if (isFileTreeInteractionDisabledRef.current) {
      return
    }

    const lastRowIndex = rowsToRenderRef.current.length - 1
    if (lastRowIndex < STARTING_INDEX_TO_SELECT) {
      return
    }

    setActiveIndex((previous) => {
      const next =
        previous === NOTHING_IS_SELECTED
          ? STARTING_INDEX_TO_SELECT
          : Math.min(lastRowIndex, previous + 1)
      activeIndexRef.current = next
      return next
    })
  }, [])

  const handleEnterCommand = useCallback(() => {
    if (
      isFileTreeInteractionDisabledRef.current ||
      activeIndexRef.current < STARTING_INDEX_TO_SELECT
    ) {
      return
    }

    const focusedEntry = rowsToRenderRef.current[activeIndexRef.current]
    if (!focusedEntry) {
      return
    }

    const newOpenedRows = { ...openedRowsRef.current }
    const key = focusedEntry.key
    const value = openedRowsRef.current[key]
    newOpenedRows[key] = !value
    setOpenedRowsWrapper(newOpenedRows)
    onRowEnterRef.current(focusedEntry, activeIndexRef.current)
  }, [setOpenedRowsWrapper])

  const handleRenameCommand = useCallback(() => {
    if (
      readOnly ||
      isFileTreeInteractionDisabledRef.current ||
      activeIndexRef.current < STARTING_INDEX_TO_SELECT
    ) {
      return
    }

    const focusedEntry = rowsToRenderRef.current[activeIndexRef.current]
    if (!focusedEntry || focusedEntry.isFake) {
      return
    }

    setContextMenuRow(focusedEntry)
    setIsRenaming(true)
  }, [readOnly])

  const handleDeleteCommand = useCallback(() => {
    if (
      readOnly ||
      isFileTreeInteractionDisabledRef.current ||
      activeIndexRef.current < STARTING_INDEX_TO_SELECT
    ) {
      return
    }

    const focusedEntry = rowsToRenderRef.current[activeIndexRef.current]
    if (!focusedEntry || focusedEntry.isFake) {
      return
    }

    setContextMenuRow(focusedEntry)
    setIsDeleting(true)
  }, [readOnly])

  const handleCopyCommand = useCallback(() => {
    if (
      isFileTreeInteractionDisabledRef.current ||
      activeIndexRef.current < STARTING_INDEX_TO_SELECT
    ) {
      return
    }

    const focusedEntry = rowsToRenderRef.current[activeIndexRef.current]
    if (!focusedEntry || focusedEntry.isFake) {
      return
    }

    focusedEntry.onCopy()
  }, [])

  const handlePasteCommand = useCallback(() => {
    if (
      readOnly ||
      isFileTreeInteractionDisabledRef.current ||
      activeIndexRef.current < STARTING_INDEX_TO_SELECT
    ) {
      return
    }

    const focusedEntry = rowsToRenderRef.current[activeIndexRef.current]
    if (!focusedEntry || focusedEntry.isFake) {
      return
    }

    focusedEntry.onPaste()
  }, [readOnly])

  projectExplorerCommandHandlersRef.current.arrowLeft = handleArrowLeftCommand
  projectExplorerCommandHandlersRef.current.arrowRight = handleArrowRightCommand
  projectExplorerCommandHandlersRef.current.arrowUp = handleArrowUpCommand
  projectExplorerCommandHandlersRef.current.arrowDown = handleArrowDownCommand
  projectExplorerCommandHandlersRef.current.enter = handleEnterCommand
  projectExplorerCommandHandlersRef.current.rename = handleRenameCommand
  projectExplorerCommandHandlersRef.current.delete = handleDeleteCommand
  projectExplorerCommandHandlersRef.current.copy = handleCopyCommand
  projectExplorerCommandHandlersRef.current.paste = handlePasteCommand

  const projectExplorerCommands = useMemo<Command[]>(
    () => [
      {
        id: PROJECT_EXPLORER_COMMAND_IDS.arrowLeft,
        name: 'arrow-left',
        groupId: 'project-explorer',
        displayName: 'Close selected project explorer row',
        needsReview: false,
        hideFromSearch: true,
        onSubmit: () => projectExplorerCommandHandlersRef.current.arrowLeft(),
      },
      {
        id: PROJECT_EXPLORER_COMMAND_IDS.arrowRight,
        name: 'arrow-right',
        groupId: 'project-explorer',
        displayName: 'Open selected project explorer row',
        needsReview: false,
        hideFromSearch: true,
        onSubmit: () => projectExplorerCommandHandlersRef.current.arrowRight(),
      },
      {
        id: PROJECT_EXPLORER_COMMAND_IDS.arrowUp,
        name: 'arrow-up',
        groupId: 'project-explorer',
        displayName: 'Move project explorer selection up',
        needsReview: false,
        hideFromSearch: true,
        onSubmit: () => projectExplorerCommandHandlersRef.current.arrowUp(),
      },
      {
        id: PROJECT_EXPLORER_COMMAND_IDS.arrowDown,
        name: 'arrow-down',
        groupId: 'project-explorer',
        displayName: 'Move project explorer selection down',
        needsReview: false,
        hideFromSearch: true,
        onSubmit: () => projectExplorerCommandHandlersRef.current.arrowDown(),
      },
      {
        id: PROJECT_EXPLORER_COMMAND_IDS.enter,
        name: 'enter',
        groupId: 'project-explorer',
        displayName: 'Open selected project explorer file',
        needsReview: false,
        hideFromSearch: true,
        onSubmit: () => projectExplorerCommandHandlersRef.current.enter(),
      },
      {
        id: PROJECT_EXPLORER_COMMAND_IDS.rename,
        name: 'rename',
        groupId: 'project-explorer',
        displayName: 'Rename selected project explorer row',
        needsReview: false,
        hideFromSearch: true,
        onSubmit: () => projectExplorerCommandHandlersRef.current.rename(),
      },
      {
        id: PROJECT_EXPLORER_COMMAND_IDS.delete,
        name: 'delete',
        groupId: 'project-explorer',
        displayName: 'Delete selected project explorer row',
        needsReview: false,
        hideFromSearch: true,
        onSubmit: () => projectExplorerCommandHandlersRef.current.delete(),
      },
      {
        id: PROJECT_EXPLORER_COMMAND_IDS.copy,
        name: 'copy',
        groupId: 'project-explorer',
        displayName: 'Copy selected project explorer row',
        needsReview: false,
        hideFromSearch: true,
        onSubmit: () => projectExplorerCommandHandlersRef.current.copy(),
      },
      {
        id: PROJECT_EXPLORER_COMMAND_IDS.paste,
        name: 'paste',
        groupId: 'project-explorer',
        displayName: 'Paste into selected project explorer row',
        needsReview: false,
        hideFromSearch: true,
        onSubmit: () => projectExplorerCommandHandlersRef.current.paste(),
      },
    ],
    []
  )

  useEffect(() => {
    commands.send({
      type: 'Add commands',
      data: { commands: projectExplorerCommands },
    })

    return () => {
      commands.send({
        type: 'Remove commands',
        data: { commands: projectExplorerCommands },
      })
    }
  }, [commands, projectExplorerCommands])

  useEffect(() => {
    return () => {
      keymap?.removeScope(PROJECT_EXPLORER_FOCUSED_KEYMAP_SCOPE)
      keymap?.removeScope(PROJECT_EXPLORER_RENAMING_KEYMAP_SCOPE)
    }
  }, [keymap])

  const handleExternalFileDrop = useCallback(
    async (dataTransfer: DataTransfer, target: FileExplorerEntry | null) => {
      if (readOnly || isFileTreeInteractionDisabledRef.current) {
        return
      }

      const supportedFiles: { file: File; relativePath: string }[] = []
      // Collect all entries/files synchronously first
      // DataTransferItemList becomes invalid after async operations
      const entries: FileSystemEntry[] = []
      const fallbackFiles: File[] = []
      const failedEntryNames: string[] = []

      const items = Array.from(dataTransfer.items)
      for (const item of items) {
        if (item.kind !== 'file') {
          continue
        }

        const entry = item.webkitGetAsEntry?.()
        if (entry) {
          entries.push(entry)
        } else {
          const file = item.getAsFile()
          if (file) {
            fallbackFiles.push(file)
          }
        }
      }

      // Now process entries asynchronously
      for (const entry of entries) {
        try {
          const result = await collectDroppedFiles(entry, '')
          supportedFiles.push(...result.supported)
        } catch (e) {
          console.error('Failed to collect dropped files:', entry?.name, e)
          failedEntryNames.push(entry?.name || 'dropped item')
        }
      }
      if (failedEntryNames.length > 0) {
        const maxToShow = 3
        const shown = failedEntryNames.slice(0, maxToShow).join(', ')
        const remaining = failedEntryNames.length - maxToShow
        const message =
          remaining > 0
            ? `Failed to import ${failedEntryNames.length} items (${shown}, and ${remaining} more).`
            : `Failed to import ${failedEntryNames.length} items (${shown}).`
        toast.error(message)
      }

      // Process fallback files (browsers without webkitGetAsEntry support)
      for (const file of fallbackFiles) {
        supportedFiles.push({ file, relativePath: '' })
      }

      // Copy supported files to the target directory
      if (supportedFiles.length > 0) {
        setFileTreeMutationPending(true)
        const targetPath = getDropTargetPath(target, project.path)
        const createdDirs = new Set<string>()

        for (const { file, relativePath } of supportedFiles) {
          try {
            const destinationDirPath = relativePath
              ? joinOSPaths(targetPath, relativePath)
              : targetPath

            // Create parent directories if needed
            if (relativePath && !createdDirs.has(destinationDirPath)) {
              await fsZds.mkdir(destinationDirPath, { recursive: true })
              createdDirs.add(destinationDirPath)
            }

            const { path: destinationPath } = await getNextFileName({
              entryName: file.name,
              baseDir: destinationDirPath,
              wasmInstance,
              preserveUnknownExtension: true,
            })

            const arrayBuffer = await file.arrayBuffer()
            await fsZds.writeFile(destinationPath, new Uint8Array(arrayBuffer))
          } catch (e) {
            console.error('Failed to copy file:', file.name, e)
            toast.error(`Failed to import ${file.name}.`)
          }
        }

        // Open the target folder so the user can see the imported files
        if (target?.children) {
          const newOpenedRows = { ...openedRowsRef.current }
          newOpenedRows[target.key] = true
          setOpenedRows(newOpenedRows)
        }

        // Refresh the explorer to show the new files
        systemIOActor.send({
          type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
        })

        toast.success(
          `Imported ${supportedFiles.length} file${supportedFiles.length > 1 ? 's' : ''}.`
        )
      }
    },
    [
      readOnly,
      project.path,
      wasmInstance,
      systemIOActor,
      setFileTreeMutationPending,
    ]
  )

  const handleDragOverTarget = useCallback(
    (entry: FileExplorerEntry | null) => {
      setDragOverTarget(entry)
    },
    []
  )

  useEffect(() => {
    /**
     * You are loading a new project, clear the internal state!
     */
    const didProjectChange = previousProject.current.name !== project.name
    if (didProjectChange) {
      setOpenedRows({})
      setSelectedRow(null)
      setActiveIndexWrapper(NOTHING_IS_SELECTED)
      setRowsToRender([])
      setContextMenuRow(null)
      setIsRenaming(false)
      setIsDeleting(false)
      lastSyncedFilePathRef.current = undefined
      keymap?.removeScope(PROJECT_EXPLORER_FOCUSED_KEYMAP_SCOPE)
      keymap?.removeScope(PROJECT_EXPLORER_RENAMING_KEYMAP_SCOPE)
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

    const openedRowsForRender = { ...openedRows }
    if (!file?.path) {
      lastSyncedFilePathRef.current = undefined
    }
    const currentFileRow = file?.path
      ? flattenedData.find(
          (child) =>
            child.path === file.path && rowPathMatchesTreeParent(child, project)
        )
      : undefined
    const shouldRevealCurrentFile =
      !!currentFileRow &&
      (didProjectChange || lastSyncedFilePathRef.current !== file?.path)
    let openedRowsChanged = false
    if (shouldRevealCurrentFile) {
      const pathIterator = desktopSafePathSplit(currentFileRow.parentPath)
      while (pathIterator.length > 0) {
        const key = desktopSafePathJoin(pathIterator)
        openedRowsChanged = openedRowsChanged || !openedRowsForRender[key]
        openedRowsForRender[key] = true
        pathIterator.pop()
      }
    }
    const recursiveMoveTargetRow = lastRecursiveMoveTarget
      ? flattenedData.find(
          (child) =>
            child.path === lastRecursiveMoveTarget &&
            rowPathMatchesTreeParent(child, project)
        )
      : undefined
    const shouldRevealRecursiveMoveTarget =
      !!recursiveMoveTargetRow &&
      lastRecursiveMoveTarget !== lastRevealedRecursiveMoveTargetRef.current
    if (shouldRevealRecursiveMoveTarget) {
      const moveTargetKey =
        recursiveMoveTargetRow.children === null
          ? recursiveMoveTargetRow.parentPath
          : recursiveMoveTargetRow.key
      const pathIterator = desktopSafePathSplit(moveTargetKey)
      while (pathIterator.length > 0) {
        const key = desktopSafePathJoin(pathIterator)
        openedRowsChanged = openedRowsChanged || !openedRowsForRender[key]
        openedRowsForRender[key] = true
        pathIterator.pop()
      }
      lastRevealedRecursiveMoveTargetRef.current = lastRecursiveMoveTarget
    }

    const copyEntryToTarget = (src: FileEntry, target: FileEntry) => {
      const absoluteParentPath = getParentAbsolutePath(target.path)
      const parentIndex = flattenedData.findIndex((entry) => {
        return entry.path === absoluteParentPath
      })
      const parent = parentIndex >= 0 ? flattenedData[parentIndex] : project
      const result = copyPasteSourceAndTarget(
        target.children?.map((child) => child.path) || [],
        parent.children?.map((child) => child.path) || [],
        src,
        target,
        '-copy-'
      )
      if (result && result.src && result.target) {
        sendFileTreeMutationEvent({
          type: SystemIOMachineEvents.copyRecursive,
          data: {
            src: result.src,
            target: result.target,
          },
        })
      } else {
        toast.error('Failed to copy and paste the result is null.')
      }
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
          const isOpened = openedRowsForRender[key] || project.name === key
          isAnyParentClosed = isAnyParentClosed || !isOpened
          pathIterator.pop()
        }

        const isOpen = openedRowsForRender[child.key]
        const render =
          (openedRowsForRender[child.parentPath] ||
            project.name === child.parentPath) &&
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
          onDoubleClick: onRowDoubleClicked
            ? (domIndex: number) => {
                onRowDoubleClicked(child, domIndex)
              }
            : undefined,
          onOpen: () => {
            const newOpenedRows = { ...openedRowsRef.current }
            const key = child.key
            newOpenedRows[key] = true
            setOpenedRows(newOpenedRows)
          },
          onContextMenuOpen: (domIndex: number) => {
            focusProjectExplorer()
            setActiveIndexWrapper(domIndex)
            setContextMenuRow(child)
          },
          isFake: false,
          activeIndex: activeIndex,
          onDelete: () => {
            if (readOnly || isFileTreeInteractionDisabledRef.current) {
              return
            }

            const shouldWeNavigate =
              file?.path?.startsWith(child.path) && canNavigate

            if (shouldWeNavigate && file && file.path) {
              const src = child.path
              setFileTreeMutationPending(true)
              toArchivePath(src)
                .then((target) => {
                  sendFileTreeMutationEvent({
                    type: SystemIOMachineEvents.moveRecursiveAndNavigate,
                    data: {
                      src,
                      target,
                      successMessage: 'Archived successfully',
                      requestedProjectName: project.name,
                    },
                  })
                  kclManager.addGlobalHistoryEvent(
                    fsArchiveFile({
                      src,
                      target,
                      requestedProjectName: project.name,
                    })
                  )
                })
                .catch((e) => {
                  setFileTreeMutationPending(false)
                  console.error(e)
                  console.warn(
                    `Error while archiving: the deletion of ${child.path} may have been unrecoverable.`
                  )
                })
            } else {
              const src = child.path
              setFileTreeMutationPending(true)
              toArchivePath(src)
                .then((target) => {
                  sendFileTreeMutationEvent({
                    type: SystemIOMachineEvents.moveRecursive,
                    data: {
                      src,
                      target,
                      successMessage: 'Archived successfully',
                    },
                  })
                  kclManager.addGlobalHistoryEvent(
                    fsArchiveFile({
                      src,
                      target,
                      requestedProjectName: project.name,
                    })
                  )
                })
                .catch((e) => {
                  setFileTreeMutationPending(false)
                  console.error(e)
                  console.warn(
                    `Error while archiving: the deletion of ${child.path} may have been unrecoverable.`
                  )
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
              copyEntryToTarget(copyToClipBoard.current, {
                path: row.path,
                name: row.name,
                children: row.children,
              })
            }

            // clear the path
            copyToClipBoard.current = null
            setIsCopying(false)
          },
          /**
           * For now this mimics {onPaste} and does not destroy the previous location.
           * Once we have absolute confidence in the system and rolling back, we will make this
           * a true move behavior.
           */
          onDrop: ({ src }) => {
            if (src) {
              const absoluteParentPath = getParentAbsolutePath(row.path)
              const parentIndex = flattenedData.findIndex((entry) => {
                return entry.path === absoluteParentPath
              })
              const parent =
                parentIndex >= 0 ? flattenedData[parentIndex] : project
              const result = copyPasteSourceAndTarget(
                row.children?.map((child) => child.path) || [],
                parent.children?.map((child) => child.path) || [],
                {
                  path: src.path,
                  name: src.name,
                  children: src.children,
                },
                {
                  path: row.path,
                  name: row.name,
                  children: row.children,
                },
                '-copy-'
              )
              if (result && result.src && result.target) {
                const { src, target } = result
                sendFileTreeMutationEvent({
                  type: SystemIOMachineEvents.moveRecursive,
                  data: {
                    src,
                    target,
                  },
                })
                kclManager.addGlobalHistoryEvent(
                  fsMoveFile({
                    src,
                    target,
                    requestedProjectName: project.name,
                  })
                )
              } else {
                toast.error('Failed to copy and paste the result is null.')
              }
            }
          },
          onRenameStart: () => {
            if (readOnly) {
              return
            }

            setIsRenaming(true)
          },
          onRenameEnd: (event: MaybePressOrBlur) => {
            // TODO: Implement renameFolder and renameFile to navigate
            setIsRenaming(false)
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
                  sendFileTreeMutationEvent({
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
                  const oldPath = fsZds.join(
                    absolutePathToParentDirectory,
                    name
                  )
                  const newPath = fsZds.join(
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
                        overrideApplicationProjectDirectory ||
                          applicationProjectDirectory
                      )
                    sendFileTreeMutationEvent({
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
                    sendFileTreeMutationEvent({
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
            } else if (row.isFake) {
              // create a new file. Respect a user-typed extension, otherwise
              // assume the file is KCL.
              const fileName = fileNameHasExtension(requestedName)
                ? requestedName
                : requestedName + FILE_EXT
              const requestedAbsolutePath = joinOSPaths(
                getParentAbsolutePath(row.path),
                fileName
              )

              if (fileName.endsWith(FILE_EXT) && file && canNavigate) {
                // Create the KCL file and navigate to (open) it in the editor.
                const pathRelativeToParent = parentPathRelativeToProject(
                  requestedAbsolutePath,
                  overrideApplicationProjectDirectory ||
                    applicationProjectDirectory
                )
                sendFileTreeMutationEvent({
                  type: SystemIOMachineEvents.importFileFromURL,
                  data: {
                    requestedCode: '',
                    requestedProjectName: project.name,
                    requestedFileNameWithExtension: pathRelativeToParent,
                  },
                })
              } else {
                // Create a blank file. The actor seeds default KCL content only
                // for .kcl files and writes an empty file for everything else,
                // so non-KCL files (.md, .txt, ...) don't get KCL boilerplate.
                sendFileTreeMutationEvent({
                  type: SystemIOMachineEvents.createBlankFile,
                  data: {
                    requestedAbsolutePath,
                  },
                })
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

              const requestedAbsoluteFilePathWithExtension = joinOSPaths(
                getParentAbsolutePath(row.path),
                name
              )
              // If your router loader is within the file you are renaming then reroute to the new path on disk
              // If you are renaming a file you are not loaded into, do not reload!
              const shouldWeNavigate =
                requestedAbsoluteFilePathWithExtension === file?.path &&
                canNavigate
              sendFileTreeMutationEvent({
                type: shouldWeNavigate
                  ? SystemIOMachineEvents.renameFileAndNavigateToFile
                  : SystemIOMachineEvents.renameFile,
                data: {
                  requestedFileNameWithExtension: fileNameForcedWithOriginalExt,
                  fileNameWithExtension: name,
                  absolutePathToParentDirectory: getParentAbsolutePath(
                    row.path
                  ),
                },
              })
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

    const currentFileRowIndex = requestedRowsToRender.findIndex(
      (row) => row.path === file?.path
    )
    const shouldSyncCurrentFileSelection =
      currentFileRowIndex >= 0 && !!shouldRevealCurrentFile

    if (shouldSyncCurrentFileSelection) {
      setSelectedRowWrapper(requestedRowsToRender[currentFileRowIndex])
      setActiveIndexWrapper(currentFileRowIndex)
      lastSyncedFilePathRef.current = file?.path
    }
    if (openedRowsChanged) {
      setOpenedRowsWrapper(openedRowsForRender)
    }
    setRowsToRender(requestedRowsToRender)
    rowsToRenderRef.current = requestedRowsToRender
    previousProject.current = project
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [project, openedRows, fakeRow, activeIndex, errors, file?.path])

  useEffect(() => {
    if (isRenaming) {
      const fileExplorerContainerElement = fileExplorerContainer.current
      keymap?.removeScope(PROJECT_EXPLORER_FOCUSED_KEYMAP_SCOPE)
      keymap?.applyScope(PROJECT_EXPLORER_RENAMING_KEYMAP_SCOPE)
      return () => {
        keymap?.removeScope(PROJECT_EXPLORER_RENAMING_KEYMAP_SCOPE)
        if (fileExplorerContainerElement?.contains(document.activeElement)) {
          keymap?.applyScope(PROJECT_EXPLORER_FOCUSED_KEYMAP_SCOPE)
        }
      }
    }

    keymap?.removeScope(PROJECT_EXPLORER_RENAMING_KEYMAP_SCOPE)
  }, [isRenaming, keymap])

  // Handle clicks outside of the explorer at the global DOM level.
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
        keymap?.removeScope(PROJECT_EXPLORER_FOCUSED_KEYMAP_SCOPE)
        keymap?.removeScope(PROJECT_EXPLORER_RENAMING_KEYMAP_SCOPE)
        setActiveIndexWrapper(NOTHING_IS_SELECTED)
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [keymap, setActiveIndexWrapper])

  // Compute which entry should be highlighted for external drag
  const getHighlightedEntry = useCallback((): FileExplorerEntry | null => {
    if (!isExternalDragOver || !dragOverTarget) return null
    // If dragging over a folder, highlight that folder
    if (dragOverTarget.children !== null) {
      return dragOverTarget
    }
    // If dragging over a file, highlight its parent folder
    const parentPath = dragOverTarget.parentPath
    const parentEntry = rowsToRender.find(
      (row) => row.key === parentPath && row.children !== null
    )
    return parentEntry || null
  }, [isExternalDragOver, dragOverTarget, rowsToRender])

  const highlightedEntry = getHighlightedEntry()

  const handleExplorerFocus = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      keymap?.applyScope(PROJECT_EXPLORER_FOCUSED_KEYMAP_SCOPE)
      if (
        event.target === fileExplorerContainer.current &&
        activeIndexRef.current === NOTHING_IS_SELECTED
      ) {
        setActiveIndexWrapper(CONTAINER_IS_SELECTED)
      }
    },
    [keymap, setActiveIndexWrapper]
  )

  const handleExplorerBlur = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget
      if (
        nextTarget instanceof Node &&
        projectExplorerRef.current?.contains(nextTarget)
      ) {
        return
      }

      keymap?.removeScope(PROJECT_EXPLORER_FOCUSED_KEYMAP_SCOPE)
      keymap?.removeScope(PROJECT_EXPLORER_RENAMING_KEYMAP_SCOPE)
      setActiveIndexWrapper(NOTHING_IS_SELECTED)
    },
    [keymap, setActiveIndexWrapper]
  )

  return (
    <div
      className="h-full relative overflow-y-auto overflow-x-hidden"
      ref={projectExplorerRef}
    >
      <div
        className={`overflow-auto absolute pb-12 inset-0 transition-all duration-150 ${
          activeIndex === -1 ? 'border-sky-500' : ''
        } ${
          isExternalDragOver && !highlightedEntry
            ? 'ring-2 ring-inset ring-blue-500 bg-blue-500/5'
            : ''
        }`}
        data-testid="file-pane-scroll-container"
        tabIndex={0}
        role="tree"
        aria-label="Files Explorer"
        ref={fileExplorerContainer}
        onFocus={handleExplorerFocus}
        onBlur={handleExplorerBlur}
        onClick={(event) => {
          if (isFileTreeInteractionDisabled) {
            return
          }
          if (event.target === fileExplorerContainer.current) {
            focusProjectExplorer()
            setActiveIndexWrapper(CONTAINER_IS_SELECTED)
            setSelectedRowWrapper(null)
          }
        }}
        onDragEnter={(e) => {
          if (isFileTreeInteractionDisabled) {
            return
          }
          if (handleExternalDragEvent(e)) {
            externalDragCounter.current++
            setIsExternalDragOver(true)
          }
        }}
        onDragOver={(e) => {
          if (isFileTreeInteractionDisabled) {
            return
          }
          if (handleExternalDragEvent(e)) {
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDragLeave={(e) => {
          if (isFileTreeInteractionDisabled) {
            return
          }
          if (handleExternalDragEvent(e)) {
            externalDragCounter.current--
            if (externalDragCounter.current <= 0) {
              externalDragCounter.current = 0
              setIsExternalDragOver(false)
              setDragOverTarget(null)
            }
          }
        }}
        onDrop={(e) => {
          if (isFileTreeInteractionDisabled) {
            return
          }
          if (handleExternalDragEvent(e)) {
            externalDragCounter.current = 0
            setIsExternalDragOver(false)
            if (e.dataTransfer.items.length > 0) {
              void handleExternalFileDrop(e.dataTransfer, dragOverTarget)
            }
            setDragOverTarget(null)
          }
        }}
      >
        {project && (
          <FileExplorer
            rowsToRender={rowsToRender}
            selectedRow={selectedRow}
            contextMenuRow={contextMenuRow}
            isRenaming={isRenaming}
            isDeleting={isDeleting}
            isCopying={isCopying}
            isInteractionDisabled={isFileTreeInteractionDisabled}
            isExternalDragOver={isExternalDragOver}
            highlightedEntry={highlightedEntry}
            rowContextMenuItems={rowContextMenuItems}
            onDeleteEnd={() => {
              setIsDeleting(false)
            }}
            onExternalDragOverRow={handleDragOverTarget}
          />
        )}
      </div>
    </div>
  )
}

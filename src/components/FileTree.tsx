import { faChevronRight, faPencil } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Disclosure } from '@headlessui/react'
import type { Dispatch } from 'react'
import { useCallback, useRef, useState } from 'react'
import { useNavigate, useRouteLoaderData } from 'react-router-dom'

import { ActionButton } from '@src/components/ActionButton'
import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import { CustomIcon } from '@src/components/CustomIcon'
import { useLspContext } from '@src/components/LspProvider'
import { DeleteConfirmationDialog } from '@src/components/ProjectCard/DeleteProjectDialog'
import Tooltip from '@src/components/Tooltip'
import { useFileContext } from '@src/hooks/useFileContext'
import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import { useModelingContext } from '@src/hooks/useModelingContext'
import usePlatform from '@src/hooks/usePlatform'
import { useKclContext } from '@src/lang/KclProvider'
import type { KCLError } from '@src/lang/errors'
import { kclErrorsByFilename } from '@src/lang/errors'
import { normalizeLineEndings } from '@src/lib/codeEditor'
import { FILE_EXT } from '@src/lib/constants'
import { sortFilesAndDirectories } from '@src/lib/desktopFS'
import useHotkeyWrapper from '@src/lib/hotkeyWrapper'
import { PATHS } from '@src/lib/paths'
import type { FileEntry } from '@src/lib/project'
import { codeManager, kclManager } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import type { IndexLoaderData } from '@src/lib/types'

import styles from './FileTree.module.css'

function getIndentationCSS(level: number) {
  return `calc(1rem * ${level + 1})`
}

function TreeEntryInput(props: {
  level: number
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState('')
  const onKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    props.onSubmit(value)
  }

  return (
    <label>
      <span className="sr-only">Entry input</span>
      <input
        data-testid="tree-input-field"
        type="text"
        autoFocus
        autoCapitalize="off"
        autoCorrect="off"
        className="w-full py-1 bg-transparent text-chalkboard-100 placeholder:text-chalkboard-70 dark:text-chalkboard-10 dark:placeholder:text-chalkboard-50 focus:outline-none focus:ring-0"
        onBlur={() => props.onSubmit(value)}
        onChange={(e) => setValue(e.target.value)}
        onKeyPress={onKeyPress}
        style={{ paddingInlineStart: getIndentationCSS(props.level) }}
        value={value}
      />
    </label>
  )
}

function RenameForm({
  fileOrDir,
  onSubmit,
  level = 0,
}: {
  fileOrDir: FileEntry
  onSubmit: () => void
  level?: number
}) {
  const { send } = useFileContext()
  const inputRef = useRef<HTMLInputElement>(null)

  function handleRenameSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    send({
      type: 'Rename file',
      data: {
        oldName: fileOrDir.name || '',
        newName: inputRef.current?.value || fileOrDir.name || '',
        isDir: fileOrDir.children !== null,
      },
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onSubmit()
    }
  }

  return (
    <form onSubmit={handleRenameSubmit}>
      <label>
        <span className="sr-only">Rename file</span>
        <input
          data-testid="file-rename-field"
          ref={inputRef}
          type="text"
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={fileOrDir.name}
          className="w-full py-1 bg-transparent text-chalkboard-100 placeholder:text-chalkboard-70 dark:text-chalkboard-10 dark:placeholder:text-chalkboard-50 focus:outline-none focus:ring-0"
          onKeyDown={handleKeyDown}
          onBlur={onSubmit}
          style={{ paddingInlineStart: getIndentationCSS(level) }}
        />
      </label>
      <button className="sr-only" type="submit">
        Submit
      </button>
    </form>
  )
}

function DeleteFileTreeItemDialog({
  fileOrDir,
  setIsOpen,
}: {
  fileOrDir: FileEntry
  setIsOpen: Dispatch<React.SetStateAction<boolean>>
}) {
  const { send } = useFileContext()
  return (
    <DeleteConfirmationDialog
      title={`Delete ${fileOrDir.children !== null ? 'folder' : 'file'}`}
      onDismiss={() => setIsOpen(false)}
      onConfirm={() => {
        send({ type: 'Delete file', data: fileOrDir })
        setIsOpen(false)
      }}
    >
      <p className="my-4">
        This will permanently delete "{fileOrDir.name || 'this file'}"
        {fileOrDir.children !== null ? ' and all of its contents. ' : '. '}
      </p>
      <p className="my-4">
        Are you sure you want to delete "{fileOrDir.name || 'this file'}
        "? This action cannot be undone.
      </p>
    </DeleteConfirmationDialog>
  )
}

const FileTreeItem = ({
  parentDir,
  project,
  currentFile,
  lastDirectoryClicked,
  fileOrDir,
  onNavigateToFile,
  onClickDirectory,
  onCreateFile,
  onCreateFolder,
  onCloneFileOrFolder,
  newTreeEntry,
  level = 0,
  treeSelection,
  setTreeSelection,
  runtimeErrors,
}: {
  parentDir: FileEntry | undefined
  project?: IndexLoaderData['project']
  currentFile?: IndexLoaderData['file']
  lastDirectoryClicked?: FileEntry
  fileOrDir: FileEntry
  onNavigateToFile?: () => void
  onClickDirectory: (
    open: boolean,
    path: FileEntry,
    parentDir: FileEntry | undefined
  ) => void
  onCreateFile: (name: string) => void
  onCreateFolder: (name: string) => void
  onCloneFileOrFolder: (path: string) => void
  newTreeEntry: TreeEntry
  level?: number
  treeSelection: FileEntry | undefined
  setTreeSelection: Dispatch<React.SetStateAction<FileEntry | undefined>>
  runtimeErrors: Map<string, KCLError[]>
}) => {
  const { send: fileSend, context: fileContext } = useFileContext()
  const { onFileOpen, onFileClose } = useLspContext()
  const navigate = useNavigate()
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const isCurrentFile = fileOrDir.path === currentFile?.path
  const isFileOrDirHighlighted = treeSelection?.path === fileOrDir?.path
  const itemRef = useRef(null)

  const hasRuntimeError = runtimeErrors.has(fileOrDir.path)

  // Since every file or directory gets its own FileTreeItem, we can do this.
  // Because subtrees only render when they are opened, that means this
  // only listens when they open. Because this acts like a useEffect, when
  // the ReactNodes are destroyed, so is this listener :)
  useFileSystemWatcher(
    async (eventType, path) => {
      // Prevents a cyclic read / write causing editor problems such as
      // misplaced cursor positions.
      if (codeManager.writeCausedByAppCheckedInFileTreeFileSystemWatcher) {
        codeManager.writeCausedByAppCheckedInFileTreeFileSystemWatcher = false
        return
      }

      if (isCurrentFile && eventType === 'change') {
        let code = await window.electron.readFile(path, { encoding: 'utf-8' })
        code = normalizeLineEndings(code)
        codeManager.updateCodeStateEditor(code)
      }
      fileSend({ type: 'Refresh' })
    },
    [fileOrDir.path]
  )

  const showNewTreeEntry =
    newTreeEntry !== undefined &&
    fileOrDir.path === fileContext.selectedDirectory.path

  const isRenaming = fileContext.itemsBeingRenamed.includes(fileOrDir.path)
  const removeCurrentItemFromRenaming = useCallback(
    () =>
      fileSend({
        type: 'assign',
        data: {
          itemsBeingRenamed: fileContext.itemsBeingRenamed.filter(
            (path) => path !== fileOrDir.path
          ),
        },
      }),
    [fileContext.itemsBeingRenamed, fileOrDir.path, fileSend]
  )

  const addCurrentItemToRenaming = useCallback(() => {
    fileSend({
      type: 'assign',
      data: {
        itemsBeingRenamed: [...fileContext.itemsBeingRenamed, fileOrDir.path],
      },
    })
  }, [fileContext.itemsBeingRenamed, fileOrDir.path, fileSend])

  function handleKeyUp(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.metaKey && e.key === 'Backspace') {
      // Open confirmation dialog
      setIsConfirmingDelete(true)
    } else if (e.key === 'Enter') {
      // Show the renaming form
      addCurrentItemToRenaming()
    } else if (e.code === 'Space') {
      void handleClick().catch(reportRejection)
    }
  }

  async function handleClick() {
    setTreeSelection(fileOrDir)

    if (fileOrDir.children !== null) return // Don't open directories

    if (fileOrDir.name?.endsWith(FILE_EXT) === false && project?.path) {
      // Import non-kcl files
      // We want to update both the state and editor here.
      codeManager.updateCodeStateEditor(
        `import("${fileOrDir.path.replace(project.path, '.')}")\n` +
          codeManager.code
      )
      await codeManager.writeToFile()

      // Prevent seeing the model built one piece at a time when changing files
      await kclManager.executeCode(true)
    } else {
      // Let the lsp servers know we closed a file.
      onFileClose(currentFile?.path || null, project?.path || null)
      onFileOpen(fileOrDir.path, project?.path || null)
      kclManager.switchedFiles = true

      // Open kcl files
      navigate(`${PATHS.FILE}/${encodeURIComponent(fileOrDir.path)}`)
    }

    onNavigateToFile?.()
  }

  // The below handles both the "root" of all directories and all subs. It's
  // why some code is duplicated.
  return (
    <div className="contents" data-testid="file-tree-item" ref={itemRef}>
      {fileOrDir.children === null ? (
        <li
          className={
            'group m-0 p-0 border-solid border-0 hover:bg-primary/5 focus-within:bg-primary/5 dark:hover:bg-primary/20 dark:focus-within:bg-primary/20 ' +
            (isFileOrDirHighlighted || isCurrentFile
              ? '!bg-primary/10 !text-primary dark:!bg-primary/20 dark:!text-inherit'
              : '')
          }
        >
          {!isRenaming ? (
            <button
              className="relative flex gap-1 items-center py-0.5 rounded-none border-none p-0 m-0 text-sm w-full hover:!bg-transparent text-left !text-inherit"
              style={{ paddingInlineStart: getIndentationCSS(level) }}
              onClick={(e) => {
                e.currentTarget.focus()
                void handleClick().catch(reportRejection)
              }}
              onKeyUp={handleKeyUp}
            >
              {hasRuntimeError && (
                <p
                  className={
                    'absolute m-0 p-0 bottom-3 left-6 w-3 h-3 flex items-center justify-center text-[9px] font-semibold text-white bg-primary hue-rotate-90 rounded-full border border-chalkboard-10 dark:border-chalkboard-80 z-50 hover:cursor-pointer hover:scale-[2] transition-transform duration-200'
                  }
                  title={`Click to view notifications`}
                >
                  <span>x</span>
                </p>
              )}
              <CustomIcon
                name={fileOrDir.name?.endsWith(FILE_EXT) ? 'kcl' : 'file'}
                className="inline-block w-3 text-current"
              />
              <span className="pl-1">{fileOrDir.name}</span>
            </button>
          ) : (
            <RenameForm
              fileOrDir={fileOrDir}
              onSubmit={removeCurrentItemFromRenaming}
              level={level}
            />
          )}
        </li>
      ) : (
        <Disclosure defaultOpen={currentFile?.path.includes(fileOrDir.path)}>
          {({ open }) => (
            <div className="group">
              {!isRenaming ? (
                <Disclosure.Button
                  className={
                    ' group border-none text-sm rounded-none p-0 m-0 flex items-center justify-start w-full py-0.5 hover:text-primary hover:bg-primary/5 dark:hover:text-inherit dark:hover:bg-primary/10' +
                    (isFileOrDirHighlighted ? ' ui-open:bg-primary/10' : '')
                  }
                  style={{ paddingInlineStart: getIndentationCSS(level) }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClickDirectory(open, fileOrDir, parentDir)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                  onKeyUp={handleKeyUp}
                >
                  <FontAwesomeIcon
                    icon={faChevronRight}
                    className={
                      'inline-block mr-2 m-0 p-0 w-2 h-2 ' +
                      (open ? 'transform rotate-90' : '')
                    }
                  />
                  {fileOrDir.name}
                </Disclosure.Button>
              ) : (
                <div
                  className="flex items-center"
                  style={{ paddingInlineStart: getIndentationCSS(level) }}
                >
                  <FontAwesomeIcon
                    icon={faChevronRight}
                    className={
                      'inline-block mr-2 m-0 p-0 w-2 h-2 ' +
                      (open ? 'transform rotate-90' : '')
                    }
                  />
                  <RenameForm
                    fileOrDir={fileOrDir}
                    onSubmit={removeCurrentItemFromRenaming}
                    level={-1}
                  />
                </div>
              )}
              <Disclosure.Panel
                className={styles.folder}
                style={
                  {
                    '--indent-line-left': getIndentationCSS(level),
                  } as React.CSSProperties
                }
              >
                <ul
                  className="m-0 p-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClickDirectory(open, fileOrDir, parentDir)
                  }}
                >
                  {showNewTreeEntry && (
                    <div
                      className="flex items-center"
                      style={{
                        paddingInlineStart: getIndentationCSS(level + 1),
                      }}
                    >
                      <FontAwesomeIcon
                        icon={faPencil}
                        className="inline-block mr-2 m-0 p-0 w-2 h-2"
                      />
                      <TreeEntryInput
                        level={-1}
                        onSubmit={(value: string) =>
                          newTreeEntry === 'file'
                            ? onCreateFile(value)
                            : onCreateFolder(value)
                        }
                      />
                    </div>
                  )}
                  {sortFilesAndDirectories(fileOrDir.children || []).map(
                    (child) => (
                      <FileTreeItem
                        parentDir={fileOrDir}
                        fileOrDir={child}
                        project={project}
                        currentFile={currentFile}
                        onCreateFile={onCreateFile}
                        onCreateFolder={onCreateFolder}
                        onCloneFileOrFolder={onCloneFileOrFolder}
                        newTreeEntry={newTreeEntry}
                        lastDirectoryClicked={lastDirectoryClicked}
                        onClickDirectory={onClickDirectory}
                        onNavigateToFile={onNavigateToFile}
                        level={level + 1}
                        key={level + '-' + child.path}
                        treeSelection={treeSelection}
                        setTreeSelection={setTreeSelection}
                        runtimeErrors={runtimeErrors}
                      />
                    )
                  )}
                  {!showNewTreeEntry && fileOrDir.children?.length === 0 && (
                    <div
                      className="flex items-center text-chalkboard-50"
                      style={{
                        paddingInlineStart: getIndentationCSS(level + 1),
                      }}
                    >
                      <div>No files</div>
                    </div>
                  )}
                </ul>
              </Disclosure.Panel>
            </div>
          )}
        </Disclosure>
      )}

      {isConfirmingDelete && (
        <DeleteFileTreeItemDialog
          fileOrDir={fileOrDir}
          setIsOpen={setIsConfirmingDelete}
        />
      )}
      <FileTreeContextMenu
        itemRef={itemRef}
        onRename={addCurrentItemToRenaming}
        onDelete={() => setIsConfirmingDelete(true)}
        onClone={() => onCloneFileOrFolder(fileOrDir.path)}
      />
    </div>
  )
}

interface FileTreeContextMenuProps {
  itemRef: React.RefObject<HTMLElement>
  onRename: () => void
  onDelete: () => void
  onClone: () => void
}

function FileTreeContextMenu({
  itemRef,
  onRename,
  onDelete,
  onClone,
}: FileTreeContextMenuProps) {
  const platform = usePlatform()
  const metaKey = platform === 'macos' ? '⌘' : 'Ctrl'

  return (
    <ContextMenu
      menuTargetElement={itemRef}
      items={[
        <ContextMenuItem
          data-testid="context-menu-rename"
          onClick={onRename}
          hotkey="Enter"
        >
          Rename
        </ContextMenuItem>,
        <ContextMenuItem
          data-testid="context-menu-delete"
          onClick={onDelete}
          hotkey={metaKey + ' + Del'}
        >
          Delete
        </ContextMenuItem>,
        <ContextMenuItem
          data-testid="context-menu-clone"
          onClick={onClone}
          hotkey=""
        >
          Clone
        </ContextMenuItem>,
      ]}
    />
  )
}

interface FileTreeProps {
  className?: string
  file?: IndexLoaderData['file']
  onNavigateToFile: (
    focusableElement?: HTMLElement | React.MutableRefObject<HTMLElement | null>
  ) => void
}

export const FileTreeMenu = ({
  onCreateFile,
  onCreateFolder,
}: {
  onCreateFile: () => void
  onCreateFolder: () => void
}) => {
  useHotkeyWrapper(['mod + n'], onCreateFile)
  useHotkeyWrapper(['mod + shift + n'], onCreateFolder)

  return (
    <>
      <ActionButton
        Element="button"
        data-testid="create-file-button"
        iconStart={{
          icon: 'filePlus',
          iconClassName: '!text-current',
          bgClassName: 'bg-transparent',
        }}
        className="!p-0 !bg-transparent hover:text-primary border-transparent hover:border-primary !outline-none"
        onClick={onCreateFile}
      >
        <Tooltip position="bottom-right">Create file</Tooltip>
      </ActionButton>

      <ActionButton
        Element="button"
        data-testid="create-folder-button"
        iconStart={{
          icon: 'folderPlus',
          iconClassName: '!text-current',
          bgClassName: 'bg-transparent',
        }}
        className="!p-0 !bg-transparent hover:text-primary border-transparent hover:border-primary !outline-none"
        onClick={onCreateFolder}
      >
        <Tooltip position="bottom-right">Create folder</Tooltip>
      </ActionButton>
    </>
  )
}

type TreeEntry = 'file' | 'folder' | undefined

export const useFileTreeOperations = () => {
  const { send } = useFileContext()
  const { send: modelingSend } = useModelingContext()

  // As long as this is undefined, a new "file tree entry prompt" is not shown.
  const [newTreeEntry, setNewTreeEntry] = useState<TreeEntry>(undefined)

  function createFile(args: { dryRun: boolean; name?: string }) {
    if (args.dryRun) {
      setNewTreeEntry('file')
      return
    }

    // Clear so that the entry prompt goes away.
    setNewTreeEntry(undefined)

    if (!args.name) return

    send({
      type: 'Create file',
      data: { name: args.name, makeDir: false, shouldSetToRename: false },
    })
    modelingSend({ type: 'Cancel' })
  }

  function createFolder(args: { dryRun: boolean; name?: string }) {
    if (args.dryRun) {
      setNewTreeEntry('folder')
      return
    }

    setNewTreeEntry(undefined)

    if (!args.name) return

    send({
      type: 'Create file',
      data: { name: args.name, makeDir: true, shouldSetToRename: false },
    })
  }

  function cloneFileOrDir(args: { path: string }) {
    send({
      type: 'Create file',
      data: {
        name: '',
        makeDir: false,
        shouldSetToRename: false,
        targetPathToClone: args.path,
      },
    })
  }

  return {
    createFile,
    createFolder,
    cloneFileOrDir,
    newTreeEntry,
  }
}

export const FileTree = ({
  className = '',
  onNavigateToFile: closePanel,
}: FileTreeProps) => {
  const { createFile, createFolder, cloneFileOrDir, newTreeEntry } =
    useFileTreeOperations()

  return (
    <div className={className}>
      <div className="flex items-center gap-1 px-4 py-1 bg-chalkboard-20/40 dark:bg-chalkboard-80/50 border-b border-b-chalkboard-30 dark:border-b-chalkboard-80">
        <h2 className="flex-1 m-0 p-0 text-sm mono">Files</h2>
        <FileTreeMenu
          onCreateFile={() => createFile({ dryRun: true })}
          onCreateFolder={() => createFolder({ dryRun: true })}
        />
      </div>
      <FileTreeInner
        onNavigateToFile={closePanel}
        newTreeEntry={newTreeEntry}
        onCreateFile={(name: string) => createFile({ dryRun: false, name })}
        onCreateFolder={(name: string) => createFolder({ dryRun: false, name })}
        onCloneFileOrFolder={(path: string) => cloneFileOrDir({ path })}
      />
    </div>
  )
}

export const FileTreeInner = ({
  onNavigateToFile,
  onCreateFile,
  onCreateFolder,
  onCloneFileOrFolder,
  newTreeEntry,
}: {
  onCreateFile: (name: string) => void
  onCreateFolder: (name: string) => void
  onCloneFileOrFolder: (path: string) => void
  newTreeEntry: TreeEntry
  onNavigateToFile?: () => void
}) => {
  const loaderData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const { send: fileSend, context: fileContext } = useFileContext()
  const { send: modelingSend } = useModelingContext()
  const { errors } = useKclContext()
  const runtimeErrors = kclErrorsByFilename(errors)

  const [lastDirectoryClicked, setLastDirectoryClicked] = useState<
    FileEntry | undefined
  >(undefined)

  const [treeSelection, setTreeSelection] = useState<FileEntry | undefined>(
    loaderData.file
  )

  const onNavigateToFile_ = () => {
    // Reset modeling state when navigating to a new file
    onNavigateToFile?.()
    modelingSend({ type: 'Cancel' })
  }

  // Refresh the file tree when there are changes.
  useFileSystemWatcher(
    async (eventType, path) => {
      // Our other watcher races with this watcher on the current file changes,
      // so we need to stop this one from reacting at all, otherwise Bad Things
      // Happen™.
      const isCurrentFile = loaderData.file?.path === path
      const hasChanged = eventType === 'change'
      if (isCurrentFile && hasChanged) return

      // If it's a settings file we wrote to already from the app ignore it.
      if (codeManager.writeCausedByAppCheckedInFileTreeFileSystemWatcher) {
        codeManager.writeCausedByAppCheckedInFileTreeFileSystemWatcher = false
        return
      }

      fileSend({ type: 'Refresh' })
    },
    [loaderData?.project?.path, fileContext.selectedDirectory.path].filter(
      (x: string | undefined) => x !== undefined
    )
  )

  const onTreeEntryInputSubmit = (value: string) => {
    if (newTreeEntry === 'file') {
      onCreateFile(value)
      onNavigateToFile_()
    } else {
      onCreateFolder(value)
    }
  }

  const onClickDirectory = (
    open_: boolean,
    fileOrDir: FileEntry,
    parentDir: FileEntry | undefined
  ) => {
    // open true is closed... it's broken. Save me. I've inverted it here for
    // sanity.
    const open = !open_

    const target = open ? fileOrDir : parentDir

    // We're at the root, can't select anything further
    if (!target) return

    setTreeSelection(target)
    setLastDirectoryClicked(target)
    fileSend({
      type: 'Set selected directory',
      directory: target,
    })
  }

  const showNewTreeEntry =
    newTreeEntry !== undefined &&
    fileContext.selectedDirectory.path === loaderData.project?.path

  return (
    <div className="relative">
      <div
        className="overflow-auto pb-12 absolute inset-0"
        data-testid="file-pane-scroll-container"
      >
        <ul className="m-0 p-0 text-sm">
          {showNewTreeEntry && (
            <div
              className="flex items-center"
              style={{ paddingInlineStart: getIndentationCSS(0) }}
            >
              <FontAwesomeIcon
                icon={faPencil}
                className="inline-block mr-2 m-0 p-0 w-2 h-2"
              />
              <TreeEntryInput level={-1} onSubmit={onTreeEntryInputSubmit} />
            </div>
          )}
          {sortFilesAndDirectories(fileContext.project?.children || []).map(
            (fileOrDir) => (
              <FileTreeItem
                parentDir={fileContext.project}
                project={fileContext.project}
                currentFile={loaderData?.file}
                lastDirectoryClicked={lastDirectoryClicked}
                fileOrDir={fileOrDir}
                onCreateFile={onCreateFile}
                onCreateFolder={onCreateFolder}
                onCloneFileOrFolder={onCloneFileOrFolder}
                newTreeEntry={newTreeEntry}
                onClickDirectory={onClickDirectory}
                onNavigateToFile={onNavigateToFile_}
                key={fileOrDir.path}
                treeSelection={treeSelection}
                setTreeSelection={setTreeSelection}
                runtimeErrors={runtimeErrors}
              />
            )
          )}
        </ul>
      </div>
    </div>
  )
}

export const FileTreeRoot = () => {
  const loaderData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const { project } = loaderData

  // project.path should never be empty here but I guess during initial loading
  // it can be.
  return (
    <div
      className="max-w-xs text-ellipsis overflow-hidden cursor-pointer"
      title={project?.path ?? ''}
    >
      {project?.name ?? ''}
    </div>
  )
}

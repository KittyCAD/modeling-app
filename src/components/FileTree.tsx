import type { FileEntry, IndexLoaderData } from 'lib/types'
import { paths } from 'lib/paths'
import { ActionButton } from './ActionButton'
import Tooltip from './Tooltip'
import { Dispatch, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useRouteLoaderData } from 'react-router-dom'
import { Disclosure } from '@headlessui/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight } from '@fortawesome/free-solid-svg-icons'
import { useFileContext } from 'hooks/useFileContext'
import styles from './FileTree.module.css'
import { sortProject } from 'lib/tauriFS'
import { FILE_EXT } from 'lib/constants'
import { CustomIcon } from './CustomIcon'
import { codeManager, kclManager } from 'lib/singletons'
import { useDocumentHasFocus } from 'hooks/useDocumentHasFocus'
import { useLspContext } from './LspProvider'
import useHotkeyWrapper from 'lib/hotkeyWrapper'
import { useModelingContext } from 'hooks/useModelingContext'
import { DeleteConfirmationDialog } from './ProjectCard/DeleteProjectDialog'
import { ContextMenu, ContextMenuItem } from './ContextMenu'
import usePlatform from 'hooks/usePlatform'

function getIndentationCSS(level: number) {
  return `calc(1rem * ${level + 1})`
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
        isDir: fileOrDir.children !== undefined,
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
      title={`Delete ${fileOrDir.children !== undefined ? 'folder' : 'file'}`}
      onDismiss={() => setIsOpen(false)}
      onConfirm={() => {
        send({ type: 'Delete file', data: fileOrDir })
        setIsOpen(false)
      }}
    >
      <p className="my-4">
        This will permanently delete "{fileOrDir.name || 'this file'}"
        {fileOrDir.children !== undefined ? ' and all of its contents. ' : '. '}
      </p>
      <p className="my-4">
        Are you sure you want to delete "{fileOrDir.name || 'this file'}
        "? This action cannot be undone.
      </p>
    </DeleteConfirmationDialog>
  )
}

const FileTreeItem = ({
  project,
  currentFile,
  fileOrDir,
  onNavigateToFile,
  level = 0,
}: {
  project?: IndexLoaderData['project']
  currentFile?: IndexLoaderData['file']
  fileOrDir: FileEntry
  onNavigateToFile?: () => void
  level?: number
}) => {
  const { send: fileSend, context: fileContext } = useFileContext()
  const { onFileOpen, onFileClose } = useLspContext()
  const navigate = useNavigate()
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const isCurrentFile = fileOrDir.path === currentFile?.path
  const itemRef = useRef(null)

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
      handleClick()
    }
  }

  function handleClick() {
    if (fileOrDir.children !== undefined) return // Don't open directories

    if (fileOrDir.name?.endsWith(FILE_EXT) === false && project?.path) {
      // Import non-kcl files
      // We want to update both the state and editor here.
      codeManager.updateCodeStateEditor(
        `import("${fileOrDir.path.replace(project.path, '.')}")\n` +
          codeManager.code
      )
      codeManager.writeToFile()
      kclManager.executeCode(true, true)
    } else {
      // Let the lsp servers know we closed a file.
      onFileClose(currentFile?.path || null, project?.path || null)
      onFileOpen(fileOrDir.path, project?.path || null)

      // Open kcl files
      navigate(`${paths.FILE}/${encodeURIComponent(fileOrDir.path)}`)
    }
    onNavigateToFile?.()
  }

  return (
    <div className="contents" ref={itemRef}>
      {fileOrDir.children === undefined ? (
        <li
          className={
            'group m-0 p-0 border-solid border-0 hover:bg-primary/5 focus-within:bg-primary/5 dark:hover:bg-primary/20 dark:focus-within:bg-primary/20 ' +
            (isCurrentFile
              ? '!bg-primary/10 !text-primary dark:!bg-primary/20 dark:!text-inherit'
              : '')
          }
        >
          {!isRenaming ? (
            <button
              className="flex gap-1 items-center py-0.5 rounded-none border-none p-0 m-0 text-sm w-full hover:!bg-transparent text-left !text-inherit"
              style={{ paddingInlineStart: getIndentationCSS(level) }}
              onClick={(e) => {
                e.currentTarget.focus()
                handleClick()
              }}
              onKeyUp={handleKeyUp}
            >
              <CustomIcon
                name={fileOrDir.name?.endsWith(FILE_EXT) ? 'kcl' : 'file'}
                className="inline-block w-3 text-current"
              />
              {fileOrDir.name}
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
                    (fileContext.selectedDirectory.path.includes(fileOrDir.path)
                      ? ' ui-open:bg-primary/10'
                      : '')
                  }
                  style={{ paddingInlineStart: getIndentationCSS(level) }}
                  onClick={(e) => e.currentTarget.focus()}
                  onClickCapture={(e) =>
                    fileSend({
                      type: 'Set selected directory',
                      data: fileOrDir,
                    })
                  }
                  onFocusCapture={(e) =>
                    fileSend({
                      type: 'Set selected directory',
                      data: fileOrDir,
                    })
                  }
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
                  onClickCapture={(e) => {
                    fileSend({
                      type: 'Set selected directory',
                      data: fileOrDir,
                    })
                  }}
                  onFocusCapture={(e) =>
                    fileSend({
                      type: 'Set selected directory',
                      data: fileOrDir,
                    })
                  }
                >
                  {fileOrDir.children?.map((child) => (
                    <FileTreeItem
                      fileOrDir={child}
                      project={project}
                      currentFile={currentFile}
                      onNavigateToFile={onNavigateToFile}
                      level={level + 1}
                      key={level + '-' + child.path}
                    />
                  ))}
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
      />
    </div>
  )
}

interface FileTreeContextMenuProps {
  itemRef: React.RefObject<HTMLElement>
  onRename: () => void
  onDelete: () => void
}

function FileTreeContextMenu({
  itemRef,
  onRename,
  onDelete,
}: FileTreeContextMenuProps) {
  const platform = usePlatform()
  const metaKey = platform === 'macos' ? '⌘' : 'Ctrl'

  return (
    <ContextMenu
      menuTargetElement={itemRef}
      items={[
        <ContextMenuItem onClick={onRename} hotkey="Enter">
          Rename
        </ContextMenuItem>,
        <ContextMenuItem onClick={onDelete} hotkey={metaKey + '+Bksp'}>
          Delete
        </ContextMenuItem>,
      ]}
    />
  )
}

interface FileTreeProps {
  className?: string
  file?: IndexLoaderData['file']
  onNavigateToFile: (
    focusableElement?:
      | HTMLElement
      | React.MutableRefObject<HTMLElement | null>
      | undefined
  ) => void
}

export const FileTreeMenu = () => {
  const { send } = useFileContext()

  async function createFile() {
    send({ type: 'Create file', data: { name: '', makeDir: false } })
  }

  async function createFolder() {
    send({ type: 'Create file', data: { name: '', makeDir: true } })
  }

  useHotkeyWrapper(['meta + n'], createFile)
  useHotkeyWrapper(['meta + shift + n'], createFolder)

  return (
    <>
      <ActionButton
        Element="button"
        iconStart={{
          icon: 'filePlus',
          iconClassName: '!text-current',
          bgClassName: 'bg-transparent',
        }}
        className="!p-0 !bg-transparent hover:text-primary border-transparent hover:border-primary !outline-none"
        onClick={createFile}
      >
        <Tooltip position="bottom-right" delay={750}>
          Create file
        </Tooltip>
      </ActionButton>

      <ActionButton
        Element="button"
        iconStart={{
          icon: 'folderPlus',
          iconClassName: '!text-current',
          bgClassName: 'bg-transparent',
        }}
        className="!p-0 !bg-transparent hover:text-primary border-transparent hover:border-primary !outline-none"
        onClick={createFolder}
      >
        <Tooltip position="bottom-right" delay={750}>
          Create folder
        </Tooltip>
      </ActionButton>
    </>
  )
}

export const FileTree = ({
  className = '',
  onNavigateToFile: closePanel,
}: FileTreeProps) => {
  return (
    <div className={className}>
      <div className="flex items-center gap-1 px-4 py-1 bg-chalkboard-20/40 dark:bg-chalkboard-80/50 border-b border-b-chalkboard-30 dark:border-b-chalkboard-80">
        <h2 className="flex-1 m-0 p-0 text-sm mono">Files</h2>
        <FileTreeMenu />
      </div>
      <FileTreeInner onNavigateToFile={closePanel} />
    </div>
  )
}

export const FileTreeInner = ({
  onNavigateToFile,
}: {
  onNavigateToFile?: () => void
}) => {
  const loaderData = useRouteLoaderData(paths.FILE) as IndexLoaderData
  const { send: fileSend, context: fileContext } = useFileContext()
  const { send: modelingSend } = useModelingContext()
  const documentHasFocus = useDocumentHasFocus()

  // Refresh the file tree when the document gets focus
  useEffect(() => {
    fileSend({ type: 'Refresh' })
  }, [documentHasFocus])

  return (
    <div className="overflow-auto max-h-full pb-12">
      <ul
        className="m-0 p-0 text-sm"
        onClickCapture={(e) => {
          fileSend({
            type: 'Set selected directory',
            data: fileContext.project,
          })
        }}
      >
        {sortProject(fileContext.project?.children || []).map((fileOrDir) => (
          <FileTreeItem
            project={fileContext.project}
            currentFile={loaderData?.file}
            fileOrDir={fileOrDir}
            onNavigateToFile={() => {
              // Reset modeling state when navigating to a new file
              modelingSend({ type: 'Cancel' })
              onNavigateToFile?.()
            }}
            key={fileOrDir.path}
          />
        ))}
      </ul>
    </div>
  )
}

import type { FileEntry, IndexLoaderData } from 'lib/types'
import { paths } from 'lib/paths'
import { ActionButton } from './ActionButton'
import Tooltip from './Tooltip'
import { Dispatch, useEffect, useRef, useState } from 'react'
import { useNavigate, useRouteLoaderData } from 'react-router-dom'
import { Dialog, Disclosure } from '@headlessui/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight, faTrashAlt } from '@fortawesome/free-solid-svg-icons'
import { useFileContext } from 'hooks/useFileContext'
import styles from './FileTree.module.css'
import { sortProject } from 'lib/tauriFS'
import { FILE_EXT } from 'lib/constants'
import { CustomIcon } from './CustomIcon'
import { codeManager, kclManager } from 'lib/singletons'
import { useDocumentHasFocus } from 'hooks/useDocumentHasFocus'
import { useLspContext } from './LspProvider'
import useHotkeyWrapper from 'lib/hotkeyWrapper'

function getIndentationCSS(level: number) {
  return `calc(1rem * ${level + 1})`
}

function RenameForm({
  fileOrDir,
  setIsRenaming,
  level = 0,
}: {
  fileOrDir: FileEntry
  setIsRenaming: Dispatch<React.SetStateAction<boolean>>
  level?: number
}) {
  const { send } = useFileContext()
  const inputRef = useRef<HTMLInputElement>(null)

  function handleRenameSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsRenaming(false)
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
      setIsRenaming(false)
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
          placeholder={fileOrDir.name}
          className="w-full py-1 bg-transparent text-chalkboard-100 placeholder:text-chalkboard-70 dark:text-chalkboard-10 dark:placeholder:text-chalkboard-50 focus:outline-none focus:ring-0"
          onKeyDown={handleKeyDown}
          onBlur={() => setIsRenaming(false)}
          style={{ paddingInlineStart: getIndentationCSS(level) }}
        />
      </label>
      <button className="sr-only" type="submit">
        Submit
      </button>
    </form>
  )
}

function DeleteConfirmationDialog({
  fileOrDir,
  setIsOpen,
}: {
  fileOrDir: FileEntry
  setIsOpen: Dispatch<React.SetStateAction<boolean>>
}) {
  const { send } = useFileContext()
  return (
    <Dialog
      open={true}
      onClose={() => setIsOpen(false)}
      className="relative z-50"
    >
      <div className="fixed inset-0 bg-chalkboard-110/80 grid place-content-center">
        <Dialog.Panel className="rounded p-4 bg-chalkboard-10 dark:bg-chalkboard-100 border border-destroy-80 max-w-2xl">
          <Dialog.Title as="h2" className="text-2xl font-bold mb-4">
            Delete {fileOrDir.children !== undefined ? 'Folder' : 'File'}
          </Dialog.Title>
          <Dialog.Description className="my-6">
            This will permanently delete "{fileOrDir.name || 'this file'}"
            {fileOrDir.children !== undefined
              ? ' and all of its contents. '
              : '. '}
            This action cannot be undone.
          </Dialog.Description>

          <div className="flex justify-between">
            <ActionButton
              Element="button"
              onClick={async () => {
                send({ type: 'Delete file', data: fileOrDir })
                setIsOpen(false)
              }}
              iconStart={{
                icon: faTrashAlt,
                bgClassName: 'bg-destroy-80',
                iconClassName:
                  'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10 dark:text-destroy-20 dark:group-hover:text-destroy-10 dark:hover:text-destroy-10',
              }}
              className="hover:border-destroy-40 dark:hover:border-destroy-40"
            >
              Delete
            </ActionButton>
            <ActionButton Element="button" onClick={() => setIsOpen(false)}>
              Cancel
            </ActionButton>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}

const FileTreeItem = ({
  project,
  currentFile,
  fileOrDir,
  onDoubleClick,
  level = 0,
}: {
  project?: IndexLoaderData['project']
  currentFile?: IndexLoaderData['file']
  fileOrDir: FileEntry
  onDoubleClick?: () => void
  level?: number
}) => {
  const { send, context } = useFileContext()
  const { onFileOpen, onFileClose } = useLspContext()
  const navigate = useNavigate()
  const [isRenaming, setIsRenaming] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const isCurrentFile = fileOrDir.path === currentFile?.path

  function handleKeyUp(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.metaKey && e.key === 'Backspace') {
      // Open confirmation dialog
      setIsConfirmingDelete(true)
    } else if (e.key === 'Enter') {
      // Show the renaming form
      setIsRenaming(true)
    } else if (e.code === 'Space') {
      handleDoubleClick()
    }
  }

  function handleDoubleClick() {
    if (fileOrDir.children !== undefined) return // Don't open directories

    if (fileOrDir.name?.endsWith(FILE_EXT) === false && project?.path) {
      // Import non-kcl files
      // We want to update both the state and editor here.
      codeManager.updateCodeStateEditor(
        `import("${fileOrDir.path.replace(project.path, '.')}")\n` +
          codeManager.code
      )
      codeManager.writeToFile()
      kclManager.executeCode(true)
    } else {
      // Let the lsp servers know we closed a file.
      onFileClose(currentFile?.path || null, project?.path || null)
      onFileOpen(fileOrDir.path, project?.path || null)

      // Open kcl files
      navigate(`${paths.FILE}/${encodeURIComponent(fileOrDir.path)}`)
    }
    onDoubleClick?.()
  }

  return (
    <>
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
              onDoubleClick={handleDoubleClick}
              onClick={(e) => e.currentTarget.focus()}
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
              setIsRenaming={setIsRenaming}
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
                    (context.selectedDirectory.path.includes(fileOrDir.path)
                      ? ' ui-open:bg-primary/10'
                      : '')
                  }
                  style={{ paddingInlineStart: getIndentationCSS(level) }}
                  onClick={(e) => e.currentTarget.focus()}
                  onClickCapture={(e) =>
                    send({ type: 'Set selected directory', data: fileOrDir })
                  }
                  onFocusCapture={(e) =>
                    send({ type: 'Set selected directory', data: fileOrDir })
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
                    setIsRenaming={setIsRenaming}
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
                    send({ type: 'Set selected directory', data: fileOrDir })
                  }}
                  onFocusCapture={(e) =>
                    send({ type: 'Set selected directory', data: fileOrDir })
                  }
                >
                  {fileOrDir.children?.map((child) => (
                    <FileTreeItem
                      fileOrDir={child}
                      project={project}
                      currentFile={currentFile}
                      onDoubleClick={onDoubleClick}
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
        <DeleteConfirmationDialog
          fileOrDir={fileOrDir}
          setIsOpen={setIsConfirmingDelete}
        />
      )}
    </>
  )
}

interface FileTreeProps {
  className?: string
  file?: IndexLoaderData['file']
  closePanel: (
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

export const FileTree = ({ className = '', closePanel }: FileTreeProps) => {
  return (
    <div className={className}>
      <div className="flex items-center gap-1 px-4 py-1 bg-chalkboard-20/40 dark:bg-chalkboard-80/50 border-b border-b-chalkboard-30 dark:border-b-chalkboard-80">
        <h2 className="flex-1 m-0 p-0 text-sm mono">Files</h2>
        <FileTreeMenu />
      </div>
      <FileTreeInner onDoubleClick={closePanel} />
    </div>
  )
}

export const FileTreeInner = ({
  onDoubleClick,
}: {
  onDoubleClick?: () => void
}) => {
  const loaderData = useRouteLoaderData(paths.FILE) as IndexLoaderData
  const { send, context } = useFileContext()
  const documentHasFocus = useDocumentHasFocus()

  // Refresh the file tree when the document gets focus
  useEffect(() => {
    send({ type: 'Refresh' })
  }, [documentHasFocus])

  return (
    <div className="overflow-auto max-h-full pb-12">
      <ul
        className="m-0 p-0 text-sm"
        onClickCapture={(e) => {
          send({ type: 'Set selected directory', data: context.project })
        }}
      >
        {sortProject(context.project.children || []).map((fileOrDir) => (
          <FileTreeItem
            project={context.project}
            currentFile={loaderData?.file}
            fileOrDir={fileOrDir}
            onDoubleClick={onDoubleClick}
            key={fileOrDir.path}
          />
        ))}
      </ul>
    </div>
  )
}

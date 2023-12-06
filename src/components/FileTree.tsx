import { IndexLoaderData, paths } from 'Router'
import { ActionButton } from './ActionButton'
import Tooltip from './Tooltip'
import { FileEntry } from '@tauri-apps/api/fs'
import { Dispatch, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, Disclosure } from '@headlessui/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight, faTrashAlt } from '@fortawesome/free-solid-svg-icons'
import { useFileContext } from 'hooks/useFileContext'
import { useHotkeys } from 'react-hotkeys-hook'
import styles from './FileTree.module.css'
import { sortProject } from 'lib/tauriFS'

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
              icon={{
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
  closePanel,
  level = 0,
}: {
  project?: IndexLoaderData['project']
  currentFile?: IndexLoaderData['file']
  fileOrDir: FileEntry
  closePanel: (
    focusableElement?:
      | HTMLElement
      | React.MutableRefObject<HTMLElement | null>
      | undefined
  ) => void
  level?: number
}) => {
  const { send, context } = useFileContext()
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
      openFile()
    }
  }

  function openFile() {
    if (fileOrDir.children !== undefined) return // Don't open directories
    navigate(`${paths.FILE}/${encodeURIComponent(fileOrDir.path)}`)
    closePanel()
  }

  return (
    <>
      {fileOrDir.children === undefined ? (
        <li
          className={
            'group m-0 p-0 border-solid border-0 text-energy-100 hover:text-energy-70 hover:bg-energy-10/50 dark:text-energy-30 dark:hover:!text-energy-20 dark:hover:bg-energy-90/50 focus-within:bg-energy-10/80 dark:focus-within:bg-energy-80/50 hover:focus-within:bg-energy-10/80 dark:hover:focus-within:bg-energy-80/50 ' +
            (isCurrentFile ? 'bg-energy-10/50 dark:bg-energy-90/50' : '')
          }
        >
          {!isRenaming ? (
            <button
              className="flex gap-1 items-center py-0.5 rounded-none border-none p-0 m-0 text-sm w-full hover:!bg-transparent text-left !text-inherit"
              style={{ paddingInlineStart: getIndentationCSS(level) }}
              onDoubleClick={openFile}
              onClick={(e) => e.currentTarget.focus()}
              onKeyUp={handleKeyUp}
            >
              <KclIcon
                className={
                  'inline-block w-3 ' +
                  (isCurrentFile
                    ? 'text-energy-90 dark:text-energy-10'
                    : 'text-energy-50 dark:text-energy-50')
                }
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
                    ' group border-none text-sm rounded-none p-0 m-0 flex items-center justify-start w-full py-0.5 text-chalkboard-70 dark:text-chalkboard-30 hover:bg-energy-10/50 dark:hover:bg-energy-90/50' +
                    (context.selectedDirectory.path.includes(fileOrDir.path)
                      ? ' group-focus-within:bg-chalkboard-20/50 dark:group-focus-within:bg-chalkboard-80/20 hover:group-focus-within:bg-chalkboard-20 dark:hover:group-focus-within:bg-chalkboard-80/20 group-active:bg-chalkboard-20/50 dark:group-active:bg-chalkboard-80/20 hover:group-active:bg-chalkboard-20/50 dark:hover:group-active:bg-chalkboard-80/20'
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
                      closePanel={closePanel}
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

export const FileTree = ({
  className = '',
  file,
  closePanel,
}: FileTreeProps) => {
  const { send, context } = useFileContext()
  useHotkeys('meta + n', createFile)
  useHotkeys('meta + shift + n', createFolder)

  async function createFile() {
    send({ type: 'Create file', data: { name: '', makeDir: false } })
  }

  async function createFolder() {
    send({ type: 'Create file', data: { name: '', makeDir: true } })
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-1 px-4 py-1 bg-chalkboard-20/50 dark:bg-chalkboard-80/50 border-b border-b-chalkboard-30 dark:border-b-chalkboard-80">
        <h2 className="flex-1 m-0 p-0 text-sm mono">Files</h2>
        <ActionButton
          Element="button"
          icon={{
            icon: 'filePlus',
            iconClassName: '!text-energy-80 dark:!text-energy-20',
            bgClassName: 'bg-chalkboard-20/50 hover:bg-energy-10/50 dark:hover:bg-transparent',
          }}
          className="!p-0 bg-transparent !outline-none"
          onClick={createFile}
        >
          <Tooltip position="inlineStart" delay={750}>
            Create File
          </Tooltip>
        </ActionButton>

        <ActionButton
          Element="button"
          icon={{
            icon: 'folderPlus',
            iconClassName: '!text-energy-80 dark:!text-energy-20',
            bgClassName: 'bg-chalkboard-20/50 hover:bg-energy-10/50 dark:hover:bg-transparent',
          }}
          className="!p-0 bg-transparent !outline-none"
          onClick={createFolder}
        >
          <Tooltip position="inlineStart" delay={750}>
            Create Folder
          </Tooltip>
        </ActionButton>
      </div>
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
              currentFile={file}
              fileOrDir={fileOrDir}
              closePanel={closePanel}
              key={fileOrDir.path}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}

function KclIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M40 0H0V40H40V0ZM7.34715 27.2143V15.6577L2.976 15.987V36.7949H7.34715V32.0645L8.00582 31.5256C8.24533 31.326 8.47487 31.1264 8.69442 30.9268L12.1075 36.7949H17.0475C16.1893 35.3978 15.311 33.9906 14.4128 32.5735C13.5346 31.1563 12.6664 29.7392 11.8081 28.3221L15.8499 24.9389C15.4308 24.4399 15.0017 23.931 14.5625 23.412L13.3051 21.8552L7.34715 27.2143ZM22.2581 26.6754C22.8769 25.9169 23.6753 25.5377 24.6533 25.5377C25.272 25.5377 25.8309 25.6175 26.3299 25.7772C26.8289 25.9169 27.4177 26.1465 28.0963 26.4658L29.3238 23.3521C28.5853 22.7933 27.7371 22.4041 26.779 22.1845C25.8409 21.9649 25.0625 21.8552 24.4437 21.8552C22.0885 21.8552 20.2223 22.5537 18.845 23.9509C17.4878 25.3281 16.8092 27.1944 16.8092 29.5496C16.8092 31.9048 17.4878 33.7611 18.845 35.1183C20.2223 36.4756 22.0885 37.1542 24.4437 37.1542C25.0625 37.1542 25.8509 37.0444 26.8089 36.8249C27.767 36.6053 28.6053 36.2161 29.3238 35.6572L28.0963 32.5435C27.4177 32.8629 26.8289 33.0924 26.3299 33.2321C25.8309 33.3718 25.272 33.4417 24.6533 33.4417C23.6753 33.4417 22.8769 33.0924 22.2581 32.3938C21.6594 31.6753 21.36 30.7272 21.36 29.5496C21.36 28.372 21.6594 27.4139 22.2581 26.6754ZM36.2796 36.7949V15.6577L31.9085 15.987V36.7949H36.2796Z"
        fill="currentColor"
      />
    </svg>
  )
}

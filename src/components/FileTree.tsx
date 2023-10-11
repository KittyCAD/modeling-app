import { IndexLoaderData, paths } from 'Router'
import { ActionButton } from './ActionButton'
import Tooltip from './Tooltip'
import { FileEntry, removeDir, removeFile } from '@tauri-apps/api/fs'
import { useEffect, useState } from 'react'
import { readProject } from 'lib/tauriFS'
import { useNavigate } from 'react-router-dom'
import { Disclosure } from '@headlessui/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight } from '@fortawesome/free-solid-svg-icons'
import { useFileContext } from 'hooks/useFileContext'

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
  const { send } = useFileContext()
  const navigate = useNavigate()
  const isCurrentFile = fileOrDir.path === currentFile?.path

  async function handleDelete(fileOrDir: FileEntry) {
    if (!fileOrDir.children) {
      await removeFile(fileOrDir.path)
    } else {
      await removeDir(fileOrDir.path, { recursive: true })
    }
  }

  return !fileOrDir.children ? (
    <li
      className={
        'group m-0 p-0 border-solid border-0 hover:bg-energy-10/50 dark:hover:bg-energy-90/50 focus-within:bg-energy-10/80 dark:focus-within:bg-energy-80/50 hover:focus-within:bg-energy-10/80 dark:hover:focus-within:bg-energy-80/50 ' +
        (isCurrentFile ? 'bg-energy-10/50 dark:bg-energy-90/50' : '')
      }
    >
      <button
        className="py-1 rounded-none border-none p-0 m-0 text-base w-full hover:!bg-transparent text-left text-energy-100 group-hover:text-energy-70 dark:text-energy-30 dark:group-hover:text-energy-20"
        style={{ paddingInline: `calc(1rem * ${level + 1})` }}
        onDoubleClick={() => {
          navigate(`${paths.FILE}/${encodeURIComponent(fileOrDir.path)}`)
          closePanel()
        }}
        onClick={(e) => e.currentTarget.focus()}
        onKeyDown={(e) => {
          console.log(e.metaKey, e.key)
          e.metaKey && e.key === 'Backspace' && handleDelete(fileOrDir)
        }}
      >
        {isCurrentFile && (
          <div className="inline-block w-2 h-2 rounded-full bg-energy-10 mr-2">
            <span className="sr-only">(current)</span>
          </div>
        )}
        {fileOrDir.name}
      </button>
    </li>
  ) : (
    <Disclosure defaultOpen={currentFile?.path.includes(fileOrDir.path)}>
      {({ open }) => (
        <div className="group">
          <Disclosure.Button
            className="group border-none text-base rounded-none p-0 m-0 flex items-center justify-start w-full py-1 text-chalkboard-70 dark:text-chalkboard-30 hover:bg-energy-10/50 dark:hover:bg-energy-90/50 group-focus-within:bg-chalkboard-20 dark:group-focus-within:bg-chalkboard-80/20 hover:group-focus-within:bg-chalkboard-20 dark:hover:group-focus-within:bg-chalkboard-80/20"
            style={{ paddingInline: `calc(1rem * ${level + 1})` }}
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
          <Disclosure.Panel>
            <ul
              className="m-0 p-0"
              onClickCapture={(e) => {
                send({ type: 'Set current directory', data: fileOrDir })
              }}
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

  async function createFile() {
    send({ type: 'Create file', data: { name: '' } })
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-1 px-4 py-1 bg-chalkboard-30/50 dark:bg-chalkboard-70/50">
        <h2 className="flex-1 m-0 p-0 text-sm mono">Files</h2>
        <ActionButton
          Element="button"
          icon={{
            icon: 'createFile',
            iconClassName: '!text-energy-80 dark:!text-energy-20',
            bgClassName: 'hover:bg-energy-10/50 dark:hover:bg-transparent',
          }}
          className="!p-0 border-none bg-transparent"
          onClick={createFile}
        >
          <Tooltip position="blockEnd" delay={750}>
            Create File
          </Tooltip>
        </ActionButton>

        <ActionButton
          Element="button"
          icon={{
            icon: 'createFolder',
            iconClassName: '!text-energy-80 dark:!text-energy-20',
            bgClassName: 'hover:bg-energy-10/50 dark:hover:bg-transparent',
          }}
          className="!p-0 border-none bg-transparent"
        >
          <Tooltip position="blockEnd" delay={750}>
            Create Folder
          </Tooltip>
        </ActionButton>
      </div>
      <ul
        className="flex-1 m-0 p-0"
        onClickCapture={(e) => {
          send({ type: 'Set current directory', data: context.project })
        }}
      >
        {context.project.children?.map((fileOrDir) => (
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
  )
}

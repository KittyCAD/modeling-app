import { IndexLoaderData, paths } from 'Router'
import { ActionButton } from './ActionButton'
import Tooltip from './Tooltip'
import { FileEntry } from '@tauri-apps/api/fs'
import { useEffect, useState } from 'react'
import { readProject } from 'lib/tauriFS'
import { Link } from 'react-router-dom'

const FileTreeItem = ({
  project,
  fileOrDir,
  closePanel,
}: {
  project?: IndexLoaderData['project']
  fileOrDir: FileEntry
  closePanel: (
    focusableElement?:
      | HTMLElement
      | React.MutableRefObject<HTMLElement | null>
      | undefined
  ) => void
}) => {
  return !fileOrDir.children ? (
    <li className="m-0 py-1 px-4 border-solid border-0">
      <Link
        to={`${paths.FILE}/${encodeURIComponent(fileOrDir.path)}`}
        className="text-energy-100 hover:text-energy-70 dark:text-energy-30 dark:hover:text-energy-20"
        onClick={() => closePanel()}
      >
        {fileOrDir.name}
      </Link>
    </li>
  ) : (
    <details className="m-0 py-1 px-4">
      <summary>{fileOrDir.name}</summary>
      <ul className="m-0 p-0">
        {fileOrDir.children.map((child) => (
          <FileTreeItem
            fileOrDir={child}
            project={project}
            closePanel={closePanel}
          />
        ))}
      </ul>
    </details>
  )
}

interface FileTreeProps {
  className?: string
  project?: IndexLoaderData['project']
  closePanel: (
    focusableElement?:
      | HTMLElement
      | React.MutableRefObject<HTMLElement | null>
      | undefined
  ) => void
}

export const FileTree = ({
  className = '',
  project,
  closePanel,
}: FileTreeProps) => {
  const [contents, setContents] = useState<FileEntry[]>([])

  useEffect(() => {
    async function getContents() {
      const contents = await readProject(project?.path || '')
      setContents(contents)
    }
    getContents()
  }, [project])

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
      <ul className="flex-1 m-0 p-0">
        {contents.map((fileOrDir) => (
          <FileTreeItem
            project={project}
            fileOrDir={fileOrDir}
            closePanel={closePanel}
          />
        ))}
      </ul>
    </div>
  )
}

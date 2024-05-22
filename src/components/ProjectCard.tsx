import { FormEvent, useEffect, useRef, useState } from 'react'
import { paths } from 'lib/paths'
import { Link } from 'react-router-dom'
import { ActionButton } from './ActionButton'
import {
  faCheck,
  faPenAlt,
  faTrashAlt,
  faX,
} from '@fortawesome/free-solid-svg-icons'
import { FILE_EXT, PROJECT_IMAGE_NAME } from 'lib/constants'
import { Dialog } from '@headlessui/react'
import { useHotkeys } from 'react-hotkeys-hook'
import Tooltip from './Tooltip'
import { join } from '@tauri-apps/api/path'
import { exists, readFile } from '@tauri-apps/plugin-fs'
import { Project } from 'wasm-lib/kcl/bindings/Project'

function ProjectCard({
  project,
  handleRenameProject,
  handleDeleteProject,
  ...props
}: {
  project: Project
  handleRenameProject: (
    e: FormEvent<HTMLFormElement>,
    f: Project
  ) => Promise<void>
  handleDeleteProject: (f: Project) => Promise<void>
}) {
  useHotkeys('esc', () => setIsEditing(false))
  const [isEditing, setIsEditing] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [numberOfFiles, setNumberOfFiles] = useState(1)
  const [numberOfFolders, setNumberOfFolders] = useState(0)
  const [imageUrl, setImageUrl] = useState('')

  let inputRef = useRef<HTMLInputElement>(null)

  function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    void handleRenameProject(e, project).then(() => setIsEditing(false))
  }

  function getDisplayedTime(dateStr: string) {
    const date = new Date(dateStr)
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    return date.getTime() < startOfToday.getTime()
      ? date.toLocaleDateString()
      : date.toLocaleTimeString()
  }

  useEffect(() => {
    async function getNumberOfFiles() {
      setNumberOfFiles(project.kcl_file_count)
      setNumberOfFolders(project.directory_count)
    }

    async function setupImageUrl() {
      const projectImagePath = await join(project.path, PROJECT_IMAGE_NAME)
      if (await exists(projectImagePath)) {
        const imageData = await readFile(projectImagePath)
        const blob = new Blob([imageData], { type: 'image/jpg' })
        const imageUrl = URL.createObjectURL(blob)
        setImageUrl(imageUrl)
      }
    }

    void getNumberOfFiles()
    void setupImageUrl()
  }, [project.kcl_file_count, project.directory_count])

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [inputRef.current])

  return (
    <li
      {...props}
      className="group relative min-h-[5em] rounded-sm border border-primary/40 dark:border-chalkboard-80 hover:!border-primary divide-y divide-primary/40 dark:divide-chalkboard-80 hover:!divide-primary"
    >
      <div className="h-36 relative grid place-content-center overflow-hidden bg-gradient-to-b from-transparent to-primary/10 rounded-t-sm">
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="w-full transition-transform group-hover:scale-105 h-full object-cover"
          />
        )}
      </div>
      {isEditing ? (
        <form onSubmit={handleSave} className="flex items-center gap-2">
          <input
            className="min-w-0 p-1 dark:bg-chalkboard-80 dark:border-chalkboard-40 focus:outline-none"
            type="text"
            id="newProjectName"
            name="newProjectName"
            autoCorrect="off"
            autoCapitalize="off"
            defaultValue={project.name}
            ref={inputRef}
          />
          <div className="flex items-center gap-1">
            <ActionButton
              Element="button"
              type="submit"
              iconStart={{
                icon: faCheck,
                size: 'sm',
                className: 'p-1',
                bgClassName: '!bg-transparent',
              }}
              className="!p-0"
            >
              <Tooltip position="left" delay={1000}>
                Rename project
              </Tooltip>
            </ActionButton>
            <ActionButton
              Element="button"
              iconStart={{
                icon: faX,
                size: 'sm',
                iconClassName: 'dark:!text-chalkboard-20',
                bgClassName: '!bg-transparent',
                className: 'p-1',
              }}
              className="!p-0"
              onClick={() => setIsEditing(false)}
            >
              <Tooltip position="left" delay={1000}>
                Cancel
              </Tooltip>
            </ActionButton>
          </div>
        </form>
      ) : (
        <>
          <div className="pb-2 flex flex-col flex-auto gap-2 rounded-b-sm">
            <Link
              className="relative z-0 p-2 flex-1 !no-underline !text-chalkboard-110 dark:!text-chalkboard-10 group-hover:!hue-rotate-0 after:content-[''] after:absolute after:inset-0"
              to={`${paths.FILE}/${encodeURIComponent(project.default_file)}`}
              data-testid="project-link"
            >
              {project.name?.replace(FILE_EXT, '')}
            </Link>
            <span className="text-chalkboard-60 text-xs">
              {numberOfFiles} file{numberOfFiles === 1 ? '' : 's'}{' '}
              {numberOfFolders > 0 &&
                `/ ${numberOfFolders} folder${
                  numberOfFolders === 1 ? '' : 's'
                }`}
            </span>
            <span className="px-2 text-chalkboard-60 text-xs">
              Edited{' '}
              {project.metadata && project.metadata?.modified
                ? getDisplayedTime(project.metadata.modified)
                : 'never'}
            </span>
          </Link>
          <div className="absolute z-10 flex items-center gap-1 opacity-0 bottom-2 right-2 group-hover:opacity-100 group-focus-within:opacity-100">
            <ActionButton
              Element="button"
              iconStart={{
                icon: faPenAlt,
                className: 'p-1',
                iconClassName: 'dark:!text-chalkboard-20',
                bgClassName: '!bg-transparent',
                size: 'xs',
              }}
              onClick={(e) => {
                e.stopPropagation()
                e.nativeEvent.stopPropagation()
                setIsEditing(true)
              }}
              className="!p-0"
            >
              <Tooltip position="left" delay={1000}>
                Rename project
              </Tooltip>
            </ActionButton>
            <ActionButton
              Element="button"
              iconStart={{
                icon: faTrashAlt,
                className: 'p-1',
                size: 'xs',
                bgClassName: '!bg-transparent',
                iconClassName: '!text-destroy-70',
              }}
              className="!p-0 hover:border-destroy-40 dark:hover:border-destroy-40"
              onClick={(e) => {
                e.stopPropagation()
                e.nativeEvent.stopPropagation()
                setIsConfirmingDelete(true)
              }}
            >
              <Tooltip position="left" delay={1000}>
                Delete project
              </Tooltip>
            </ActionButton>
          </div>
          <Dialog
            open={isConfirmingDelete}
            onClose={() => setIsConfirmingDelete(false)}
            className="relative z-50"
          >
            <div className="fixed inset-0 grid bg-chalkboard-110/80 place-content-center">
              <Dialog.Panel className="max-w-2xl p-4 border rounded bg-chalkboard-10 dark:bg-chalkboard-100 border-destroy-80">
                <Dialog.Title as="h2" className="mb-4 text-2xl font-bold">
                  Delete File
                </Dialog.Title>
                <Dialog.Description>
                  This will permanently delete "{project.name || 'this file'}".
                </Dialog.Description>

                <p className="my-4">
                  Are you sure you want to delete "{project.name || 'this file'}
                  "? This action cannot be undone.
                </p>

                <div className="flex justify-between">
                  <ActionButton
                    Element="button"
                    onClick={async () => {
                      await handleDeleteProject(project)
                      setIsConfirmingDelete(false)
                    }}
                    iconStart={{
                      icon: faTrashAlt,
                      bgClassName: 'bg-destroy-80',
                      className: 'p-1',
                      size: 'sm',
                      iconClassName: '!text-destroy-70 dark:!text-destroy-40',
                    }}
                    className="hover:border-destroy-40 dark:hover:border-destroy-40"
                  >
                    Delete
                  </ActionButton>
                  <ActionButton
                    Element="button"
                    onClick={() => setIsConfirmingDelete(false)}
                  >
                    Cancel
                  </ActionButton>
                </div>
              </Dialog.Panel>
            </div>
          </Dialog>
        </>
      )}
    </li>
  )
}

export default ProjectCard

import { FormEvent, useEffect, useRef, useState } from 'react'
import { type ProjectWithEntryPointMetadata, paths } from '../Router'
import { Link } from 'react-router-dom'
import { ActionButton } from './ActionButton'
import {
  faCheck,
  faPenAlt,
  faTrashAlt,
  faX,
} from '@fortawesome/free-solid-svg-icons'
import { FILE_EXT, getPartsCount, readProject } from '../lib/tauriFS'
import { Dialog } from '@headlessui/react'
import { useHotkeys } from 'react-hotkeys-hook'

function ProjectCard({
  project,
  handleRenameProject,
  handleDeleteProject,
  ...props
}: {
  project: ProjectWithEntryPointMetadata
  handleRenameProject: (
    e: FormEvent<HTMLFormElement>,
    f: ProjectWithEntryPointMetadata
  ) => Promise<void>
  handleDeleteProject: (f: ProjectWithEntryPointMetadata) => Promise<void>
}) {
  useHotkeys('esc', () => setIsEditing(false))
  const [isEditing, setIsEditing] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [numberOfParts, setNumberOfParts] = useState(1)
  const [numberOfFolders, setNumberOfFolders] = useState(0)

  let inputRef = useRef<HTMLInputElement>(null)

  function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    void handleRenameProject(e, project).then(() => setIsEditing(false))
  }

  function getDisplayedTime(date: Date) {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    return date.getTime() < startOfToday.getTime()
      ? date.toLocaleDateString()
      : date.toLocaleTimeString()
  }

  useEffect(() => {
    async function getNumberOfParts() {
      const { kclFileCount, kclDirCount } = getPartsCount(
        await readProject(project.path)
      )
      setNumberOfParts(kclFileCount)
      setNumberOfFolders(kclDirCount)
    }
    void getNumberOfParts()
  }, [project.path])

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [inputRef])

  return (
    <li
      {...props}
      className="group relative min-h-[5em] p-1 rounded-sm border border-chalkboard-20 dark:border-chalkboard-90 hover:border-energy-10 dark:hover:border-chalkboard-70 hover:bg-energy-10/20 dark:hover:bg-chalkboard-90"
    >
      {isEditing ? (
        <form onSubmit={handleSave} className="flex gap-2 items-center">
          <input
            className="dark:bg-chalkboard-80 dark:border-chalkboard-40 min-w-0 p-1 selection:bg-energy-10/20 focus:outline-none"
            type="text"
            id="newProjectName"
            name="newProjectName"
            autoCorrect="off"
            autoCapitalize="off"
            defaultValue={project.name}
            ref={inputRef}
          />
          <div className="flex gap-1 items-center">
            <ActionButton
              Element="button"
              type="submit"
              icon={{ icon: faCheck, size: 'sm', className: 'p-1' }}
              className="!p-0"
            ></ActionButton>
            <ActionButton
              Element="button"
              icon={{
                icon: faX,
                size: 'sm',
                iconClassName: 'dark:!text-chalkboard-20',
                className: 'p-1',
              }}
              className="!p-0"
              onClick={() => setIsEditing(false)}
            />
          </div>
        </form>
      ) : (
        <>
          <div className="p-1 flex flex-col h-full gap-2">
            <Link
              className="flex-1 text-liquid-100 after:content-[''] after:absolute after:inset-0"
              to={`${paths.FILE}/${encodeURIComponent(project.path)}`}
            >
              {project.name?.replace(FILE_EXT, '')}
            </Link>
            <span className="text-chalkboard-60 text-xs">
              {numberOfParts} part{numberOfParts === 1 ? '' : 's'}{' '}
              {numberOfFolders > 0 &&
                `/ ${numberOfFolders} folder${
                  numberOfFolders === 1 ? '' : 's'
                }`}
            </span>
            <span className="text-chalkboard-60 text-xs">
              Edited {getDisplayedTime(project.entrypointMetadata.modifiedAt)}
            </span>
            <div className="absolute z-10 bottom-2 right-2 flex gap-1 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
              <ActionButton
                Element="button"
                icon={{
                  icon: faPenAlt,
                  className: 'p-1',
                  iconClassName: 'dark:!text-chalkboard-20',
                  size: 'xs',
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  e.nativeEvent.stopPropagation()
                  setIsEditing(true)
                }}
                className="!p-0"
              />
              <ActionButton
                Element="button"
                icon={{
                  icon: faTrashAlt,
                  className: 'p-1',
                  size: 'xs',
                  bgClassName: 'bg-destroy-80',
                  iconClassName: 'text-destroy-20 dark:text-destroy-40',
                }}
                className="!p-0 hover:border-destroy-40 dark:hover:border-destroy-40"
                onClick={(e) => {
                  e.stopPropagation()
                  e.nativeEvent.stopPropagation()
                  setIsConfirmingDelete(true)
                }}
              />
            </div>
          </div>
          <Dialog
            open={isConfirmingDelete}
            onClose={() => setIsConfirmingDelete(false)}
            className="relative z-50"
          >
            <div className="fixed inset-0 bg-chalkboard-110/80 grid place-content-center">
              <Dialog.Panel className="rounded p-4 bg-chalkboard-10 dark:bg-chalkboard-100 border border-destroy-80 max-w-2xl">
                <Dialog.Title as="h2" className="text-2xl font-bold mb-4">
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
                    icon={{
                      icon: faTrashAlt,
                      bgClassName: 'bg-destroy-80',
                      className: 'p-1',
                      size: 'sm',
                      iconClassName:
                        'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10 dark:text-destroy-20 dark:group-hover:text-destroy-10 dark:hover:text-destroy-10',
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

import { FormEvent, useEffect, useState } from 'react'
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

  function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    handleRenameProject(e, project).then(() => setIsEditing(false))
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
    getNumberOfParts()
  }, [project.path])

  return (
    <li
      {...props}
      className="group relative min-h-[5em] p-1 rounded-sm border border-chalkboard-20 dark:border-chalkboard-90 hover:border-chalkboard-30 dark:hover:border-chalkboard-80"
    >
      {isEditing ? (
        <form onSubmit={handleSave} className="flex gap-2 items-center">
          <input
            className="dark:bg-chalkboard-80 dark:border-chalkboard-40 min-w-0 p-1"
            type="text"
            id="newProjectName"
            name="newProjectName"
            autoCorrect="off"
            autoCapitalize="off"
            defaultValue={project.name}
            autoFocus={true}
          />
          <div className="flex gap-1 items-center">
            <ActionButton
              Element="button"
              type="submit"
              icon={{ icon: faCheck, size: 'sm' }}
              className="!p-0"
            ></ActionButton>
            <ActionButton
              Element="button"
              icon={{ icon: faX, size: 'sm' }}
              className="!p-0"
              onClick={() => setIsEditing(false)}
            />
          </div>
        </form>
      ) : (
        <>
          <div className="p-1 flex flex-col h-full gap-2">
            <Link
              to={`${paths.FILE}/${encodeURIComponent(project.path)}`}
              className="flex-1 text-liquid-100"
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
            <div className="absolute bottom-2 right-2 flex gap-1 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
              <ActionButton
                Element="button"
                icon={{ icon: faPenAlt, size: 'sm' }}
                onClick={() => setIsEditing(true)}
                className="!p-0"
              />
              <ActionButton
                Element="button"
                icon={{
                  icon: faTrashAlt,
                  size: 'sm',
                  bgClassName: 'bg-destroy-80 hover:bg-destroy-70',
                  iconClassName:
                    'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10 dark:text-destroy-20 dark:group-hover:text-destroy-10 dark:hover:text-destroy-10',
                }}
                className="!p-0 hover:border-destroy-40 dark:hover:border-destroy-40"
                onClick={() => setIsConfirmingDelete(true)}
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

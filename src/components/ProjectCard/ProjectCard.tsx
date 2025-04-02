import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Link } from 'react-router-dom'

import { ActionButton } from '@src/components/ActionButton'
import { DeleteConfirmationDialog } from '@src/components/ProjectCard/DeleteProjectDialog'
import { ProjectCardRenameForm } from '@src/components/ProjectCard/ProjectCardRenameForm'
import Tooltip from '@src/components/Tooltip'
import { FILE_EXT, PROJECT_IMAGE_NAME } from '@src/lib/constants'
import { PATHS } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'

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
    handleRenameProject(e, project)
      .then(() => setIsEditing(false))
      .catch(reportRejection)
  }

  function getDisplayedTime(dateTimeMs: number) {
    const date = new Date(dateTimeMs)
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
      const projectImagePath = window.electron.path.join(
        project.path,
        PROJECT_IMAGE_NAME
      )
      if (await window.electron.exists(projectImagePath)) {
        const imageData = await window.electron.readFile(projectImagePath)
        const blob = new Blob([imageData], { type: 'image/png' })
        const imageUrl = URL.createObjectURL(blob)
        setImageUrl(imageUrl)
      }
    }

    void getNumberOfFiles()
    void setupImageUrl()
  }, [project.kcl_file_count, project.directory_count])

  useEffect(() => {
    if (inputRef.current && isEditing) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing, inputRef.current])

  return (
    <li
      {...props}
      className="group relative flex flex-col rounded-sm border border-primary/40 dark:border-chalkboard-80 hover:!border-primary"
    >
      <Link
        data-testid="project-link"
        to={
          project.readWriteAccess
            ? `${PATHS.FILE}/${encodeURIComponent(project.default_file)}`
            : ''
        }
        className={`flex flex-col flex-1 !no-underline !text-chalkboard-110 dark:!text-chalkboard-10 min-h-[5em] divide-y divide-primary/40 dark:divide-chalkboard-80  ${
          project.readWriteAccess
            ? 'group-hover:!divide-primary group-hover:!hue-rotate-0'
            : 'cursor-not-allowed'
        }`}
      >
        <div className="h-36 relative overflow-hidden bg-gradient-to-b from-transparent to-primary/10 rounded-t-sm">
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              className="h-full w-full transition-transform group-hover:scale-105 object-cover"
            />
          )}
        </div>
        <div className="pb-2 flex flex-col flex-grow flex-auto gap-2 rounded-b-sm">
          {isEditing ? (
            <ProjectCardRenameForm
              onSubmit={handleSave}
              className="flex items-center gap-2 p-2"
              onClick={(e) => e.stopPropagation()}
              project={project}
              onDismiss={() => setIsEditing(false)}
              ref={inputRef}
            />
          ) : (
            <h3
              className="font-sans relative z-0 p-2"
              data-testid="project-title"
            >
              {project.name?.replace(FILE_EXT, '')}
            </h3>
          )}
          {project.readWriteAccess && (
            <span className="px-2 text-chalkboard-60 text-xs">
              <span data-testid="project-file-count">{numberOfFiles}</span> file
              {numberOfFiles === 1 ? '' : 's'}{' '}
              {numberOfFolders > 0 && (
                <>
                  {'/ '}
                  <span data-testid="project-folder-count">
                    {numberOfFolders}
                  </span>{' '}
                  folder{numberOfFolders === 1 ? '' : 's'}
                </>
              )}
            </span>
          )}
          <span className="px-2 text-chalkboard-60 text-xs">
            Edited{' '}
            <span data-testid="project-edit-date">
              {project.metadata && project.metadata.modified
                ? getDisplayedTime(parseInt(project.metadata.modified))
                : 'never'}
            </span>
          </span>
        </div>
      </Link>
      {!isEditing && (
        <div
          className="absolute z-10 flex items-center gap-1 opacity-0 bottom-2 right-2 group-hover:opacity-100 group-focus-within:opacity-100"
          data-edit-buttons-for={project.name?.replace(FILE_EXT, '')}
        >
          <ActionButton
            disabled={!project.readWriteAccess}
            Element="button"
            iconStart={{
              icon: 'sketch',
              iconClassName: 'dark:!text-chalkboard-20',
              bgClassName: '!bg-transparent',
            }}
            onClick={(e) => {
              e.stopPropagation()
              e.nativeEvent.stopPropagation()
              setIsEditing(true)
            }}
            className="!p-0"
          >
            <Tooltip position="top-right">Rename project</Tooltip>
          </ActionButton>
          <ActionButton
            disabled={!project.readWriteAccess}
            Element="button"
            iconStart={{
              icon: 'trash',
              iconClassName: 'dark:!text-chalkboard-30',
              bgClassName: '!bg-transparent',
            }}
            className="!p-0"
            onClick={(e) => {
              e.stopPropagation()
              e.nativeEvent.stopPropagation()
              setIsConfirmingDelete(true)
            }}
          >
            <Tooltip position="top-right">Delete project</Tooltip>
          </ActionButton>
        </div>
      )}
      {isConfirmingDelete && (
        <DeleteConfirmationDialog
          title="Delete Project"
          onConfirm={toSync(async () => {
            await handleDeleteProject(project)
            setIsConfirmingDelete(false)
          }, reportRejection)}
          onDismiss={() => setIsConfirmingDelete(false)}
        >
          <p className="my-4">
            This will permanently delete "{project.name || 'this file'}
            ".
          </p>
          <p className="my-4">
            Are you sure you want to delete "{project.name || 'this file'}
            "? This action cannot be undone.
          </p>
        </DeleteConfirmationDialog>
      )}
    </li>
  )
}

export default ProjectCard

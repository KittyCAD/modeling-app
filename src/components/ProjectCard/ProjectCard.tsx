import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Link } from 'react-router-dom'

import { ActionButton } from '@src/components/ActionButton'
import { CloudConflictDialog } from '@src/components/CloudConflictDialog'
import { DeleteConfirmationDialog } from '@src/components/ProjectCard/DeleteProjectDialog'
import { ProjectCardRenameForm } from '@src/components/ProjectCard/ProjectCardRenameForm'
import Tooltip from '@src/components/Tooltip'
import type { ProjectStatus } from '@src/hooks/useProjectStatus'
import { FILE_EXT, PROJECT_IMAGE_NAME } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { PATHS } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'

function ProjectCard({
  project,
  projectStatus,
  handleRenameProject,
  handleDeleteProject,
  ...props
}: {
  project: Project
  projectStatus?: ProjectStatus
  handleRenameProject: (
    e: FormEvent<HTMLFormElement>,
    f: Project
  ) => Promise<void>
  handleDeleteProject: (f: Project) => Promise<void>
}) {
  useHotkeys('esc', () => setIsEditing(false))
  const [isEditing, setIsEditing] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [isInspectingConflict, setIsInspectingConflict] = useState(false)
  const hasChangesRequested =
    projectStatus?.publicationStatus === 'changes_requested'
  const hasCloudConflict = Boolean(project.cloudConflict)
  const [numberOfFiles, setNumberOfFiles] = useState(1)
  const [numberOfFolders, setNumberOfFolders] = useState(0)
  const [imageUrl, setImageUrl] = useState('')
  /** "Optimistic" in that it updates before any remote/cloud sync completes, and may be rolled back on failure to sync. */
  const [optimisticProjectName, setOptimisticProjectName] = useState<{
    projectPath: string
    name: string
    modified: number
  } | null>(null)

  let inputRef = useRef<HTMLInputElement>(null)
  const projectDisplayName = getProjectDisplayName(project)
  const displayedProject =
    optimisticProjectName?.projectPath === project.path
      ? {
          ...project,
          title: optimisticProjectName.name,
          metadata: project.metadata
            ? {
                ...project.metadata,
                modified: Math.max(
                  project.metadata.modified ?? Number.NEGATIVE_INFINITY,
                  optimisticProjectName.modified
                ),
              }
            : project.metadata,
        }
      : project

  function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const newProjectName = new FormData(e.currentTarget).get('newProjectName')

    if (
      project.cloudProjectId &&
      typeof newProjectName === 'string' &&
      newProjectName !== projectDisplayName
    ) {
      setOptimisticProjectName({
        projectPath: project.path,
        name: newProjectName,
        modified: Date.now(),
      })
    }

    handleRenameProject(e, project)
      .then(() => setIsEditing(false))
      .catch((error) => {
        setOptimisticProjectName(null)
        reportRejection(error)
      })
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
      const projectImagePath = fsZds.join(project.path, PROJECT_IMAGE_NAME)
      try {
        await fsZds.stat(projectImagePath)
        const imageData = await fsZds.readFile(projectImagePath)
        const blob = new Blob([new Uint8Array(imageData)], {
          type: 'image/png',
        })
        const imageUrl = URL.createObjectURL(blob)

        if (blob.size > 0) {
          /**
           * Off chance that a thumbnail.png is cancelled writing and ends up writing 0 bytes
           * We do not want to load a 0 byte image
           */
          setImageUrl(imageUrl)
        }
      } catch (e: unknown) {
        console.log(e)
      }
    }

    void getNumberOfFiles()
    void setupImageUrl()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [project.path, project.kcl_file_count, project.directory_count])

  useEffect(() => {
    if (inputRef.current && isEditing) {
      inputRef.current.focus()
      inputRef.current.select()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [isEditing, inputRef.current])

  useEffect(() => {
    setOptimisticProjectName((optimisticName) => {
      if (!optimisticName) {
        return null
      }
      if (
        !project.cloudProjectId ||
        optimisticName.projectPath !== project.path ||
        optimisticName.name === projectDisplayName
      ) {
        return null
      }
      return optimisticName
    })
  }, [project.cloudProjectId, project.path, projectDisplayName])

  const projectName = getProjectDisplayName(displayedProject).replace(
    FILE_EXT,
    ''
  )
  const lastOpenedAt =
    displayedProject.last_opened_at ?? displayedProject.metadata?.modified

  return (
    <li
      {...props}
      className="group relative flex flex-col rounded-sm border border-chalkboard-50 dark:border-chalkboard-80 hover:!border-primary"
    >
      <Link
        data-testid="project-link"
        onClick={(e) => {
          if (!hasCloudConflict) {
            return
          }
          e.preventDefault()
          setIsInspectingConflict(true)
        }}
        to={
          project.readWriteAccess
            ? `${PATHS.FILE}/${encodeURIComponent(project.default_file)}`
            : ''
        }
        className={`flex flex-col flex-1 !no-underline !text-chalkboard-110 dark:!text-chalkboard-10 min-h-[5em] divide-y divide-chalkboard-50 dark:divide-chalkboard-80  ${
          project.readWriteAccess
            ? 'group-hover:!divide-primary group-hover:!hue-rotate-0'
            : 'cursor-not-allowed'
        }`}
      >
        <div className="h-36 relative overflow-hidden bg-gradient-to-b from-transparent to-primary/10 rounded-t-sm">
          {hasCloudConflict && (
            <span
              className="absolute top-2 left-2 z-10 rounded bg-warn-20 px-1.5 py-0.5 text-[10px] font-medium text-warn-90 dark:bg-warn-80 dark:text-warn-10 pointer-events-none"
              data-testid="cloud-conflict-badge"
            >
              Inspect Conflicts
            </span>
          )}
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              className="h-full w-full transition-transform group-hover:scale-105 object-cover"
            />
          )}
          {hasChangesRequested && (
            <span
              className={`absolute ${
                hasCloudConflict ? 'top-8' : 'top-2'
              } left-2 z-10 rounded bg-warn-20 px-1.5 py-0.5 text-[10px] font-medium text-warn-80 dark:bg-warn-80 dark:text-warn-10 pointer-events-none`}
              data-testid="changes-requested-badge"
            >
              Changes requested
            </span>
          )}
        </div>
        <div className="pb-2 flex flex-col flex-grow flex-auto gap-2 rounded-b-sm">
          {isEditing ? (
            <ProjectCardRenameForm
              onSubmit={handleSave}
              className="flex items-center gap-2 p-2"
              onClick={(e) => e.stopPropagation()}
              project={displayedProject}
              onDismiss={() => setIsEditing(false)}
              ref={inputRef}
            />
          ) : (
            <h3
              className="font-sans relative z-0 p-2 truncate"
              data-testid="project-title"
              title={projectName}
            >
              {projectName}
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
            Opened{' '}
            <span data-testid="project-edit-date">
              {lastOpenedAt ? getDisplayedTime(lastOpenedAt) : 'never'}
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
          <p className="my-4 text-wrap break-words">
            This will permanently delete "{projectName || 'this file'}
            ".
          </p>
          <p className="my-4 text-wrap break-words">
            Are you sure you want to delete "{projectName || 'this file'}
            "? This action cannot be undone.
          </p>
        </DeleteConfirmationDialog>
      )}
      {isInspectingConflict && (
        <CloudConflictDialog
          projectPath={project.path}
          projectName={projectName}
          onDismiss={() => setIsInspectingConflict(false)}
          onResolved={() => setIsInspectingConflict(false)}
        />
      )}
    </li>
  )
}

export default ProjectCard

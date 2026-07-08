import { ProjectCard as UiProjectCard } from '@kittycad/ui-components'
import type { FormEvent, HTMLAttributes } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Link } from 'react-router-dom'

import { ActionButton } from '@src/components/ActionButton'
import { CloudConflictDialog } from '@src/components/CloudConflictDialog'
import { DeleteConfirmationDialog } from '@src/components/DeleteProjectDialog'
import { ProjectCardRenameForm } from '@src/components/AppProjectCard/ProjectCardRenameForm'
import Tooltip from '@src/components/Tooltip'
import type { ProjectStatus } from '@src/hooks/useProjectStatus'
import { FILE_EXT, PROJECT_IMAGE_NAME } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { PATHS } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'

type AppProjectCardProps = HTMLAttributes<HTMLLIElement> & {
  project: Project
  projectStatus?: ProjectStatus
  handleRenameProject: (
    e: FormEvent<HTMLFormElement>,
    f: Project
  ) => Promise<void>
  handleDeleteProject: (f: Project) => Promise<void>
}

function getDisplayedTime(dateTimeMs: number) {
  const date = new Date(dateTimeMs)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  return date.getTime() < startOfToday.getTime()
    ? date.toLocaleDateString()
    : date.toLocaleTimeString()
}

function useProjectThumbnailUrl(project: Project) {
  const [imageUrl, setImageUrl] = useState('')

  useEffect(() => {
    let disposed = false
    let createdImageUrl: string | undefined

    async function setupImageUrl() {
      const projectImagePath = fsZds.join(project.path, PROJECT_IMAGE_NAME)
      try {
        await fsZds.stat(projectImagePath)
        const imageData = await fsZds.readFile(projectImagePath)
        const blob = new Blob([new Uint8Array(imageData)], {
          type: 'image/png',
        })

        if (blob.size === 0) {
          return
        }

        createdImageUrl = URL.createObjectURL(blob)
        if (disposed) {
          URL.revokeObjectURL(createdImageUrl)
          return
        }
        setImageUrl(createdImageUrl)
      } catch (e: unknown) {
        console.log(e)
      }
    }

    setImageUrl('')
    void setupImageUrl()

    return () => {
      disposed = true
      if (createdImageUrl) {
        URL.revokeObjectURL(createdImageUrl)
      }
    }
  }, [project.path, project.kcl_file_count, project.directory_count])

  return imageUrl
}

function AppProjectCard({
  project,
  projectStatus,
  handleRenameProject,
  handleDeleteProject,
  ...props
}: AppProjectCardProps) {
  useHotkeys('esc', () => setIsEditing(false))
  const [isEditing, setIsEditing] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [isInspectingConflict, setIsInspectingConflict] = useState(false)
  const hasChangesRequested =
    projectStatus?.publicationStatus === 'changes_requested'
  const hasCloudConflict = Boolean(project.cloudConflict)
  const imageUrl = useProjectThumbnailUrl(project)
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

  const badges = (hasCloudConflict || hasChangesRequested) && (
    <>
      {hasCloudConflict && (
        <span
          className="rounded bg-warn-20 px-1.5 py-0.5 text-[10px] font-medium text-warn-90 dark:bg-warn-80 dark:text-warn-10"
          data-testid="cloud-conflict-badge"
        >
          Inspect Conflicts
        </span>
      )}
      {hasChangesRequested && (
        <span
          className="rounded bg-warn-20 px-1.5 py-0.5 text-[10px] font-medium text-warn-80 dark:bg-warn-80 dark:text-warn-10"
          data-testid="changes-requested-badge"
        >
          Changes requested
        </span>
      )}
    </>
  )

  const details = (
    <>
      {project.readWriteAccess && (
        <span className="px-2 text-chalkboard-60 text-xs">
          <span data-testid="project-file-count">{project.kcl_file_count}</span>{' '}
          file{project.kcl_file_count === 1 ? '' : 's'}{' '}
          {project.directory_count > 0 && (
            <>
              {'/ '}
              <span data-testid="project-folder-count">
                {project.directory_count}
              </span>{' '}
              folder{project.directory_count === 1 ? '' : 's'}
            </>
          )}
        </span>
      )}
      <span className="px-2 text-chalkboard-60 text-xs">
        Edited{' '}
        <span data-testid="project-edit-date">
          {displayedProject.metadata?.modified
            ? getDisplayedTime(displayedProject.metadata.modified)
            : 'never'}
        </span>
      </span>
    </>
  )

  const actions = (
    <>
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
    </>
  )

  const dialogs = (
    <>
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
    </>
  )

  return (
    <UiProjectCard
      {...props}
      title={projectName}
      titleText={projectName}
      canOpen={project.readWriteAccess}
      isEditing={isEditing}
      thumbnailUrl={imageUrl}
      badges={badges}
      details={details}
      actions={actions}
      actionsLabel={project.name?.replace(FILE_EXT, '')}
      renameForm={
        <ProjectCardRenameForm
          onSubmit={handleSave}
          className="flex items-center gap-2 p-2"
          onClick={(e) => e.stopPropagation()}
          project={displayedProject}
          onDismiss={() => setIsEditing(false)}
          ref={inputRef}
        />
      }
      dialogs={dialogs}
      onOpen={(e) => {
        if (!hasCloudConflict) {
          return
        }
        e.preventDefault()
        setIsInspectingConflict(true)
      }}
      renderOpenLink={({ href: _href, ...linkProps }) => (
        <Link
          {...linkProps}
          to={
            project.readWriteAccess
              ? `${PATHS.FILE}/${encodeURIComponent(project.default_file)}`
              : ''
          }
        />
      )}
    />
  )
}

export default AppProjectCard

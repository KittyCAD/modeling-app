import { ProjectCard as UiProjectCard } from '@kittycad/ui-components'
import type { FormEvent, HTMLAttributes } from 'react'
import { toast } from 'react-hot-toast'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Link, useNavigate } from 'react-router-dom'

import { ActionButton } from '@src/components/ActionButton'
import { CloudConflictDialog } from '@src/components/CloudConflictDialog'
import { DeleteConfirmationDialog } from '@src/components/DeleteProjectDialog'
import { ProjectCardRenameForm } from '@src/components/AppProjectCard/ProjectCardRenameForm'
import Tooltip from '@src/components/Tooltip'
import type { ProjectStatus } from '@src/hooks/useProjectStatus'
import { FILE_EXT } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { getHomeProjectDisplayName } from '@src/lib/homeProjects'
import { PATHS } from '@src/lib/paths'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
  HomeProjectThumbnail,
} from '@src/registry/contracts/homeProjects'

type AppProjectCardProps = HTMLAttributes<HTMLLIElement> & {
  project: HomeProjectEntry
  projectActions: HomeProjectActionsService
  projectStatus?: ProjectStatus
}

const homeProjectStatusBadgeLabels: Record<HomeProjectEntry['status'], string> =
  {
    local: 'Local',
    'cloud-only': 'Cloud-only',
    syncing: 'Syncing',
    synced: 'Synced',
    conflicted: 'Conflicted',
  }

function getDisplayedTime(dateTimeMs: number) {
  const date = new Date(dateTimeMs)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  return date.getTime() < startOfToday.getTime()
    ? date.toLocaleDateString()
    : date.toLocaleTimeString()
}

function useProjectThumbnailUrl(thumbnail: HomeProjectThumbnail | undefined) {
  const [imageUrl, setImageUrl] = useState('')

  useEffect(() => {
    if (!thumbnail) {
      setImageUrl('')
      return
    }

    if (thumbnail.type === 'remote') {
      setImageUrl(thumbnail.url)
      return
    }

    const localThumbnail = thumbnail
    let disposed = false
    let createdImageUrl: string | undefined

    async function setupImageUrl() {
      try {
        await fsZds.stat(localThumbnail.path)
        const imageData = await fsZds.readFile(localThumbnail.path)
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
  }, [thumbnail])

  return imageUrl
}

function AppProjectCard({
  project,
  projectActions,
  projectStatus,
  ...props
}: AppProjectCardProps) {
  const navigate = useNavigate()
  useHotkeys('esc', () => setIsEditing(false))
  const [isEditing, setIsEditing] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [isInspectingConflict, setIsInspectingConflict] = useState(false)
  const hasChangesRequested =
    projectStatus?.publicationStatus === 'changes_requested'
  const hasCloudConflict = Boolean(project.conflict && project.localProjectPath)
  const imageUrl = useProjectThumbnailUrl(project.thumbnail)
  /** "Optimistic" in that it updates before any remote/cloud sync completes, and may be rolled back on failure to sync. */
  const [optimisticProjectName, setOptimisticProjectName] = useState<{
    projectId: string
    name: string
    modified: number
  } | null>(null)

  let inputRef = useRef<HTMLInputElement>(null)
  const projectDisplayName = getHomeProjectDisplayName(project)
  const displayedProject =
    optimisticProjectName?.projectId === project.id
      ? {
          ...project,
          title: optimisticProjectName.name,
          modified: Math.max(
            project.modified ?? Number.NEGATIVE_INFINITY,
            optimisticProjectName.modified
          ),
        }
      : project

  function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const newProjectName = new FormData(e.currentTarget).get('newProjectName')

    if (
      !project.remoteProjectId &&
      typeof newProjectName === 'string' &&
      newProjectName.startsWith('.')
    ) {
      toast.error('Project names cannot start with a period.')
      return
    }

    if (
      project.remoteProjectId &&
      typeof newProjectName === 'string' &&
      newProjectName !== projectDisplayName
    ) {
      setOptimisticProjectName({
        projectId: project.id,
        name: newProjectName,
        modified: Date.now(),
      })
    }

    projectActions
      .rename(project, String(newProjectName))
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
        !project.remoteProjectId ||
        optimisticName.projectId !== project.id ||
        optimisticName.name === projectDisplayName
      ) {
        return null
      }
      return optimisticName
    })
  }, [project.remoteProjectId, project.id, projectDisplayName])

  const projectName = getHomeProjectDisplayName(displayedProject)
  const canRename = projectActions.canRename(project)
  const canDelete = projectActions.canDelete(project)
  const canOpen = projectActions.canOpen(project) || hasCloudConflict
  const openHref =
    project.readWriteAccess && project.defaultFile
      ? `${PATHS.FILE}/${encodeURIComponent(project.defaultFile)}`
      : ''
  const statusBadgeLabel =
    project.source === 'merged'
      ? undefined
      : homeProjectStatusBadgeLabels[project.status]

  const badges = (hasCloudConflict || hasChangesRequested) && (
    <>
      {statusBadgeLabel && (
        <span
          className="absolute top-2 right-2 z-10 rounded bg-chalkboard-20 px-1.5 py-0.5 text-[10px] font-medium text-chalkboard-90 dark:bg-chalkboard-80 dark:text-chalkboard-10 pointer-events-none"
          data-testid="project-status-badge"
        >
          {statusBadgeLabel}
        </span>
      )}
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
      {project.kclFileCount !== undefined && (
        <span className="px-2 text-chalkboard-60 text-xs">
          <span data-testid="project-file-count">{project.kclFileCount}</span>{' '}
          file{project.kclFileCount === 1 ? '' : 's'}{' '}
          {(project.directoryCount ?? 0) > 0 && (
            <>
              {'/ '}
              <span data-testid="project-folder-count">
                {project.directoryCount}
              </span>{' '}
              folder{project.directoryCount === 1 ? '' : 's'}
            </>
          )}
        </span>
      )}
      <span className="px-2 text-chalkboard-60 text-xs">
        Edited{' '}
        <span data-testid="project-edit-date">
          {displayedProject.modified
            ? getDisplayedTime(displayedProject.modified)
            : 'never'}
        </span>
      </span>
    </>
  )

  const actions = (
    <>
      <ActionButton
        disabled={!canRename}
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
        disabled={!canDelete}
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
            await projectActions.delete(project)
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
      {isInspectingConflict && project.localProjectPath && (
        <CloudConflictDialog
          projectPath={project.localProjectPath}
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
      canOpen={canOpen}
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
          projectName={projectName}
          onDismiss={() => setIsEditing(false)}
          ref={inputRef}
        />
      }
      dialogs={dialogs}
      onOpen={(e) => {
        e.preventDefault()
        if (!canOpen) {
          return
        }
        if (hasCloudConflict) {
          setIsInspectingConflict(true)
          return
        }

        void projectActions
          .open(project)
          .then((result) => {
            if (result?.defaultFile) {
              void navigate(
                `${PATHS.FILE}/${encodeURIComponent(result.defaultFile)}`
              )
            }
          })
          .catch(reportRejection)
      }}
      renderOpenLink={({ href: _href, ...linkProps }) => (
        <Link {...linkProps} to={openHref} />
      )}
    />
  )
}

export default AppProjectCard

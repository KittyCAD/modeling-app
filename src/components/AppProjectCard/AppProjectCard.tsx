import { ProjectCard as UiProjectCard } from '@kittycad/ui-components'
import { ProjectCardRenameForm } from '@src/components/AppProjectCard/ProjectCardRenameForm'
import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import { DeleteConfirmationDialog } from '@src/components/DeleteProjectDialog'
import type { ProjectStatus } from '@src/hooks/useProjectStatus'
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
import type { FormEvent, HTMLAttributes } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Link, useNavigate } from 'react-router-dom'

type AppProjectCardProps = HTMLAttributes<HTMLLIElement> & {
  project: HomeProjectEntry
  projectActions: HomeProjectActionsService
  projectStatus?: ProjectStatus
  showCloudSyncUi?: boolean
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
  const thumbnailType = thumbnail?.type
  const localThumbnailPath =
    thumbnail?.type === 'local' ? thumbnail.path : undefined
  const remoteThumbnailUrl =
    thumbnail?.type === 'remote' ? thumbnail.url : undefined

  useEffect(() => {
    if (!thumbnailType) {
      setImageUrl('')
      return
    }

    if (thumbnailType === 'remote') {
      setImageUrl(remoteThumbnailUrl ?? '')
      return
    }

    if (!localThumbnailPath) {
      setImageUrl('')
      return
    }

    const thumbnailPath = localThumbnailPath
    let disposed = false
    let createdImageUrl: string | undefined

    async function setupImageUrl() {
      try {
        await fsZds.stat(thumbnailPath)
        const imageData = await fsZds.readFile(thumbnailPath)
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
  }, [localThumbnailPath, remoteThumbnailUrl, thumbnailType])

  return imageUrl
}

function AppProjectCard({
  project,
  projectActions,
  projectStatus,
  showCloudSyncUi = true,
  ...props
}: AppProjectCardProps) {
  const navigate = useNavigate()
  useHotkeys('esc', () => setIsEditing(false))
  const [isEditing, setIsEditing] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const hasChangesRequested =
    projectStatus?.publicationStatus === 'changes_requested'
  const hasCloudConflict = Boolean(
    showCloudSyncUi && project.conflict && project.localProjectPath
  )
  const imageUrl = useProjectThumbnailUrl(project.thumbnail)
  /** "Optimistic" in that it updates before any remote/cloud sync completes, and may be rolled back on failure to sync. */
  const [optimisticProjectName, setOptimisticProjectName] = useState<{
    projectId: string
    name: string
    modified: number
  } | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
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
    if (!isEditing) {
      return
    }

    // Context menu actions run before the Headless UI dialog finishes closing.
    // Select after that focus restoration so project rename behaves like the
    // old hover action buttons.
    const timeout = window.setTimeout(() => {
      if (!inputRef.current) {
        return
      }

      inputRef.current.focus()
      inputRef.current.select()
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [isEditing])

  useEffect(() => {
    setOptimisticProjectName((optimisticName) => {
      if (!optimisticName) {
        return null
      }
      if (
        optimisticName.projectId !== project.id ||
        optimisticName.name === projectDisplayName
      ) {
        return null
      }
      return optimisticName
    })
  }, [project.id, projectDisplayName])

  const projectName = getHomeProjectDisplayName(displayedProject)
  const canRename = projectActions.canRename(project)
  const canDelete = projectActions.canDelete(project)
  const canOpen = projectActions.canOpen(project)
  const openHref =
    project.readWriteAccess && project.defaultFile
      ? `${PATHS.FILE}/${encodeURIComponent(project.defaultFile)}`
      : ''
  const statusBadgeLabel =
    !showCloudSyncUi || project.source === 'both'
      ? undefined
      : homeProjectStatusBadgeLabels[project.status]

  const badges = (statusBadgeLabel ||
    hasCloudConflict ||
    hasChangesRequested) && (
    <>
      {statusBadgeLabel && (
        <span
          className="rounded bg-chalkboard-20 px-1.5 py-0.5 text-[10px] font-medium text-chalkboard-90 dark:bg-chalkboard-80 dark:text-chalkboard-10"
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
          Cloud conflict
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
      renderContextMenu={({ menuTargetElement }) => (
        <ContextMenu
          menuTargetElement={menuTargetElement}
          items={[
            <ContextMenuItem
              key="rename"
              icon="sketch"
              disabled={!canRename}
              data-testid="project-card-context-rename"
              onClick={() => setIsEditing(true)}
            >
              Rename project
            </ContextMenuItem>,
            <ContextMenuItem
              key="delete"
              icon="trash"
              disabled={!canDelete}
              data-testid="project-card-context-delete"
              onClick={() => setIsConfirmingDelete(true)}
            >
              Delete project
            </ContextMenuItem>,
          ]}
        />
      )}
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

import AppProjectCard from '@src/components/AppProjectCard/AppProjectCard'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import type { ProjectStatus } from '@src/hooks/useProjectStatus'
import { PATHS } from '@src/lib/paths'
import {
  getProjectLibrarySummaryDescription,
  getProjectLibrarySummaryTooltip,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'
import { getProjectLibraryIconName } from '@src/routes/projectLibraryIcons'
import type { HTMLProps } from 'react'
import { Link } from 'react-router-dom'

const PROJECT_LIBRARY_PREVIEW_LIMIT = 6

export type ProjectCardDragProps = Pick<
  HTMLProps<HTMLLIElement>,
  'draggable' | 'onDragStart' | 'onDragEnd'
>

export type ProjectLibraryDropTargetProps = Pick<
  HTMLProps<HTMLElement>,
  'onDragOver' | 'onDragLeave' | 'onDrop'
>

export interface ProjectLibraryDragController {
  getProjectCardDragProps: (project: HomeProjectEntry) => ProjectCardDragProps
  getLibraryDropTargetProps: (
    library: ProjectLibrary
  ) => ProjectLibraryDropTargetProps
  isLibraryDragOver: (library: ProjectLibrary) => boolean
}

interface ProjectLibraryPreviewRowProps {
  library: ProjectLibrary
  projects: HomeProjectEntry[]
  query: string
  projectStatuses: Map<string, ProjectStatus>
  projectActions: HomeProjectActionsService
  showCloudSyncUi: boolean
  onMoveToLibrary: (project: HomeProjectEntry) => void
  projectLibraryDrag?: ProjectLibraryDragController
}

function getProjectLibraryRoute(library: ProjectLibrary) {
  return `${PATHS.LIBRARY}/${encodeURIComponent(library.id)}`
}

function projectCountLabel(count: number) {
  return `${count} project${count === 1 ? '' : 's'}`
}

export function ProjectLibraryPreviewRow({
  library,
  projects,
  query,
  projectStatuses,
  projectActions,
  showCloudSyncUi,
  onMoveToLibrary,
  projectLibraryDrag,
}: ProjectLibraryPreviewRowProps) {
  const previewProjects =
    query.length > 0
      ? projects
      : projects.slice(0, PROJECT_LIBRARY_PREVIEW_LIMIT)
  const libraryDropTargetProps =
    projectLibraryDrag?.getLibraryDropTargetProps(library)
  const isActiveDropTarget =
    projectLibraryDrag?.isLibraryDragOver(library) ?? false
  const sectionClassName = `mx-1 flex flex-col gap-3 rounded-sm border p-2 transition-colors ${
    isActiveDropTarget
      ? 'border-primary bg-primary/5 ring-2 ring-primary/30 dark:bg-primary/10'
      : 'border-transparent'
  }`

  return (
    <section
      className={sectionClassName}
      data-testid="project-library-drop-target"
      aria-label={`${library.title} library`}
      {...libraryDropTargetProps}
    >
      <Link
        to={getProjectLibraryRoute(library)}
        className="group flex items-center gap-3 rounded-sm border border-transparent p-1 !no-underline hover:border-primary/30 hover:bg-primary/5"
        data-testid="project-library-link"
      >
        <div className="grid h-8 w-8 flex-none place-content-center rounded-sm bg-primary/10 text-primary dark:bg-chalkboard-90 dark:text-chalkboard-20">
          <CustomIcon
            name={getProjectLibraryIconName(library)}
            className="h-5 w-5"
          />
          <Tooltip position="right" contentClassName="max-w-xs text-xs">
            {getProjectLibrarySummaryTooltip(library)}
          </Tooltip>
        </div>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-chalkboard-100 dark:text-chalkboard-10">
            {library.title}
          </span>
          <span
            className="block truncate text-xs text-chalkboard-70 dark:text-chalkboard-30"
            data-testid="project-library-summary-description"
          >
            {getProjectLibrarySummaryDescription(library)}
          </span>
        </span>
        <span className="hidden flex-none text-xs text-chalkboard-70 dark:text-chalkboard-30 sm:block">
          {projectCountLabel(projects.length)}
        </span>
        <CustomIcon
          name="arrowRight"
          className="h-5 w-5 flex-none text-chalkboard-60 group-hover:text-primary"
        />
      </Link>
      {previewProjects.length > 0 ? (
        <ProjectCardList
          projects={previewProjects}
          projectStatuses={projectStatuses}
          projectActions={projectActions}
          showCloudSyncUi={showCloudSyncUi}
          showSourceStatusBadges={false}
          onMoveToLibrary={onMoveToLibrary}
          projectLibraryDrag={projectLibraryDrag}
          density="compact"
          className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
        />
      ) : (
        <p
          className="rounded-sm border border-dashed border-chalkboard-30 p-4 text-sm text-chalkboard-70 dark:border-chalkboard-70 dark:text-chalkboard-30"
          data-testid="project-library-empty"
        >
          No projects
        </p>
      )}
    </section>
  )
}

interface ProjectCardListProps {
  projects: HomeProjectEntry[]
  projectStatuses: Map<string, ProjectStatus>
  projectActions: HomeProjectActionsService
  showCloudSyncUi: boolean
  onMoveToLibrary: (project: HomeProjectEntry) => void
  projectLibraryDrag?: ProjectLibraryDragController
  density?: 'default' | 'compact'
  showDetails?: boolean
  showSourceStatusBadges?: boolean
  className?: string
}

export function ProjectCardList({
  projects,
  projectStatuses,
  projectActions,
  showCloudSyncUi,
  onMoveToLibrary,
  projectLibraryDrag,
  density = 'default',
  showDetails = true,
  showSourceStatusBadges = true,
  className = 'grid w-full sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4',
}: ProjectCardListProps) {
  return (
    <ul className={className}>
      {projects.map((project) => {
        const projectDragProps =
          projectLibraryDrag?.getProjectCardDragProps(project)

        return (
          <AppProjectCard
            key={project.id}
            project={project}
            projectActions={projectActions}
            projectStatus={
              project.remoteProjectId
                ? projectStatuses.get(project.remoteProjectId)
                : undefined
            }
            density={density}
            showDetails={showDetails}
            showCloudSyncUi={showCloudSyncUi}
            showSourceStatusBadges={showSourceStatusBadges}
            onMoveToLibrary={onMoveToLibrary}
            {...projectDragProps}
          />
        )
      })}
    </ul>
  )
}

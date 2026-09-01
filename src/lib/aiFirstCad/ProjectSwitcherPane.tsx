import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel } from '@src/components/layout/Panel'
import { useProjectThumbnailUrl } from '@src/hooks/useProjectThumbnailUrl'
import { CleanPaneHeader } from '@src/components/layout/Panel/CleanPaneHeader'
import { useApp, useSingletons } from '@src/lib/boot'
import { homeProjectThumbnailFromProject } from '@src/lib/homeProjects'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { PATHS } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { getSortFunction } from '@src/lib/sorting'
import { useFolders } from '@src/machines/systemIO/hooks'
import {
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import { useSelector } from '@xstate/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const PROJECT_THUMBNAIL_MIN_WIDTH = 240

function ProjectThumbnail({ project }: { project: Project }) {
  const displayName = getProjectDisplayName(project)
  const imageUrl = useProjectThumbnailUrl(
    homeProjectThumbnailFromProject(project)
  )

  return (
    <span className="h-14 w-20 flex-none overflow-hidden rounded border border-chalkboard-30 bg-gradient-to-br from-chalkboard-20 to-chalkboard-30 dark:border-chalkboard-70 dark:from-chalkboard-90 dark:to-chalkboard-100">
      {imageUrl ? (
        <img
          alt={`Preview of ${displayName}`}
          className="h-full w-full object-cover"
          loading="lazy"
          src={imageUrl}
        />
      ) : null}
    </span>
  )
}

export function ProjectSwitcherPane(props: AreaTypeComponentProps) {
  const { commands, project, systemIOActor } = useApp()
  const { kclManager } = useSingletons()
  const projects = useFolders()
  const navigate = useNavigate()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showProjectThumbnails, setShowProjectThumbnails] = useState(false)
  const projectListRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const systemIOState = useSelector(systemIOActor, (snapshot) => snapshot.value)
  const activeProjectPath = project?.projectIORefSignal.value.path

  useEffect(() => {
    if (
      projects === undefined &&
      systemIOState === SystemIOMachineStates.idle
    ) {
      systemIOActor.send({
        type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
      })
    }
  }, [projects, systemIOActor, systemIOState])

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus()
    }
  }, [isSearchOpen])

  useEffect(() => {
    const projectList = projectListRef.current
    if (!projectList) {
      return
    }

    const updateThumbnailVisibility = (width: number) => {
      setShowProjectThumbnails(width >= PROJECT_THUMBNAIL_MIN_WIDTH)
    }

    updateThumbnailVisibility(projectList.getBoundingClientRect().width)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        updateThumbnailVisibility(entry.contentRect.width)
      }
    })
    observer.observe(projectList)

    return () => observer.disconnect()
  }, [])

  const matchingProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return (projects ?? [])
      .filter((candidate) =>
        getProjectDisplayName(candidate)
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
      .sort(getSortFunction('modified:desc'))
  }, [projects, query])

  return (
    <LayoutPanel
      className="ai-scroll-separator h-full min-h-0 overflow-hidden border-none dark:!bg-[#181818]"
      id={`${props.layout.id}-pane`}
      title={props.layout.label}
    >
      <CleanPaneHeader title="Projects">
        <button
          aria-label={isSearchOpen ? 'Close project search' : 'Search projects'}
          aria-pressed={isSearchOpen}
          className="grid h-7 w-7 place-content-center rounded border border-transparent p-0 text-chalkboard-70 hover:border-chalkboard-30 hover:bg-chalkboard-20 hover:text-chalkboard-100 dark:text-chalkboard-30 dark:hover:border-chalkboard-70 dark:hover:bg-chalkboard-90 dark:hover:text-chalkboard-10"
          onClick={() => {
            if (isSearchOpen) {
              setQuery('')
            }
            setIsSearchOpen((isOpen) => !isOpen)
          }}
          title={isSearchOpen ? 'Close project search' : 'Search projects'}
          type="button"
        >
          <CustomIcon className="h-4 w-4" name="search" />
        </button>
        <button
          aria-label="New project"
          className="grid h-7 w-7 place-content-center rounded border border-transparent p-0 text-chalkboard-70 hover:border-chalkboard-30 hover:bg-chalkboard-20 hover:text-chalkboard-100 dark:text-chalkboard-30 dark:hover:border-chalkboard-70 dark:hover:bg-chalkboard-90 dark:hover:text-chalkboard-10"
          onClick={() =>
            commands.send({
              type: 'Find and select command',
              data: {
                groupId: 'projects',
                name: 'Create project',
              },
            })
          }
          title="New project"
          type="button"
        >
          <CustomIcon className="h-4 w-4" name="plus" />
        </button>
      </CleanPaneHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden py-2 pl-2">
        {isSearchOpen ? (
          <>
            <label className="sr-only" htmlFor="ai-project-search">
              Search projects
            </label>
            <input
              className="mr-2 w-[calc(100%-0.5rem)] rounded-md border border-chalkboard-30 bg-chalkboard-10 px-3 py-2 text-sm dark:border-chalkboard-70 dark:bg-chalkboard-90"
              id="ai-project-search"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search projects"
              ref={searchInputRef}
              type="search"
              value={query}
            />
          </>
        ) : null}
        <div
          className="min-h-0 flex-1 space-y-1 overflow-x-hidden overflow-y-scroll pr-2"
          data-testid="ai-project-list-scroll"
          ref={projectListRef}
        >
          {matchingProjects.map((candidate) => {
            const isActive = candidate.path === activeProjectPath
            return (
              <button
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-w-0 items-center gap-2 overflow-hidden rounded-md border px-2 py-2 text-left text-sm ${
                  isActive
                    ? 'border-primary bg-primary/10 text-primary dark:border-primary'
                    : 'border-transparent bg-transparent hover:border-chalkboard-30 hover:bg-chalkboard-20 dark:border-transparent dark:hover:border-chalkboard-70 dark:hover:bg-chalkboard-100'
                }`}
                key={candidate.path}
                onClick={() => {
                  kclManager.switchedFiles = true
                  void navigate(
                    `${PATHS.FILE}/${encodeURIComponent(candidate.default_file || candidate.path)}`
                  )
                }}
                type="button"
              >
                {showProjectThumbnails ? (
                  <ProjectThumbnail project={candidate} />
                ) : null}
                <span className="line-clamp-3 min-w-0 flex-1 break-words leading-5">
                  {getProjectDisplayName(candidate)}
                </span>
                {isActive ? (
                  <span className="h-2 w-2 flex-none rounded-full bg-primary" />
                ) : null}
              </button>
            )
          })}
          {projects !== undefined && matchingProjects.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-chalkboard-60 dark:text-chalkboard-40">
              No matching projects
            </p>
          ) : null}
        </div>
      </div>
    </LayoutPanel>
  )
}

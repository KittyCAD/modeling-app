import { FormEvent, useEffect, useRef, useState } from 'react'
import {
  getNextProjectIndex,
  interpolateProjectNameWithIndex,
  doesProjectNameNeedInterpolated,
} from 'lib/desktopFS'
import { ActionButton } from 'components/ActionButton'
import { toast } from 'react-hot-toast'
import { AppHeader } from 'components/AppHeader'
import ProjectCard from 'components/ProjectCard/ProjectCard'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import Loading from 'components/Loading'
import { useMachine } from '@xstate/react'
import { homeMachine } from '../machines/homeMachine'
import { fromPromise } from 'xstate'
import { PATHS } from 'lib/paths'
import {
  getNextSearchParams,
  getSortFunction,
  getSortIcon,
} from '../lib/sorting'
import useStateMachineCommands from '../hooks/useStateMachineCommands'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { homeCommandBarConfig } from 'lib/commandBarConfigs/homeCommandConfig'
import { useHotkeys } from 'react-hotkeys-hook'
import { isDesktop } from 'lib/isDesktop'
import { kclManager } from 'lib/singletons'
import { useLspContext } from 'components/LspProvider'
import { useRefreshSettings } from 'hooks/useRefreshSettings'
import { LowerRightControls } from 'components/LowerRightControls'
import {
  createNewProjectDirectory,
  listProjects,
  renameProjectDirectory,
} from 'lib/desktop'
import { ProjectSearchBar, useProjectSearch } from 'components/ProjectSearchBar'
import { Project } from 'lib/project'
import { useFileSystemWatcher } from 'hooks/useFileSystemWatcher'
import { useProjectsLoader } from 'hooks/useProjectsLoader'

// This route only opens in the desktop context for now,
// as defined in Router.tsx, so we can use the desktop APIs and types.
const Home = () => {
  const [projectsLoaderTrigger, setProjectsLoaderTrigger] = useState(0)
  const { projectPaths, projectsDir } = useProjectsLoader([
    projectsLoaderTrigger,
  ])

  useRefreshSettings(PATHS.HOME + 'SETTINGS')
  const { commandBarSend } = useCommandsContext()
  const navigate = useNavigate()
  const {
    settings: { context: settings },
  } = useSettingsAuthContext()
  const { onProjectOpen } = useLspContext()

  // Cancel all KCL executions while on the home page
  useEffect(() => {
    kclManager.cancelAllExecutions()
  }, [])

  useHotkeys('backspace', (e) => {
    e.preventDefault()
  })
  useHotkeys(
    isDesktop() ? 'mod+,' : 'shift+mod+,',
    () => navigate(PATHS.HOME + PATHS.SETTINGS),
    {
      splitKey: '|',
    }
  )
  const ref = useRef<HTMLDivElement>(null)

  const [state, send, actor] = useMachine(
    homeMachine.provide({
      actions: {
        navigateToProject: ({ context, event }) => {
          if ('data' in event && event.data && 'name' in event.data) {
            let projectPath =
              context.defaultDirectory +
              window.electron.path.sep +
              event.data.name
            onProjectOpen(
              {
                name: event.data.name,
                path: projectPath,
              },
              null
            )
            commandBarSend({ type: 'Close' })
            navigate(`${PATHS.FILE}/${encodeURIComponent(projectPath)}`)
          }
        },
        toastSuccess: ({ event }) =>
          toast.success(
            ('data' in event && typeof event.data === 'string' && event.data) ||
              ('output' in event &&
                typeof event.output === 'string' &&
                event.output) ||
              ''
          ),
        toastError: ({ event }) =>
          toast.error(
            ('data' in event && typeof event.data === 'string' && event.data) ||
              ('output' in event &&
                typeof event.output === 'string' &&
                event.output) ||
              ''
          ),
      },
      actors: {
        readProjects: fromPromise(() => listProjects()),
        createProject: fromPromise(async ({ input }) => {
          let name = (
            input && 'name' in input && input.name
              ? input.name
              : settings.projects.defaultProjectName.current
          ).trim()

          if (doesProjectNameNeedInterpolated(name)) {
            const nextIndex = getNextProjectIndex(name, projects)
            name = interpolateProjectNameWithIndex(name, nextIndex)
          }

          await createNewProjectDirectory(name)

          return `Successfully created "${name}"`
        }),
        renameProject: fromPromise(async ({ input }) => {
          const { oldName, newName, defaultProjectName, defaultDirectory } =
            input
          let name = newName ? newName : defaultProjectName
          if (doesProjectNameNeedInterpolated(name)) {
            const nextIndex = await getNextProjectIndex(name, projects)
            name = interpolateProjectNameWithIndex(name, nextIndex)
          }

          await renameProjectDirectory(
            window.electron.path.join(defaultDirectory, oldName),
            name
          )
          return `Successfully renamed "${oldName}" to "${name}"`
        }),
        deleteProject: fromPromise(async ({ input }) => {
          await window.electron.rm(
            window.electron.path.join(input.defaultDirectory, input.name),
            {
              recursive: true,
            }
          )
          return `Successfully deleted "${input.name}"`
        }),
      },
      guards: {
        'Has at least 1 project': ({ event }) => {
          if (event.type !== 'xstate.done.actor.read-projects') return false
          console.log(`from has at least 1 project: ${event.output.length}`)
          return event.output.length ? event.output.length >= 1 : false
        },
      },
    }),
    {
      input: {
        projects: projectPaths,
        defaultProjectName: settings.projects.defaultProjectName.current,
        defaultDirectory: settings.app.projectDirectory.current,
      },
    }
  )

  useEffect(() => {
    send({ type: 'Read projects', data: {} })
  }, [projectPaths])

  // Re-read projects listing if the projectDir has any updates.
  useFileSystemWatcher(
    async () => {
      setProjectsLoaderTrigger(projectsLoaderTrigger + 1)
    },
    projectsDir ? [projectsDir] : []
  )

  const { projects } = state.context
  const [searchParams, setSearchParams] = useSearchParams()
  const { searchResults, query, setQuery } = useProjectSearch(projects)
  const sort = searchParams.get('sort_by') ?? 'modified:desc'

  const isSortByModified = sort?.includes('modified') || !sort || sort === null

  useStateMachineCommands({
    machineId: 'home',
    send,
    state,
    commandBarConfig: homeCommandBarConfig,
    actor,
  })

  // Update the default project name and directory in the home machine
  // when the settings change
  useEffect(() => {
    send({
      type: 'assign',
      data: {
        defaultProjectName: settings.projects.defaultProjectName.current,
        defaultDirectory: settings.app.projectDirectory.current,
      },
    })
  }, [
    settings.app.projectDirectory.current,
    settings.projects.defaultProjectName.current,
    send,
  ])

  async function handleRenameProject(
    e: FormEvent<HTMLFormElement>,
    project: Project
  ) {
    const { newProjectName } = Object.fromEntries(
      new FormData(e.target as HTMLFormElement)
    )

    if (newProjectName !== project.name) {
      send({
        type: 'Rename project',
        data: { oldName: project.name, newName: newProjectName as string },
      })
    }
  }

  async function handleDeleteProject(project: Project) {
    send({
      type: 'Delete project',
      data: { name: project.name || '' },
    })
  }

  return (
    <div className="relative flex flex-col h-screen overflow-hidden" ref={ref}>
      <AppHeader showToolbar={false} />
      <div className="w-full flex flex-col overflow-hidden max-w-5xl px-4 mx-auto mt-24 lg:px-2">
        <section>
          <div className="flex justify-between items-center select-none">
            <div className="flex gap-8 items-center">
              <h1 className="text-3xl font-bold">Your Projects</h1>
              <ActionButton
                Element="button"
                onClick={() =>
                  send({ type: 'Create project', data: { name: '' } })
                }
                className="group !bg-primary !text-chalkboard-10 !border-primary hover:shadow-inner hover:hue-rotate-15"
                iconStart={{
                  icon: 'plus',
                  bgClassName: '!bg-transparent rounded-sm',
                  iconClassName:
                    '!text-chalkboard-10 transition-transform group-active:rotate-90',
                }}
                data-testid="home-new-file"
              >
                New project
              </ActionButton>
            </div>
            <div className="flex gap-2 items-center">
              <ProjectSearchBar setQuery={setQuery} />
              <small>Sort by</small>
              <ActionButton
                Element="button"
                data-testid="home-sort-by-name"
                className={
                  'text-xs border-primary/10 ' +
                  (!sort.includes('name')
                    ? 'text-chalkboard-80 dark:text-chalkboard-40'
                    : '')
                }
                onClick={() =>
                  setSearchParams(getNextSearchParams(sort, 'name'))
                }
                iconStart={{
                  icon: getSortIcon(sort, 'name'),
                  bgClassName: 'bg-transparent',
                  iconClassName: !sort.includes('name')
                    ? '!text-chalkboard-90 dark:!text-chalkboard-30'
                    : '',
                }}
              >
                Name
              </ActionButton>
              <ActionButton
                Element="button"
                data-testid="home-sort-by-modified"
                className={
                  'text-xs border-primary/10 ' +
                  (!isSortByModified
                    ? 'text-chalkboard-80 dark:text-chalkboard-40'
                    : '')
                }
                onClick={() =>
                  setSearchParams(getNextSearchParams(sort, 'modified'))
                }
                iconStart={{
                  icon: sort ? getSortIcon(sort, 'modified') : 'arrowDown',
                  bgClassName: 'bg-transparent',
                  iconClassName: !isSortByModified
                    ? '!text-chalkboard-90 dark:!text-chalkboard-30'
                    : '',
                }}
              >
                Last Modified
              </ActionButton>
            </div>
          </div>
          <p className="my-4 text-sm text-chalkboard-80 dark:text-chalkboard-30">
            Loaded from{' '}
            <Link
              data-testid="project-directory-settings-link"
              to={`${PATHS.HOME + PATHS.SETTINGS_USER}#projectDirectory`}
              className="text-chalkboard-90 dark:text-chalkboard-20 underline underline-offset-2"
            >
              {settings.app.projectDirectory.current}
            </Link>
            .
          </p>
        </section>
        <section
          data-testid="home-section"
          className="flex-1 overflow-y-auto pr-2 pb-24"
        >
          {state.matches('Reading projects') ? (
            <Loading>Loading your Projects...</Loading>
          ) : (
            <>
              {searchResults.length > 0 ? (
                <ul className="grid w-full grid-cols-4 gap-4">
                  {searchResults.sort(getSortFunction(sort)).map((project) => (
                    <ProjectCard
                      key={project.name}
                      project={project}
                      handleRenameProject={handleRenameProject}
                      handleDeleteProject={handleDeleteProject}
                    />
                  ))}
                </ul>
              ) : (
                <p className="p-4 my-8 border border-dashed rounded border-chalkboard-30 dark:border-chalkboard-70">
                  No Projects found
                  {projects.length === 0
                    ? ', ready to make your first one?'
                    : ` with the search term "${query}"`}
                </p>
              )}
            </>
          )}
        </section>
        <LowerRightControls />
      </div>
    </div>
  )
}

export default Home

import { FormEvent, useEffect, useRef } from 'react'
import { remove } from '@tauri-apps/plugin-fs'
import {
  getNextProjectIndex,
  interpolateProjectNameWithIndex,
  doesProjectNameNeedInterpolated,
} from 'lib/tauriFS'
import { ActionButton } from 'components/ActionButton'
import { toast } from 'react-hot-toast'
import { AppHeader } from 'components/AppHeader'
import ProjectCard from 'components/ProjectCard/ProjectCard'
import { useLoaderData, useNavigate, useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { type HomeLoaderData } from 'lib/types'
import Loading from 'components/Loading'
import { useMachine } from '@xstate/react'
import { homeMachine } from '../machines/homeMachine'
import { ContextFrom, EventFrom } from 'xstate'
import { paths } from 'lib/paths'
import {
  getNextSearchParams,
  getSortFunction,
  getSortIcon,
} from '../lib/sorting'
import useStateMachineCommands from '../hooks/useStateMachineCommands'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { join, sep } from '@tauri-apps/api/path'
import { homeCommandBarConfig } from 'lib/commandBarConfigs/homeCommandConfig'
import { useHotkeys } from 'react-hotkeys-hook'
import { isDesktop } from 'lib/isDesktop'
import { kclManager } from 'lib/singletons'
import { useLspContext } from 'components/LspProvider'
import { useRefreshSettings } from 'hooks/useRefreshSettings'
import { LowerRightControls } from 'components/LowerRightControls'
import { Project } from 'wasm-lib/kcl/bindings/Project'
import {
  createNewProjectDirectory,
  listProjects,
  renameProjectDirectory,
} from 'lib/desktop'

// This route only opens in the Tauri desktop context for now,
// as defined in Router.tsx, so we can use the Tauri APIs and types.
const Home = () => {
  useRefreshSettings(paths.HOME + 'SETTINGS')
  const { commandBarSend } = useCommandsContext()
  const navigate = useNavigate()
  const { projects: loadedProjects } = useLoaderData() as HomeLoaderData
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
    () => navigate(paths.HOME + paths.SETTINGS),
    {
      splitKey: '|',
    }
  )
  const ref = useRef<HTMLDivElement>(null)

  const [state, send, actor] = useMachine(homeMachine, {
    context: {
      projects: loadedProjects,
      defaultProjectName: settings.projects.defaultProjectName.current,
      defaultDirectory: settings.app.projectDirectory.current,
    },
    actions: {
      navigateToProject: (
        context: ContextFrom<typeof homeMachine>,
        event: EventFrom<typeof homeMachine>
      ) => {
        if (event.data && 'name' in event.data) {
          let projectPath = context.defaultDirectory + sep() + event.data.name
          onProjectOpen(
            {
              name: event.data.name,
              path: projectPath,
            },
            null
          )
          commandBarSend({ type: 'Close' })
          navigate(`${paths.FILE}/${encodeURIComponent(projectPath)}`)
        }
      },
      toastSuccess: (_, event) => toast.success((event.data || '') + ''),
      toastError: (_, event) => toast.error((event.data || '') + ''),
    },
    services: {
      readProjects: async (context: ContextFrom<typeof homeMachine>) =>
        listProjects(),
      createProject: async (
        context: ContextFrom<typeof homeMachine>,
        event: EventFrom<typeof homeMachine, 'Create project'>
      ) => {
        let name = (
          event.data && 'name' in event.data
            ? event.data.name
            : settings.projects.defaultProjectName.current
        ).trim()

        if (doesProjectNameNeedInterpolated(name)) {
          const nextIndex = await getNextProjectIndex(name, projects)
          name = interpolateProjectNameWithIndex(name, nextIndex)
        }

        await createNewProjectDirectory(name)

        return `Successfully created "${name}"`
      },
      renameProject: async (
        context: ContextFrom<typeof homeMachine>,
        event: EventFrom<typeof homeMachine, 'Rename project'>
      ) => {
        const { oldName, newName } = event.data
        let name = newName ? newName : context.defaultProjectName
        if (doesProjectNameNeedInterpolated(name)) {
          const nextIndex = await getNextProjectIndex(name, projects)
          name = interpolateProjectNameWithIndex(name, nextIndex)
        }

        await renameProjectDirectory(
          await join(context.defaultDirectory, oldName),
          name
        )
        return `Successfully renamed "${oldName}" to "${name}"`
      },
      deleteProject: async (
        context: ContextFrom<typeof homeMachine>,
        event: EventFrom<typeof homeMachine, 'Delete project'>
      ) => {
        await remove(await join(context.defaultDirectory, event.data.name), {
          recursive: true,
        })
        return `Successfully deleted "${event.data.name}"`
      },
    },
    guards: {
      'Has at least 1 project': (_, event: EventFrom<typeof homeMachine>) => {
        if (event.type !== 'done.invoke.read-projects') return false
        return event?.data?.length ? event.data?.length >= 1 : false
      },
    },
  })
  const { projects } = state.context
  const [searchParams, setSearchParams] = useSearchParams()
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
      send('Rename project', {
        data: { oldName: project.name, newName: newProjectName },
      })
    }
  }

  async function handleDeleteProject(project: Project) {
    send('Delete project', { data: { name: project.name || '' } })
  }

  return (
    <div className="relative flex flex-col h-screen overflow-hidden" ref={ref}>
      <AppHeader showToolbar={false} />
      <div className="w-full flex flex-col overflow-hidden max-w-5xl px-4 mx-auto mt-24 lg:px-2">
        <section>
          <div className="flex justify-between items-baseline select-none">
            <div className="flex gap-8 items-baseline">
              <h1 className="text-3xl font-bold">Your Projects</h1>
              <ActionButton
                Element="button"
                onClick={() => send('Create project')}
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
              <small>Sort by</small>
              <ActionButton
                Element="button"
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
              to="settings?tab=user#projectDirectory"
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
              {projects.length > 0 ? (
                <ul className="grid w-full grid-cols-4 gap-4">
                  {projects.sort(getSortFunction(sort)).map((project) => (
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
                  No Projects found, ready to make your first one?
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

import { FormEvent, useEffect } from 'react'
import { removeDir, renameFile } from '@tauri-apps/api/fs'
import {
  createNewProject,
  getNextProjectIndex,
  interpolateProjectNameWithIndex,
  doesProjectNameNeedInterpolated,
  getProjectsInDir,
} from '../lib/tauriFS'
import { ActionButton } from '../components/ActionButton'
import { faArrowDown, faPlus } from '@fortawesome/free-solid-svg-icons'
import { toast } from 'react-hot-toast'
import { AppHeader } from '../components/AppHeader'
import ProjectCard from '../components/ProjectCard'
import { useLoaderData, useNavigate, useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { ProjectWithEntryPointMetadata, HomeLoaderData } from '../Router'
import Loading from '../components/Loading'
import { useMachine } from '@xstate/react'
import { homeCommandMeta, homeMachine } from '../machines/homeMachine'
import { ContextFrom, EventFrom } from 'xstate'
import { paths } from '../Router'
import {
  getNextSearchParams,
  getSortFunction,
  getSortIcon,
} from '../lib/sorting'
import useStateMachineCommands from '../hooks/useStateMachineCommands'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { DEFAULT_PROJECT_NAME } from 'machines/settingsMachine'

// This route only opens in the Tauri desktop context for now,
// as defined in Router.tsx, so we can use the Tauri APIs and types.
const Home = () => {
  const { commands, setCommandBarOpen } = useCommandsContext()
  const navigate = useNavigate()
  const { projects: loadedProjects } = useLoaderData() as HomeLoaderData
  const {
    settings: {
      context: { defaultDirectory, defaultProjectName },
      send: sendToSettings,
    },
  } = useGlobalStateContext()

  const [state, send] = useMachine(homeMachine, {
    context: {
      projects: loadedProjects,
      defaultProjectName,
      defaultDirectory,
    },
    actions: {
      navigateToProject: (
        context: ContextFrom<typeof homeMachine>,
        event: EventFrom<typeof homeMachine>
      ) => {
        if (event.data && 'name' in event.data) {
          setCommandBarOpen(false)
          navigate(
            `${paths.FILE}/${encodeURIComponent(
              context.defaultDirectory + '/' + event.data.name
            )}`
          )
        }
      },
      toastSuccess: (_, event) => toast.success((event.data || '') + ''),
      toastError: (_, event) => toast.error((event.data || '') + ''),
    },
    services: {
      readProjects: async (context: ContextFrom<typeof homeMachine>) =>
        getProjectsInDir(context.defaultDirectory),
      createProject: async (
        context: ContextFrom<typeof homeMachine>,
        event: EventFrom<typeof homeMachine, 'Create project'>
      ) => {
        let name = (
          event.data && 'name' in event.data
            ? event.data.name
            : defaultProjectName
        ).trim()
        let shouldUpdateDefaultProjectName = false

        // If there is no default project name, flag it to be set to the default
        if (!name) {
          name = DEFAULT_PROJECT_NAME
          shouldUpdateDefaultProjectName = true
        }

        if (doesProjectNameNeedInterpolated(name)) {
          const nextIndex = await getNextProjectIndex(name, projects)
          name = interpolateProjectNameWithIndex(name, nextIndex)
        }

        await createNewProject(context.defaultDirectory + '/' + name)

        if (shouldUpdateDefaultProjectName) {
          sendToSettings({
            type: 'Set Default Project Name',
            data: { defaultProjectName: DEFAULT_PROJECT_NAME },
          })
        }

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

        await renameFile(
          context.defaultDirectory + '/' + oldName,
          context.defaultDirectory + '/' + name
        )
        return `Successfully renamed "${oldName}" to "${name}"`
      },
      deleteProject: async (
        context: ContextFrom<typeof homeMachine>,
        event: EventFrom<typeof homeMachine, 'Delete project'>
      ) => {
        await removeDir(context.defaultDirectory + '/' + event.data.name, {
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

  useStateMachineCommands<typeof homeMachine>({
    commands,
    send,
    state,
    commandBarMeta: homeCommandMeta,
    owner: 'home',
  })

  useEffect(() => {
    send({ type: 'assign', data: { defaultProjectName, defaultDirectory } })
  }, [defaultDirectory, defaultProjectName, send])

  async function handleRenameProject(
    e: FormEvent<HTMLFormElement>,
    project: ProjectWithEntryPointMetadata
  ) {
    const { newProjectName } = Object.fromEntries(
      new FormData(e.target as HTMLFormElement)
    )

    send('Rename project', {
      data: { oldName: project.name, newName: newProjectName },
    })
  }

  async function handleDeleteProject(project: ProjectWithEntryPointMetadata) {
    send('Delete project', { data: { name: project.name || '' } })
  }

  return (
    <div className="h-screen overflow-hidden relative flex flex-col">
      <AppHeader showToolbar={false} />
      <div className="my-24 px-4 lg:px-0 overflow-y-auto max-w-5xl w-full mx-auto">
        <section className="flex justify-between">
          <h1 className="text-3xl text-bold">Your Projects</h1>
          <div className="flex">
            <ActionButton
              Element="button"
              className={
                !sort.includes('name')
                  ? 'text-chalkboard-80 dark:text-chalkboard-40'
                  : ''
              }
              onClick={() => setSearchParams(getNextSearchParams(sort, 'name'))}
              icon={{
                icon: getSortIcon(sort, 'name'),
                bgClassName: !sort?.includes('name')
                  ? 'bg-liquid-50 dark:bg-liquid-70'
                  : '',
                iconClassName: !sort?.includes('name')
                  ? 'text-liquid-80 dark:text-liquid-30'
                  : '',
              }}
            >
              Name
            </ActionButton>
            <ActionButton
              Element="button"
              className={
                !isSortByModified
                  ? 'text-chalkboard-80 dark:text-chalkboard-40'
                  : ''
              }
              onClick={() =>
                setSearchParams(getNextSearchParams(sort, 'modified'))
              }
              icon={{
                icon: sort ? getSortIcon(sort, 'modified') : faArrowDown,
                bgClassName: !isSortByModified
                  ? 'bg-liquid-50 dark:bg-liquid-70'
                  : '',
                iconClassName: !isSortByModified
                  ? 'text-liquid-80 dark:text-liquid-30'
                  : '',
              }}
            >
              Last Modified
            </ActionButton>
          </div>
        </section>
        <section>
          <p className="my-4 text-sm text-chalkboard-80 dark:text-chalkboard-30">
            Are being saved at{' '}
            <code className="text-liquid-80 dark:text-liquid-30">
              {defaultDirectory}
            </code>
            , which you can change in your <Link to="settings">Settings</Link>.
          </p>
          {state.matches('Reading projects') ? (
            <Loading>Loading your Projects...</Loading>
          ) : (
            <>
              {projects.length > 0 ? (
                <ul className="my-8 w-full grid grid-cols-4 gap-4">
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
                <p className="rounded my-8 border border-dashed border-chalkboard-30 dark:border-chalkboard-70 p-4">
                  No Projects found, ready to make your first one?
                </p>
              )}
              <ActionButton
                Element="button"
                onClick={() => send('Create project')}
                icon={{ icon: faPlus }}
              >
                New file
              </ActionButton>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default Home

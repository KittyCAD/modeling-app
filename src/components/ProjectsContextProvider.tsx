import { useMachine } from '@xstate/react'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { useFileSystemWatcher } from 'hooks/useFileSystemWatcher'
import { useProjectsLoader } from 'hooks/useProjectsLoader'
import { projectsMachine } from 'machines/projectsMachine'
import { createContext, useEffect, useState } from 'react'
import { Actor, AnyStateMachine, fromPromise, Prop, StateFrom } from 'xstate'
import { useLspContext } from './LspProvider'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { PATHS } from 'lib/paths'
import {
  createNewProjectDirectory,
  listProjects,
  renameProjectDirectory,
} from 'lib/desktop'
import {
  getNextProjectIndex,
  interpolateProjectNameWithIndex,
  doesProjectNameNeedInterpolated,
} from 'lib/desktopFS'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import useStateMachineCommands from 'hooks/useStateMachineCommands'
import { projectsCommandBarConfig } from 'lib/commandBarConfigs/projectsCommandConfig'

type MachineContext<T extends AnyStateMachine> = {
  state: StateFrom<T>
  send: Prop<Actor<T>, 'send'>
}

export const ProjectsMachineContext = createContext(
  {} as MachineContext<typeof projectsMachine>
)

export const ProjectsContextProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const navigate = useNavigate()
  const { commandBarSend } = useCommandsContext()
  const { onProjectOpen } = useLspContext()
  const {
    settings: { context: settings },
  } = useSettingsAuthContext()

  useEffect(() => {
    console.log(
      'project directory changed',
      settings.app.projectDirectory.current
    )
  }, [settings.app.projectDirectory.current])

  const [projectsLoaderTrigger, setProjectsLoaderTrigger] = useState(0)
  const { projectPaths, projectsDir } = useProjectsLoader([
    projectsLoaderTrigger,
  ])

  // Re-read projects listing if the projectDir has any updates.
  useFileSystemWatcher(
    () => {
      setProjectsLoaderTrigger(projectsLoaderTrigger + 1)
    },
    projectsDir ? [projectsDir] : []
  )

  const [state, send, actor] = useMachine(
    projectsMachine.provide({
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
            const newPathName = `${PATHS.FILE}/${encodeURIComponent(
              projectPath
            )}`
            console.log('navigating to', newPathName)
            console.log('defaultDirectory is', context.defaultDirectory)
            navigate(newPathName)
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
            const nextIndex = getNextProjectIndex(name, input.projects)
            name = interpolateProjectNameWithIndex(name, nextIndex)
          }

          await createNewProjectDirectory(name)

          return `Successfully created "${name}"`
        }),
        renameProject: fromPromise(async ({ input }) => {
          const {
            oldName,
            newName,
            defaultProjectName,
            defaultDirectory,
            projects,
          } = input
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

  // register all project-related command palette commands
  useStateMachineCommands({
    machineId: 'projects',
    send,
    state,
    commandBarConfig: projectsCommandBarConfig,
    actor,
  })

  return (
    <ProjectsMachineContext.Provider
      value={{
        state,
        send,
      }}
    >
      {children}
    </ProjectsMachineContext.Provider>
  )
}

import { useMachine } from '@xstate/react'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { useFileSystemWatcher } from 'hooks/useFileSystemWatcher'
import { useProjectsLoader } from 'hooks/useProjectsLoader'
import { projectsMachine } from 'machines/projectsMachine'
import { createContext, useEffect, useState } from 'react'
import { Actor, AnyStateMachine, fromPromise, Prop, StateFrom } from 'xstate'
import { useLspContext } from './LspProvider'
import toast from 'react-hot-toast'
import { useLocation, useNavigate } from 'react-router-dom'
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
import { isDesktop } from 'lib/isDesktop'

type MachineContext<T extends AnyStateMachine> = {
  state?: StateFrom<T>
  send: Prop<Actor<T>, 'send'>
}

export const ProjectsMachineContext = createContext(
  {} as MachineContext<typeof projectsMachine>
)

/**
 * Watches the project directory and provides project management-related commands,
 * like "Create project", "Open project", "Delete project", etc.
 *
 * If in the future we implement full-fledge project management in the web version,
 * we can unify these components but for now, we need this to be only for the desktop version.
 */
export const ProjectsContextProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  return isDesktop() ? (
    <ProjectsContextDesktop>{children}</ProjectsContextDesktop>
  ) : (
    <ProjectsContextWeb>{children}</ProjectsContextWeb>
  )
}

const ProjectsContextWeb = ({ children }: { children: React.ReactNode }) => {
  return (
    <ProjectsMachineContext.Provider
      value={{
        state: undefined,
        send: () => {},
      }}
    >
      {children}
    </ProjectsMachineContext.Provider>
  )
}

const ProjectsContextDesktop = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const navigate = useNavigate()
  const location = useLocation()
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
    async () => {
      return setProjectsLoaderTrigger(projectsLoaderTrigger + 1)
    },
    projectsDir ? [projectsDir] : []
  )

  const [state, send, actor] = useMachine(
    projectsMachine.provide({
      actions: {
        navigateToProject: ({ context, event }) => {
          const nameFromEventData =
            'data' in event &&
            event.data &&
            'name' in event.data &&
            event.data.name
          const nameFromOutputData =
            'output' in event &&
            event.output &&
            'name' in event.output &&
            event.output.name

          const name = nameFromEventData || nameFromOutputData

          if (name) {
            let projectPath =
              context.defaultDirectory + window.electron.path.sep + name
            onProjectOpen(
              {
                name,
                path: projectPath,
              },
              null
            )
            commandBarSend({ type: 'Close' })
            const newPathName = `${PATHS.FILE}/${encodeURIComponent(
              projectPath
            )}`
            navigate(newPathName)
          }
        },
        navigateToProjectIfNeeded: ({ event }) => {
          if (
            event.type.startsWith('xstate.done.actor.') &&
            'output' in event
          ) {
            const isInAProject = location.pathname.startsWith(PATHS.FILE)
            const isInDeletedProject =
              event.type === 'xstate.done.actor.delete-project' &&
              isInAProject &&
              decodeURIComponent(location.pathname).includes(event.output.name)
            if (isInDeletedProject) {
              navigate(PATHS.HOME)
              return
            }

            const isInRenamedProject =
              event.type === 'xstate.done.actor.rename-project' &&
              isInAProject &&
              decodeURIComponent(location.pathname).includes(
                event.output.oldName
              )

            if (isInRenamedProject) {
              // TODO: In future, we can navigate to the new project path
              // directly, but we need to coordinate with
              // @lf94's useFileSystemWatcher in SettingsAuthProvider.tsx:224
              // Because it's beating us to the punch and updating the route
              // const newPathName = location.pathname.replace(
              //   encodeURIComponent(event.output.oldName),
              //   encodeURIComponent(event.output.newName)
              // )
              // navigate(newPathName)
              return
            }
          }
        },
        toastSuccess: ({ event }) =>
          toast.success(
            ('data' in event && typeof event.data === 'string' && event.data) ||
              ('output' in event &&
                'message' in event.output &&
                typeof event.output.message === 'string' &&
                event.output.message) ||
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

          return {
            message: `Successfully created "${name}"`,
            name,
          }
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
            const nextIndex = getNextProjectIndex(name, projects)
            name = interpolateProjectNameWithIndex(name, nextIndex)
          }

          console.log('from Project')

          await renameProjectDirectory(
            window.electron.path.join(defaultDirectory, oldName),
            name
          )
          return {
            message: `Successfully renamed "${oldName}" to "${name}"`,
            oldName: oldName,
            newName: name,
          }
        }),
        deleteProject: fromPromise(async ({ input }) => {
          await window.electron.rm(
            window.electron.path.join(input.defaultDirectory, input.name),
            {
              recursive: true,
            }
          )
          return {
            message: `Successfully deleted "${input.name}"`,
            name: input.name,
          }
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

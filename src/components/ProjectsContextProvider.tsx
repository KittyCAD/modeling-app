import { useMachine } from '@xstate/react'
import { createContext, useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { Actor, AnyStateMachine, Prop, StateFrom } from 'xstate'
import { fromPromise } from 'xstate'

import { useLspContext } from '@src/components/LspProvider'
import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import { useProjectsLoader } from '@src/hooks/useProjectsLoader'
import useStateMachineCommands from '@src/hooks/useStateMachineCommands'
import { newKclFile } from '@src/lang/project'
import { projectsCommandBarConfig } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import {
  CREATE_FILE_URL_PARAM,
  FILE_EXT,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import {
  createNewProjectDirectory,
  listProjects,
  renameProjectDirectory,
} from '@src/lib/desktop'
import {
  doesProjectNameNeedInterpolated,
  getNextFileName,
  getNextProjectIndex,
  getUniqueProjectName,
  interpolateProjectNameWithIndex,
} from '@src/lib/desktopFS'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { codeManager, kclManager } from '@src/lib/singletons'
import { err } from '@src/lib/trap'
import { useSettings } from '@src/machines/appMachine'
import { commandBarActor } from '@src/machines/commandBarMachine'
import { projectsMachine } from '@src/machines/projectsMachine'

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

/**
 * We need some of the functionality of the ProjectsContextProvider in the web version
 * but we can't perform file system operations in the browser,
 * so most of the behavior of this machine is stubbed out.
 */
const ProjectsContextWeb = ({ children }: { children: React.ReactNode }) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const clearImportSearchParams = useCallback(() => {
    // Clear the search parameters related to the "Import file from URL" command
    // or we'll never be able cancel or submit it.
    searchParams.delete(CREATE_FILE_URL_PARAM)
    searchParams.delete('code')
    searchParams.delete('name')
    searchParams.delete('units')
    setSearchParams(searchParams)
  }, [searchParams, setSearchParams])
  const settings = useSettings()

  const [state, send, actor] = useMachine(
    projectsMachine.provide({
      actions: {
        navigateToProject: () => {},
        navigateToProjectIfNeeded: () => {},
        navigateToFile: () => {},
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
        readProjects: fromPromise(async () => [] as Project[]),
        createProject: fromPromise(async () => ({
          message: 'not implemented on web',
        })),
        renameProject: fromPromise(async () => ({
          message: 'not implemented on web',
          oldName: '',
          newName: '',
        })),
        deleteProject: fromPromise(async () => ({
          message: 'not implemented on web',
          name: '',
        })),
        createFile: fromPromise(async ({ input }) => {
          // Browser version doesn't navigate, just overwrites the current file
          clearImportSearchParams()

          const codeToWrite = newKclFile(
            input.code,
            settings.modeling.defaultUnit.current
          )
          if (err(codeToWrite)) return Promise.reject(codeToWrite)
          codeManager.updateCodeStateEditor(codeToWrite)
          await codeManager.writeToFile()
          await kclManager.executeCode()

          return {
            message: 'File overwritten successfully',
            fileName: input.name,
            projectName: '',
          }
        }),
      },
    }),
    {
      input: {
        projects: [],
        defaultProjectName: settings.projects.defaultProjectName.current,
        defaultDirectory: settings.app.projectDirectory.current,
        hasListedProjects: false,
      },
    }
  )

  // register all project-related command palette commands
  useStateMachineCommands({
    machineId: 'projects',
    send,
    state,
    commandBarConfig: projectsCommandBarConfig,
    actor,
    onCancel: clearImportSearchParams,
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

const ProjectsContextDesktop = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const clearImportSearchParams = useCallback(() => {
    // Clear the search parameters related to the "Import file from URL" command
    // or we'll never be able cancel or submit it.
    searchParams.delete(CREATE_FILE_URL_PARAM)
    searchParams.delete('code')
    searchParams.delete('name')
    searchParams.delete('units')
    setSearchParams(searchParams)
  }, [searchParams, setSearchParams])
  const { onProjectOpen } = useLspContext()
  const settings = useSettings()
  const [projectsLoaderTrigger, setProjectsLoaderTrigger] = useState(0)
  const { projectPaths, projectsDir } = useProjectsLoader([
    projectsLoaderTrigger,
  ])

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
            commandBarActor.send({ type: 'Close' })
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
        navigateToFile: ({ context, event }) => {
          if (event.type !== 'xstate.done.actor.create-file') return
          // For now, the browser version of create-file doesn't need to navigate
          // since it just overwrites the current file.
          if (!isDesktop()) return
          let projectPath = window.electron.join(
            context.defaultDirectory,
            event.output.projectName
          )
          let filePath = window.electron.join(
            projectPath,
            event.output.fileName
          )
          onProjectOpen(
            {
              name: event.output.projectName,
              path: projectPath,
            },
            null
          )
          const pathToNavigateTo = `${PATHS.FILE}/${encodeURIComponent(
            filePath
          )}`
          navigate(pathToNavigateTo)
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
              ('error' in event &&
                event.error instanceof Error &&
                event.error.message) ||
              ''
          ),
      },
      actors: {
        readProjects: fromPromise(() => {
          return listProjects()
        }),
        createProject: fromPromise(async ({ input }) => {
          let name = (
            input && 'name' in input && input.name
              ? input.name
              : settings.projects.defaultProjectName.current
          ).trim()

          const uniqueName = getUniqueProjectName(name, input.projects)
          await createNewProjectDirectory(uniqueName)

          return {
            message: `Successfully created "${uniqueName}"`,
            name: uniqueName,
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

          // Toast an error if the project name is taken
          if (projects.find((p) => p.name === name)) {
            return Promise.reject(
              new Error(`Project with name "${name}" already exists`)
            )
          }

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
        createFile: fromPromise(async ({ input }) => {
          let projectName =
            (input.method === 'newProject' ? input.name : input.projectName) ||
            settings.projects.defaultProjectName.current
          let fileName =
            input.method === 'newProject'
              ? PROJECT_ENTRYPOINT
              : input.name.endsWith(FILE_EXT)
                ? input.name
                : input.name + FILE_EXT
          let message = 'File created successfully'

          const needsInterpolated = doesProjectNameNeedInterpolated(projectName)
          if (needsInterpolated) {
            const nextIndex = getNextProjectIndex(projectName, input.projects)
            projectName = interpolateProjectNameWithIndex(
              projectName,
              nextIndex
            )
          }

          // Create the project around the file if newProject
          let fileLoaded = false
          if (input.method === 'newProject') {
            await createNewProjectDirectory(projectName, input.code)
            fileLoaded = true
            message = `Project "${projectName}" created successfully with link contents`
          } else {
            message = `File "${fileName}" created successfully`
          }

          // Create the file
          let baseDir = window.electron.join(
            settings.app.projectDirectory.current,
            projectName
          )
          const { name, path } = getNextFileName({
            entryName: fileName,
            baseDir,
          })

          fileName = name
          if (!fileLoaded) {
            const codeToWrite = newKclFile(
              input.code,
              settings.modeling.defaultUnit.current
            )
            if (err(codeToWrite)) return Promise.reject(codeToWrite)
            await window.electron.writeFile(path, codeToWrite)
          }

          // TODO: Return the project's file name if one was created.
          return {
            message,
            fileName,
            projectName,
          }
        }),
      },
    }),
    {
      input: {
        projects: projectPaths,
        defaultProjectName: settings.projects.defaultProjectName.current,
        defaultDirectory: settings.app.projectDirectory.current,
        hasListedProjects: false,
      },
    }
  )

  useFileSystemWatcher(
    async () => {
      // Gotcha: Chokidar is buggy. It will emit addDir or add on files that did not get created.
      // This means while the application initialize and Chokidar initializes you cannot tell if
      // a directory or file is actually created or they are buggy signals. This means you must
      // ignore all signals during initialization because it is ambiguous. Once those signals settle
      // you can actually start listening to real signals.
      // If someone creates folders or files during initialization we ignore those events!
      if (!actor.getSnapshot().context.hasListedProjects) {
        return
      }
      return setProjectsLoaderTrigger(projectsLoaderTrigger + 1)
    },
    projectsDir ? [projectsDir] : []
  )

  // Gotcha: Triggers listProjects() on chokidar changes
  // Gotcha: Load the projects when the projectDirectory changes.
  const projectDirectory = settings.app.projectDirectory.current
  useEffect(() => {
    send({ type: 'Read projects', data: {} })
  }, [projectPaths, projectDirectory])

  // register all project-related command palette commands
  useStateMachineCommands({
    machineId: 'projects',
    send,
    state,
    commandBarConfig: projectsCommandBarConfig,
    actor,
    onCancel: clearImportSearchParams,
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

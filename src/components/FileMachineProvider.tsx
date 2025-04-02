import { useMachine } from '@xstate/react'
import React, { createContext, useEffect, useMemo } from 'react'
import { toast } from 'react-hot-toast'
import { useLocation, useNavigate, useRouteLoaderData } from 'react-router-dom'
import type {
  Actor,
  AnyStateMachine,
  ContextFrom,
  Prop,
  StateFrom,
} from 'xstate'
import { fromPromise } from 'xstate'

import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { useMenuListener } from '@src/hooks/useMenu'
import { newKclFile } from '@src/lang/project'
import { createNamedViewsCommand } from '@src/lib/commandBarConfigs/namedViewsConfig'
import { createRouteCommands } from '@src/lib/commandBarConfigs/routeCommandConfig'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  DEFAULT_FILE_NAME,
  DEFAULT_PROJECT_KCL_FILE,
  FILE_EXT,
} from '@src/lib/constants'
import { getProjectInfo } from '@src/lib/desktop'
import { getNextDirName, getNextFileName } from '@src/lib/desktopFS'
import type { KclSamplesManifestItem } from '@src/lib/getKclSamplesManifest'
import { getKclSamplesManifest } from '@src/lib/getKclSamplesManifest'
import { isDesktop } from '@src/lib/isDesktop'
import { kclCommands } from '@src/lib/kclCommands'
import { BROWSER_PATH, PATHS } from '@src/lib/paths'
import { markOnce } from '@src/lib/performance'
import { codeManager, kclManager } from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import { type IndexLoaderData } from '@src/lib/types'
import { useSettings, useToken } from '@src/machines/appMachine'
import { commandBarActor } from '@src/machines/commandBarMachine'
import { fileMachine } from '@src/machines/fileMachine'
import { modelingMenuCallbackMostActions } from '@src/menu/register'

type MachineContext<T extends AnyStateMachine> = {
  state: StateFrom<T>
  context: ContextFrom<T>
  send: Prop<Actor<T>, 'send'>
}

export const FileContext = createContext(
  {} as MachineContext<typeof fileMachine>
)

export const FileMachineProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const navigate = useNavigate()
  const location = useLocation()
  const token = useToken()
  const settings = useSettings()
  const projectData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const { project, file } = projectData
  const [kclSamples, setKclSamples] = React.useState<KclSamplesManifestItem[]>(
    []
  )

  const filePath = useAbsoluteFilePath()
  // Only create the native file menus on desktop
  useEffect(() => {
    if (isDesktop()) {
      window.electron.createModelingPageMenu().catch(reportRejection)
    }
  }, [])

  // Only create the native file menus on desktop
  useEffect(() => {
    if (isDesktop()) {
      window.electron.createModelingPageMenu().catch(reportRejection)
    }
  }, [])

  useEffect(() => {
    const {
      createNamedViewCommand,
      deleteNamedViewCommand,
      loadNamedViewCommand,
    } = createNamedViewsCommand()

    const commands = [
      createNamedViewCommand,
      deleteNamedViewCommand,
      loadNamedViewCommand,
    ]
    commandBarActor.send({
      type: 'Add commands',
      data: {
        commands,
      },
    })
    return () => {
      // Remove commands if you go to the home page
      commandBarActor.send({
        type: 'Remove commands',
        data: {
          commands,
        },
      })
    }
  }, [])

  // Due to the route provider, i've moved this to the FileMachineProvider instead of CommandBarProvider
  // This will register the commands to route to Telemetry, Home, and Settings.
  useEffect(() => {
    const filePath =
      PATHS.FILE + '/' + encodeURIComponent(file?.path || BROWSER_PATH)
    const { RouteTelemetryCommand, RouteHomeCommand, RouteSettingsCommand } =
      createRouteCommands(navigate, location, filePath)
    commandBarActor.send({
      type: 'Remove commands',
      data: {
        commands: [
          RouteTelemetryCommand,
          RouteHomeCommand,
          RouteSettingsCommand,
        ],
      },
    })
    if (location.pathname === PATHS.HOME) {
      commandBarActor.send({
        type: 'Add commands',
        data: { commands: [RouteTelemetryCommand, RouteSettingsCommand] },
      })
    } else if (location.pathname.includes(PATHS.FILE)) {
      commandBarActor.send({
        type: 'Add commands',
        data: {
          commands: [
            RouteTelemetryCommand,
            RouteSettingsCommand,
            RouteHomeCommand,
          ],
        },
      })
    }
  }, [location])

  useEffect(() => {
    markOnce('code/didLoadFile')
    async function fetchKclSamples() {
      const manifest = await getKclSamplesManifest()
      const filteredFiles = manifest.filter((file) => !file.multipleFiles)
      setKclSamples(filteredFiles)
    }
    fetchKclSamples().catch(reportError)
  }, [])

  const [state, send] = useMachine(
    fileMachine.provide({
      actions: {
        renameToastSuccess: ({ event }) => {
          if (event.type !== 'xstate.done.actor.rename-file') return
          toast.success(event.output.message)
        },
        createToastSuccess: ({ event }) => {
          if (event.type !== 'xstate.done.actor.create-and-open-file') return
          toast.success(event.output.message)
        },
        toastSuccess: ({ event }) => {
          if (
            event.type !== 'xstate.done.actor.rename-file' &&
            event.type !== 'xstate.done.actor.delete-file'
          )
            return
          toast.success(event.output.message)
        },
        toastError: ({ event }) => {
          if (event.type !== 'xstate.done.actor.rename-file') return
          toast.error(event.output.message)
        },
        navigateToFile: ({ context, event }) => {
          if (event.type !== 'xstate.done.actor.create-and-open-file') return
          if (event.output && 'name' in event.output) {
            // TODO: Technically this is not the same as the FileTree Onclick even if they are in the same page
            // What is "Open file?"
            commandBarActor.send({ type: 'Close' })
            navigate(
              `..${PATHS.FILE}/${encodeURIComponent(
                // TODO: Should this be context.selectedDirectory.path?
                // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
                context.selectedDirectory +
                  window.electron.path.sep +
                  // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
                  event.output.name
              )}`
            )
          } else if (
            event.output &&
            'path' in event.output &&
            event.output.path.endsWith(FILE_EXT)
          ) {
            // Don't navigate to newly created directories
            navigate(`..${PATHS.FILE}/${encodeURIComponent(event.output.path)}`)
          }
        },
      },
      actors: {
        readFiles: fromPromise(async ({ input }) => {
          const newFiles =
            (isDesktop() ? (await getProjectInfo(input.path)).children : []) ??
            []
          return {
            ...input,
            children: newFiles,
          }
        }),
        createAndOpenFile: fromPromise(async ({ input }) => {
          let createdName = input.name.trim() || DEFAULT_FILE_NAME
          let createdPath: string

          if (
            (input.targetPathToClone &&
              (await window.electron.statIsDirectory(
                input.targetPathToClone
              ))) ||
            input.makeDir
          ) {
            let { name, path } = getNextDirName({
              entryName: input.targetPathToClone
                ? window.electron.path.basename(input.targetPathToClone)
                : createdName,
              baseDir: input.targetPathToClone
                ? window.electron.path.dirname(input.targetPathToClone)
                : input.selectedDirectory.path,
            })
            createdName = name
            createdPath = path
            await window.electron.mkdir(createdPath)
          } else {
            const { name, path } = getNextFileName({
              entryName: input.targetPathToClone
                ? window.electron.path.basename(input.targetPathToClone)
                : createdName,
              baseDir: input.targetPathToClone
                ? window.electron.path.dirname(input.targetPathToClone)
                : input.selectedDirectory.path,
            })
            createdName = name
            createdPath = path
            if (input.targetPathToClone) {
              await window.electron.copyFile(
                input.targetPathToClone,
                createdPath
              )
            } else {
              const codeToWrite = newKclFile(
                input.content,
                settings.modeling.defaultUnit.current
              )
              if (err(codeToWrite)) return Promise.reject(codeToWrite)
              await window.electron.writeFile(createdPath, codeToWrite)
            }
          }

          return {
            message: `Successfully created "${createdName}"`,
            path: createdPath,
            shouldSetToRename: input.shouldSetToRename,
          }
        }),
        createFile: fromPromise(async ({ input }) => {
          let createdName = input.name.trim() || DEFAULT_FILE_NAME
          let createdPath: string

          if (input.makeDir) {
            let { name, path } = getNextDirName({
              entryName: createdName,
              baseDir: input.selectedDirectory.path,
            })
            createdName = name
            createdPath = path
            await window.electron.mkdir(createdPath)
          } else {
            const { name, path } = getNextFileName({
              entryName: createdName,
              baseDir: input.selectedDirectory.path,
            })
            createdName = name
            createdPath = path
            const codeToWrite = newKclFile(
              input.content,
              settings.modeling.defaultUnit.current
            )
            if (err(codeToWrite)) return Promise.reject(codeToWrite)
            await window.electron.writeFile(createdPath, codeToWrite)
          }

          return {
            path: createdPath,
          }
        }),
        renameFile: fromPromise(async ({ input }) => {
          const { oldName, newName, isDir } = input
          const name = newName
            ? newName.endsWith(FILE_EXT) || isDir
              ? newName
              : newName + FILE_EXT
            : DEFAULT_FILE_NAME
          const oldPath = window.electron.path.join(
            input.selectedDirectory.path,
            oldName
          )
          const newPath = window.electron.path.join(
            input.selectedDirectory.path,
            name
          )

          // no-op
          if (oldPath === newPath) {
            return {
              message: `Old is the same as new.`,
              newPath,
              oldPath,
            }
          }

          // if there are any siblings with the same name, report error.
          const entries = await window.electron.readdir(
            window.electron.path.dirname(newPath)
          )
          for (let entry of entries) {
            if (entry === newName) {
              return Promise.reject(new Error('Filename already exists.'))
            }
          }

          window.electron.rename(oldPath, newPath)

          if (!file) {
            return Promise.reject(new Error('file is not defined'))
          }

          if (oldPath === file.path && project?.path) {
            // If we just renamed the current file, navigate to the new path
            navigate(`..${PATHS.FILE}/${encodeURIComponent(newPath)}`)
          } else if (file?.path.includes(oldPath)) {
            // If we just renamed a directory that the current file is in, navigate to the new path
            navigate(
              `..${PATHS.FILE}/${encodeURIComponent(
                file.path.replace(oldPath, newPath)
              )}`
            )
          }

          return {
            message: `Successfully renamed "${oldName}" to "${name}"`,
            newPath,
            oldPath,
          }
        }),
        deleteFile: fromPromise(async ({ input }) => {
          const isDir = !!input.children

          if (isDir) {
            await window.electron
              .rm(input.path, {
                recursive: true,
              })
              .catch((e) => console.error('Error deleting directory', e))
          } else {
            await window.electron
              .rm(input.path)
              .catch((e) => console.error('Error deleting file', e))
          }

          // If there are no more files at all in the project, create a main.kcl
          // for when we navigate to the root.
          if (!project?.path) {
            return Promise.reject(new Error('Project path not set.'))
          }

          const entries = await window.electron.readdir(project.path)
          const hasKclEntries =
            entries.filter((e: string) => e.endsWith('.kcl')).length !== 0
          if (!hasKclEntries) {
            const codeToWrite = newKclFile(
              undefined,
              settings.modeling.defaultUnit.current
            )
            if (err(codeToWrite)) return Promise.reject(codeToWrite)
            const path = window.electron.path.join(
              project.path,
              DEFAULT_PROJECT_KCL_FILE
            )
            await window.electron.writeFile(path, codeToWrite)
            // Refresh the route selected above because it's possible we're on
            // the same path on the navigate, which doesn't cause anything to
            // refresh, leaving a stale execution state.
            navigate(0)
            return {
              message: 'No more files in project, created main.kcl',
            }
          }

          // If we just deleted the current file or one of its parent directories,
          // navigate to the project root
          if (
            (input.path === file?.path || file?.path.includes(input.path)) &&
            project?.path
          ) {
            navigate(`../${PATHS.FILE}/${encodeURIComponent(project.path)}`)
          }

          return {
            message: `Successfully deleted ${isDir ? 'folder' : 'file'} "${
              input.name
            }"`,
          }
        }),
      },
    }),
    {
      input: {
        project,
        selectedDirectory: project,
      },
    }
  )

  const cb = modelingMenuCallbackMostActions(
    settings,
    navigate,
    filePath,
    project,
    token
  )
  useMenuListener(cb)

  const kclCommandMemo = useMemo(
    () =>
      kclCommands({
        authToken: token ?? '',
        projectData,
        settings: {
          defaultUnit:
            settings.modeling.defaultUnit.current ??
            DEFAULT_DEFAULT_LENGTH_UNIT,
        },
        specialPropsForSampleCommand: {
          onSubmit: async (data) => {
            if (data.method === 'overwrite') {
              codeManager.updateCodeStateEditor(data.code)
              await kclManager.executeCode(true)
              await codeManager.writeToFile()
            } else if (data.method === 'newFile' && isDesktop()) {
              send({
                type: 'Create file',
                data: {
                  name: data.sampleName,
                  content: data.code,
                  makeDir: false,
                },
              })
            }
          },
          providedOptions: kclSamples.map((sample) => ({
            value: sample.pathFromProjectDirectoryToFirstFile,
            name: sample.title,
          })),
        },
      }).filter(
        (command) => kclSamples.length || command.name !== 'open-kcl-example'
      ),
    [codeManager, kclManager, send, kclSamples]
  )

  useEffect(() => {
    commandBarActor.send({
      type: 'Add commands',
      data: { commands: kclCommandMemo },
    })

    return () => {
      commandBarActor.send({
        type: 'Remove commands',
        data: { commands: kclCommandMemo },
      })
    }
  }, [commandBarActor.send, kclCommandMemo])

  return (
    <FileContext.Provider
      value={{
        send,
        state,
        context: state.context, // just a convenience, can remove if we need to save on memory
      }}
    >
      {children}
    </FileContext.Provider>
  )
}

export default FileMachineProvider

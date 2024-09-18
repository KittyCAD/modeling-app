import { useMachine } from '@xstate/react'
import { useNavigate, useRouteLoaderData } from 'react-router-dom'
import { type IndexLoaderData } from 'lib/types'
import { PATHS } from 'lib/paths'
import React, { createContext, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import {
  Actor,
  AnyStateMachine,
  ContextFrom,
  Prop,
  StateFrom,
  fromPromise,
} from 'xstate'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { fileMachine } from 'machines/fileMachine'
import { isDesktop } from 'lib/isDesktop'
import {
  DEFAULT_FILE_NAME,
  DEFAULT_PROJECT_KCL_FILE,
  FILE_EXT,
} from 'lib/constants'
import { getProjectInfo } from 'lib/desktop'
import { getNextDirName, getNextFileName } from 'lib/desktopFS'
import { kclCommands } from 'lib/kclCommands'

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
  const { commandBarSend } = useCommandsContext()
  const { project, file } = useRouteLoaderData(PATHS.FILE) as IndexLoaderData

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
            commandBarSend({ type: 'Close' })
            navigate(
              `..${PATHS.FILE}/${encodeURIComponent(
                context.selectedDirectory +
                  window.electron.path.sep +
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
            await window.electron.writeFile(createdPath, input.content ?? '')
          }

          return {
            message: `Successfully created "${createdName}"`,
            path: createdPath,
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
            await window.electron.writeFile(createdPath, input.content ?? '')
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
            await window.electron.writeFile(
              window.electron.path.join(project.path, DEFAULT_PROJECT_KCL_FILE),
              ''
            )
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

  useEffect(() => {
    commandBarSend({ type: 'Add commands', data: { commands: kclCommands } })

    return () => {
      commandBarSend({
        type: 'Remove commands',
        data: { commands: kclCommands },
      })
    }
  }, [commandBarSend])

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

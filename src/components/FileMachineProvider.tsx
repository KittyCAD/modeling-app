import { useMachine } from '@xstate/react'
import { useNavigate, useRouteLoaderData } from 'react-router-dom'
import { type IndexLoaderData } from 'lib/types'
import { PATHS } from 'lib/paths'
import React, { createContext } from 'react'
import { toast } from 'react-hot-toast'
import {
  AnyStateMachine,
  ContextFrom,
  EventFrom,
  InterpreterFrom,
  Prop,
  StateFrom,
  assign,
} from 'xstate'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { fileMachine } from 'machines/fileMachine'
import { isDesktop } from 'lib/isDesktop'
import { DEFAULT_FILE_NAME, FILE_EXT } from 'lib/constants'
import { getProjectInfo } from 'lib/desktop'
import { getNextDirName, getNextFileName } from 'lib/desktopFS'

type MachineContext<T extends AnyStateMachine> = {
  state: StateFrom<T>
  context: ContextFrom<T>
  send: Prop<InterpreterFrom<T>, 'send'>
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

  const [state, send] = useMachine(fileMachine, {
    context: {
      project,
      selectedDirectory: project,
    },
    actions: {
      navigateToFile: (context, event) => {
        if (event.data && 'name' in event.data) {
          commandBarSend({ type: 'Close' })
          navigate(
            `..${PATHS.FILE}/${encodeURIComponent(
              context.selectedDirectory +
                window.electron.path.sep +
                event.data.name
            )}`
          )
        } else if (
          event.data &&
          'path' in event.data &&
          event.data.path.endsWith(FILE_EXT)
        ) {
          // Don't navigate to newly created directories
          navigate(`..${PATHS.FILE}/${encodeURIComponent(event.data.path)}`)
        }
      },
      addFileToRenamingQueue: assign({
        itemsBeingRenamed: (context, event) => [
          ...context.itemsBeingRenamed,
          event.data.path,
        ],
      }),
      removeFileFromRenamingQueue: assign({
        itemsBeingRenamed: (
          context,
          event: EventFrom<typeof fileMachine, 'done.invoke.rename-file'>
        ) =>
          context.itemsBeingRenamed.filter(
            (path) => path !== event.data.oldPath
          ),
      }),
      renameToastSuccess: (_, event) => toast.success(event.data.message),
      createToastSuccess: (_, event) => toast.success(event.data.message),
      toastSuccess: (_, event) =>
        event.data && toast.success((event.data || '') + ''),
      toastError: (_, event) => toast.error((event.data || '') + ''),
    },
    services: {
      readFiles: async (context: ContextFrom<typeof fileMachine>) => {
        const newFiles = isDesktop()
          ? (await getProjectInfo(context.project.path)).children
          : []
        return {
          ...context.project,
          children: newFiles,
        }
      },
      createAndOpenFile: async (context, event) => {
        let createdName = event.data.name.trim() || DEFAULT_FILE_NAME
        let createdPath: string

        if (event.data.makeDir) {
          let { name, path } = getNextDirName({
            entryName: createdName,
            baseDir: context.selectedDirectory.path,
          })
          createdName = name
          createdPath = path
          await window.electron.mkdir(createdPath)
        } else {
          const { name, path } = getNextFileName({
            entryName: createdName,
            baseDir: context.selectedDirectory.path,
          })
          createdName = name
          createdPath = path
          await window.electron.writeFile(createdPath, event.data.content ?? '')
        }

        return {
          message: `Successfully created "${createdName}"`,
          path: createdPath,
        }
      },
      createFile: async (context, event) => {
        let createdName = event.data.name.trim() || DEFAULT_FILE_NAME
        let createdPath: string

        if (event.data.makeDir) {
          let { name, path } = getNextDirName({
            entryName: createdName,
            baseDir: context.selectedDirectory.path,
          })
          createdName = name
          createdPath = path
          await window.electron.mkdir(createdPath)
        } else {
          const { name, path } = getNextFileName({
            entryName: createdName,
            baseDir: context.selectedDirectory.path,
          })
          createdName = name
          createdPath = path
          await window.electron.writeFile(createdPath, event.data.content ?? '')
        }

        return {
          path: createdPath,
        }
      },
      renameFile: async (
        context: ContextFrom<typeof fileMachine>,
        event: EventFrom<typeof fileMachine, 'Rename file'>
      ) => {
        const { oldName, newName, isDir } = event.data
        const name = newName ? newName : DEFAULT_FILE_NAME
        const oldPath = window.electron.path.join(
          context.selectedDirectory.path,
          oldName
        )
        const newDirPath = window.electron.path.join(
          context.selectedDirectory.path,
          name
        )
        const newPath =
          newDirPath + (name.endsWith(FILE_EXT) || isDir ? '' : FILE_EXT)

        await window.electron.rename(oldPath, newPath)

        if (!file) {
          return Promise.reject(new Error('file is not defined'))
        }

        const currentFilePath = window.electron.path.join(file.path, file.name)
        if (oldPath === currentFilePath && project?.path) {
          // If we just renamed the current file, navigate to the new path
          navigate(`..${PATHS.FILE}/${encodeURIComponent(newPath)}`)
        } else if (file?.path.includes(oldPath)) {
          // If we just renamed a directory that the current file is in, navigate to the new path
          navigate(
            `..${PATHS.FILE}/${encodeURIComponent(
              file.path.replace(oldPath, newDirPath)
            )}`
          )
        }

        return {
          message: `Successfully renamed "${oldName}" to "${name}"`,
          newPath,
          oldPath,
        }
      },
      deleteFile: async (
        context: ContextFrom<typeof fileMachine>,
        event: EventFrom<typeof fileMachine, 'Delete file'>
      ) => {
        const isDir = !!event.data.children

        if (isDir) {
          await window.electron
            .rm(event.data.path, {
              recursive: true,
            })
            .catch((e) => console.error('Error deleting directory', e))
        } else {
          await window.electron
            .rm(event.data.path)
            .catch((e) => console.error('Error deleting file', e))
        }

        // If we just deleted the current file or one of its parent directories,
        // navigate to the project root
        if (
          (event.data.path === file?.path ||
            file?.path.includes(event.data.path)) &&
          project?.path
        ) {
          navigate(`../${PATHS.FILE}/${encodeURIComponent(project.path)}`)
        }

        return `Successfully deleted ${isDir ? 'folder' : 'file'} "${
          event.data.name
        }"`
      },
    },
    guards: {
      'Has at least 1 file': (_, event: EventFrom<typeof fileMachine>) => {
        if (event.type !== 'done.invoke.read-files') return false
        return !!event?.data?.children && event.data.children.length > 0
      },
      'Is not silent': (_, event) => !event.data?.silent,
    },
  })

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

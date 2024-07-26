import { useMachine } from '@xstate/react'
import { useNavigate, useRouteLoaderData } from 'react-router-dom'
import { type IndexLoaderData } from 'lib/types'
import { paths } from 'lib/paths'
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
import { mkdir, remove, rename, create } from '@tauri-apps/plugin-fs'
import { isDesktop } from 'lib/isDesktop'
import { join, sep } from '@tauri-apps/api/path'
import { DEFAULT_FILE_NAME, FILE_EXT } from 'lib/constants'
import { getProjectInfo } from 'lib/desktop'

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
  const { project, file } = useRouteLoaderData(paths.FILE) as IndexLoaderData

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
            `${paths.FILE}/${encodeURIComponent(
              context.selectedDirectory + window.electron.path.sep + event.data.name
            )}`
          )
        } else if (
          event.data &&
          'path' in event.data &&
          event.data.path.endsWith(FILE_EXT)
        ) {
          // Don't navigate to newly created directories
          navigate(`${paths.FILE}/${encodeURIComponent(event.data.path)}`)
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
          ? (await getProjectInfo(context.project.file.path)).children
          : []
        return {
          ...context.project,
          children: newFiles,
        }
      },
      createFile: async (context, event) => {
        let createdName = event.data.name.trim() || DEFAULT_FILE_NAME
        let createdPath: string

        if (event.data.makeDir) {
          createdPath = await join(context.selectedDirectory.path, createdName)
          await mkdir(createdPath)
        } else {
          createdPath =
            context.selectedDirectory.path +
            window.electron.path.sep +
            createdName +
            (createdName.endsWith(FILE_EXT) ? '' : FILE_EXT)
          await create(createdPath)
        }

        return {
          message: `Successfully created "${createdName}"`,
          path: createdPath,
        }
      },
      renameFile: async (
        context: ContextFrom<typeof fileMachine>,
        event: EventFrom<typeof fileMachine, 'Rename file'>
      ) => {
        const { oldName, newName, isDir } = event.data
        const name = newName ? newName : DEFAULT_FILE_NAME
        const oldPath = await join(context.selectedDirectory.path, oldName)
        const newDirPath = await join(context.selectedDirectory.path, name)
        const newPath =
          newDirPath + (name.endsWith(FILE_EXT) || isDir ? '' : FILE_EXT)

        await rename(oldPath, newPath, {})

        if (oldPath === file?.path && project?.path) {
          // If we just renamed the current file, navigate to the new path
          navigate(paths.FILE + '/' + encodeURIComponent(newPath))
        } else if (file?.path.includes(oldPath)) {
          // If we just renamed a directory that the current file is in, navigate to the new path
          navigate(
            paths.FILE +
              '/' +
              encodeURIComponent(file.path.replace(oldPath, newDirPath))
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
          await remove(event.data.path, {
            recursive: true,
          }).catch((e) => console.error('Error deleting directory', e))
        } else {
          await remove(event.data.path).catch((e) =>
            console.error('Error deleting file', e)
          )
        }

        // If we just deleted the current file or one of its parent directories,
        // navigate to the project root
        if (
          (event.data.path === file?.path ||
            file?.path.includes(event.data.path)) &&
          project?.path
        ) {
          navigate(paths.FILE + '/' + encodeURIComponent(project.file.path))
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

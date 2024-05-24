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
import { isTauri } from 'lib/isTauri'
import { join, sep } from '@tauri-apps/api/path'
import { DEFAULT_FILE_NAME, FILE_EXT } from 'lib/constants'
import { getProjectInfo } from 'lib/tauri'

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
              context.selectedDirectory + sep() + event.data.name
            )}`
          )
        }
      },
      addFileToRenamingQueue: assign({
        itemsBeingRenamed: (context, event) => [
          ...context.itemsBeingRenamed,
          event.data.match(`^Successfully created "(.*)"$`)![1],
        ],
      }),
      removeFileFromRenamingQueue: assign({
        itemsBeingRenamed: (context, event) =>
          'data' in event && typeof event.data === 'string'
            ? context.itemsBeingRenamed.filter(
                (item) =>
                  item !==
                  (event.data as string).match(
                    `^Successfully renamed ".*" to "(.*)"$`
                  )![1]
              )
            : context.itemsBeingRenamed,
      }),
      renameToastSuccess: (_, event) =>
        event.data &&
        event.data instanceof Object &&
        'message' in event.data &&
        typeof event.data.message === 'string' &&
        toast.success(event.data.message),
      toastSuccess: (_, event) =>
        event.data && toast.success((event.data || '') + ''),
      toastError: (_, event) => toast.error((event.data || '') + ''),
    },
    services: {
      readFiles: async (context: ContextFrom<typeof fileMachine>) => {
        const newFiles = isTauri()
          ? (await getProjectInfo(context.project.path)).children
          : []
        return {
          ...context.project,
          children: newFiles,
        }
      },
      createFile: async (context, event) => {
        let name = event.data.name.trim() || DEFAULT_FILE_NAME

        if (event.data.makeDir) {
          await mkdir(await join(context.selectedDirectory.path, name))
        } else {
          await create(
            context.selectedDirectory.path +
              sep() +
              name +
              (name.endsWith(FILE_EXT) ? '' : FILE_EXT)
          )
        }

        return `Successfully created "${name}"`
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
          message:
            oldName !== name &&
            `Successfully renamed "${oldName}" to "${name}"`,
          path: newPath,
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

        // If we just deleted the current file, navigate to the project root
        if (event.data.path === file?.path && project?.path) {
          navigate(paths.FILE + '/' + encodeURIComponent(project.path))
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

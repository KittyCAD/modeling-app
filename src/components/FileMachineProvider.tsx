import { useMachine } from '@xstate/react'
import { useNavigate, useRouteLoaderData } from 'react-router-dom'
import { IndexLoaderData, paths } from '../Router'
import React, { createContext } from 'react'
import { toast } from 'react-hot-toast'
import {
  AnyStateMachine,
  ContextFrom,
  EventFrom,
  InterpreterFrom,
  Prop,
  StateFrom,
} from 'xstate'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { DEFAULT_FILE_NAME, fileMachine } from 'machines/fileMachine'
import {
  createDir,
  removeDir,
  removeFile,
  renameFile,
  writeFile,
} from '@tauri-apps/api/fs'
import { FILE_EXT, readProject } from 'lib/tauriFS'
import { isTauri } from 'lib/isTauri'
import { sep } from '@tauri-apps/api/path'

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
  const { setCommandBarOpen } = useCommandsContext()
  const { project } = useRouteLoaderData(paths.FILE) as IndexLoaderData

  const [state, send] = useMachine(fileMachine, {
    context: {
      project,
      selectedDirectory: project,
    },
    actions: {
      navigateToFile: (
        context: ContextFrom<typeof fileMachine>,
        event: EventFrom<typeof fileMachine>
      ) => {
        if (event.data && 'name' in event.data) {
          setCommandBarOpen(false)
          navigate(
            `${paths.FILE}/${encodeURIComponent(
              context.selectedDirectory + sep + event.data.name
            )}`
          )
        }
      },
      toastSuccess: (_, event) =>
        event.data && toast.success((event.data || '') + ''),
      toastError: (_, event) => toast.error((event.data || '') + ''),
    },
    services: {
      readFiles: async (context: ContextFrom<typeof fileMachine>) => {
        const newFiles = isTauri()
          ? await readProject(context.project.path)
          : []
        return {
          ...context.project,
          children: newFiles,
        }
      },
      createFile: async (
        context: ContextFrom<typeof fileMachine>,
        event: EventFrom<typeof fileMachine, 'Create file'>
      ) => {
        let name = event.data.name.trim() || DEFAULT_FILE_NAME

        if (event.data.makeDir) {
          await createDir(context.selectedDirectory.path + sep + name)
        } else {
          await writeFile(
            context.selectedDirectory.path +
              sep +
              name +
              (name.endsWith(FILE_EXT) ? '' : FILE_EXT),
            ''
          )
        }

        return `Successfully created "${name}"`
      },
      renameFile: async (
        context: ContextFrom<typeof fileMachine>,
        event: EventFrom<typeof fileMachine, 'Rename file'>
      ) => {
        const { oldName, newName, isDir } = event.data
        let name = newName ? newName : DEFAULT_FILE_NAME

        await renameFile(
          context.selectedDirectory.path + sep + oldName,
          context.selectedDirectory.path +
            sep +
            name +
            (name.endsWith(FILE_EXT) || isDir ? '' : FILE_EXT)
        )
        return (
          oldName !== name && `Successfully renamed "${oldName}" to "${name}"`
        )
      },
      deleteFile: async (
        context: ContextFrom<typeof fileMachine>,
        event: EventFrom<typeof fileMachine, 'Delete file'>
      ) => {
        const isDir = !!event.data.children

        if (isDir) {
          await removeDir(event.data.path, {
            recursive: true,
          }).catch((e) => console.error('Error deleting directory', e))
        } else {
          await removeFile(event.data.path).catch((e) =>
            console.error('Error deleting file', e)
          )
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

import { type MlToolResult } from '@kittycad/lib'
import { useApp } from '@src/lib/boot'
import type { FileEntry } from '@src/lib/project'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { type MlEphantManagerActor } from '@src/machines/mlEphantManagerMachine'
import {
  type RequestedKCLFileDelete,
  type SystemIOActor,
  SystemIOMachineEvents,
} from '@src/machines/systemIO/utils'
import type { ConnectionManager } from '@src/network/connectionManager'
import { useSelector } from '@xstate/react'
import { useEffect } from 'react'
import { NIL as uuidNIL } from 'uuid'

export const useRequestedProjectName = () => {
  const { systemIOActor } = useApp()
  return useSelector(
    systemIOActor,
    (state) => state.context.requestedProjectName
  )
}
export const useRequestedFileName = () => {
  const { systemIOActor } = useApp()
  return useSelector(systemIOActor, (state) => state.context.requestedFileName)
}
export const useProjectDirectoryPath = () => {
  const { systemIOActor } = useApp()
  return useSelector(
    systemIOActor,
    (state) => state.context.projectDirectoryPath
  )
}
export const useFolders = () => {
  const { systemIOActor } = useApp()
  return useSelector(systemIOActor, (state) => state.context.folders)
}
export const useState = () => {
  const { systemIOActor } = useApp()
  return useSelector(systemIOActor, (state) => state)
}
export const useCanReadWriteProjectDirectory = () => {
  const { systemIOActor } = useApp()
  return useSelector(
    systemIOActor,
    (state) => state.context.canReadWriteProjectDirectory
  )
}
export const useHasListedProjects = () => {
  const { systemIOActor } = useApp()
  return useSelector(systemIOActor, (state) => state.context.hasListedProjects)
}

export const useLastOperation = () => {
  const { systemIOActor } = useApp()
  return useSelector(systemIOActor, (state) => state.context.lastOperation)
}

export const useClearURLParams = () => {
  const { systemIOActor } = useApp()
  return useSelector(systemIOActor, (state) => state.context.clearURLParams)
}

export const useProjectIdToConversationId = (
  mlEphantManagerActor: MlEphantManagerActor,
  systemIOActor: SystemIOActor,
  settings2: SettingsType
) => {
  useEffect(() => {
    let lastConversationId =
      mlEphantManagerActor.getSnapshot().context.conversationId
    const subscription = mlEphantManagerActor.subscribe((next) => {
      if (settings2.meta.id.current === undefined) {
        return
      }
      if (settings2.meta.id.current === uuidNIL) {
        return
      }
      if (next.context.conversationId === undefined) {
        return
      }
      if (lastConversationId === next.context.conversationId) {
        return
      }

      lastConversationId = next.context.conversationId

      systemIOActor.send({
        type: SystemIOMachineEvents.saveMlEphantConversations,
        data: {
          projectId: settings2.meta.id.current,
          conversationId: next.context.conversationId,
        },
      })
    })

    return () => {
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [settings2.meta.id.current])
}

export interface MlEphantNewFileRequestProps {
  toolOutput: MlToolResult
  projectNameCurrentlyOpened: string
  fileFocusedOnInEditor?: FileEntry
  filesToDelete?: RequestedKCLFileDelete[]
  exchangeId?: number
}

// Watch MlEphant for any responses that require files to be created.
export const useWatchForNewFileRequestsFromMlEphant = (
  mlEphantManagerActor: MlEphantManagerActor,
  engineCommandManager: ConnectionManager,
  fn: (props: MlEphantNewFileRequestProps) => void
) => {
  useEffect(() => {
    let lastId: number | undefined = undefined
    const subscription = mlEphantManagerActor.subscribe((next) => {
      if (next.context.lastMessageId === lastId) return
      lastId = next.context.lastMessageId

      if (next.context.lastMessageType === 'delta') return

      const exchanges = next.context.conversation?.exchanges ?? []
      const lastExchange = exchanges[exchanges.length - 1]
      if (lastExchange === undefined) return
      const lastResponse = (lastExchange.responses ?? []).slice(-1)[0] ?? {}
      if (!('tool_output' in lastResponse)) return

      // We don't know what project to write to, so do nothing.
      if (!next.context.projectNameCurrentlyOpened) return

      const fileNamesToDelete = new Set(
        lastExchange.responses.flatMap((response) => {
          if (!('reasoning' in response)) {
            return []
          }
          if (response.reasoning.type !== 'deleted_kcl_file') {
            return []
          }
          return response.reasoning.file_name
        })
      )

      fn({
        toolOutput: lastResponse.tool_output.result,
        projectNameCurrentlyOpened: next.context.projectNameCurrentlyOpened,
        fileFocusedOnInEditor: next.context.fileFocusedOnInEditor,
        filesToDelete: Array.from(fileNamesToDelete, (requestedFileName) => ({
          requestedFileName,
        })),
        exchangeId: exchanges.length - 1,
      })

      // Clear selections since new model
      engineCommandManager.modelingSend({
        type: 'Set selection',
        data: { selection: undefined, selectionType: 'singleCodeCursor' },
      })
    })

    return () => {
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])
}

import type { MlToolResult } from '@kittycad/lib'
import { useApp } from '@src/lib/boot'
import type { FileEntry } from '@src/lib/project'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import {
  type BillingActor,
  BillingTransition,
} from '@src/machines/billingMachine'
import type { MlEphantManagerActor } from '@src/machines/mlEphantManagerMachine'
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: This hook intentionally manages a long-lived actor subscription.
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
}

type MlEphantConversation = NonNullable<
  ReturnType<MlEphantManagerActor['getSnapshot']>['context']['conversation']
>
type MlEphantExchange = MlEphantConversation['exchanges'][number]

export interface MlEphantToolOutputRequest {
  toolOutput: MlToolResult
  filesToDelete: RequestedKCLFileDelete[]
}

export const collectMlEphantToolOutputRequests = (
  exchanges: MlEphantExchange[]
): MlEphantToolOutputRequest[] =>
  exchanges.flatMap((exchange) => {
    const fileNamesToDelete = new Set(
      exchange.responses.flatMap((response) => {
        if (!('reasoning' in response)) {
          return []
        }
        if (response.reasoning.type !== 'deleted_kcl_file') {
          return []
        }
        return response.reasoning.file_name
      })
    )
    const filesToDelete = Array.from(
      fileNamesToDelete,
      (requestedFileName) => ({
        requestedFileName,
      })
    )

    return exchange.responses.flatMap((response) => {
      if (!('tool_output' in response)) {
        return []
      }

      return [
        {
          toolOutput: response.tool_output.result,
          filesToDelete,
        },
      ]
    })
  })

// Watch MlEphant for any responses that require files to be created.
export const useWatchForNewFileRequestsFromMlEphant = (
  mlEphantManagerActor: MlEphantManagerActor,
  billingActor: BillingActor,
  token: string,
  engineCommandManager: ConnectionManager,
  fn: (props: MlEphantNewFileRequestProps) => void
) => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: This hook intentionally manages a long-lived actor subscription.
  useEffect(() => {
    let handledToolOutputCount = collectMlEphantToolOutputRequests(
      mlEphantManagerActor.getSnapshot().context.conversation?.exchanges ?? []
    ).length

    const subscription = mlEphantManagerActor.subscribe((next) => {
      const exchanges = next.context.conversation?.exchanges ?? []
      const toolOutputRequests = collectMlEphantToolOutputRequests(exchanges)
      if (toolOutputRequests.length < handledToolOutputCount) {
        handledToolOutputCount = 0
      }

      const newToolOutputRequests = toolOutputRequests.slice(
        handledToolOutputCount
      )
      if (newToolOutputRequests.length === 0) {
        return
      }

      // We don't know what project to write to, so do nothing.
      const projectNameCurrentlyOpened = next.context.projectNameCurrentlyOpened
      if (!projectNameCurrentlyOpened) {
        return
      }
      handledToolOutputCount = toolOutputRequests.length

      for (const { toolOutput, filesToDelete } of newToolOutputRequests) {
        fn({
          toolOutput,
          projectNameCurrentlyOpened,
          fileFocusedOnInEditor: next.context.fileFocusedOnInEditor,
          filesToDelete,
        })

        // TODO: Move elsewhere eventually, decouple from SystemIOActor
        billingActor.send({
          type: BillingTransition.Update,
          apiToken: token,
        })

        // Clear selections since new model
        engineCommandManager.modelingSend({
          type: 'Set selection',
          data: { selection: undefined, selectionType: 'singleCodeCursor' },
        })
      }
    })

    return () => {
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])
}

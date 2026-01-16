import type { FileEntry } from '@src/lib/project'
import { type MlToolResult } from '@kittycad/lib'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { SystemIOActor } from '@src/lib/singletons'
import { systemIOActor } from '@src/lib/singletons'
import { type MlEphantManagerActor } from '@src/machines/mlEphantManagerMachine'
import {
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import { useSelector } from '@xstate/react'
import { useEffect } from 'react'
import { NIL as uuidNIL } from 'uuid'
import {
  type BillingActor,
  BillingTransition,
} from '@src/machines/billingMachine'
import type { ConnectionManager } from '@src/network/connectionManager'

export const useRequestedProjectName = () =>
  useSelector(systemIOActor, (state) => state.context.requestedProjectName)
export const useRequestedFileName = () =>
  useSelector(systemIOActor, (state) => state.context.requestedFileName)
export const useProjectDirectoryPath = () =>
  useSelector(systemIOActor, (state) => state.context.projectDirectoryPath)
export const useFolders = () =>
  useSelector(systemIOActor, (state) => state.context.folders)
export const useState = () => useSelector(systemIOActor, (state) => state)
export const useCanReadWriteProjectDirectory = () =>
  useSelector(
    systemIOActor,
    (state) => state.context.canReadWriteProjectDirectory
  )
export const useHasListedProjects = () =>
  useSelector(systemIOActor, (state) => state.context.hasListedProjects)

export const useClearURLParams = () =>
  useSelector(systemIOActor, (state) => state.context.clearURLParams)

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
      const systemIOActorSnapshot = systemIOActor.getSnapshot()
      if (
        systemIOActorSnapshot.value ===
        SystemIOMachineStates.savingMlEphantConversations
      ) {
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

// Watch MlEphant for any responses that require files to be created.
export const useWatchForNewFileRequestsFromMlEphant = (
  mlEphantManagerActor: MlEphantManagerActor,
  billingActor: BillingActor,
  token: string,
  engineCommandManager: ConnectionManager,
  fn: (
    toolOutputTextToCad: MlToolResult,
    projectNameCurrentlyOpened: string,
    fileFocusedOnInEditor?: FileEntry
  ) => void
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

      fn(
        lastResponse.tool_output.result,
        next.context.projectNameCurrentlyOpened,
        next.context.fileFocusedOnInEditor
      )

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
    })

    return () => {
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])
}

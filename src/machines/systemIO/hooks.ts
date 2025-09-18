import { type MlToolResult } from '@kittycad/lib'
import type { Prompt } from '@src/lib/prompt'
import { type settings } from '@src/lib/settings/initialSettings'
import type { SystemIOActor } from '@src/lib/singletons'
import { systemIOActor } from '@src/lib/singletons'
import type { BillingActor } from '@src/machines/billingMachine'
import { BillingTransition } from '@src/machines/billingMachine'
import type {
  MlEphantManagerActor,
  PromptMeta,
} from '@src/machines/mlEphantManagerMachine'
import {
  MlEphantManagerStates,
  MlEphantManagerTransitions,
} from '@src/machines/mlEphantManagerMachine'
import {
  type MlEphantManagerActor2,
  MlEphantManagerTransitions2,
} from '@src/machines/mlEphantManagerMachine2'
import {
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import { S } from '@src/machines/utils'
import { useSelector } from '@xstate/react'
import { useEffect } from 'react'
import { NIL as uuidNIL } from 'uuid'

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

export const useRequestedTextToCadGeneration = () =>
  useSelector(
    systemIOActor,
    (state) => state.context.requestedTextToCadGeneration
  )

export const useProjectIdToConversationId = (
  mlEphantManagerActor: MlEphantManagerActor,
  mlEphantManagerActor2: MlEphantManagerActor2,
  systemIOActor: SystemIOActor,
  settings2: typeof settings
) => {
  useEffect(() => {
    // If the project id changes at all, we need to clear the mlephant machine state.
    mlEphantManagerActor.send({
      type: MlEphantManagerTransitions.ClearProjectSpecificState,
    })
    mlEphantManagerActor2.send({
      type: MlEphantManagerTransitions2.ContextNew,
    })

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
      systemIOActor.send({
        type: SystemIOMachineEvents.saveMlEphantConversations,
        data: {
          projectId: settings2.meta.id.current,
          conversationId: next.context.conversationId,
        },
      })
    })

    const subscription2 = mlEphantManagerActor.subscribe((next) => {
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
      subscription2.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [settings2.meta.id.current])
}

// Watch MlEphant for any responses that require files to be created.
export const useWatchForNewFileRequestsFromMlEphant = (
  mlEphantManagerActor: MlEphantManagerActor,
  mlEphantManagerActor2: MlEphantManagerActor2,
  billingActor: BillingActor,
  token: string,
  fn: (prompt: Prompt, promptMeta: PromptMeta) => void,
  fn2: (toolOutputTextToCad: MlToolResult) => void,
) => {
  useEffect(() => {
    const subscription = mlEphantManagerActor.subscribe((next) => {
      if (next.context.promptsInProgressToCompleted.size === 0) {
        return
      }
      if (
        !next.matches({
          [MlEphantManagerStates.Ready]: {
            [MlEphantManagerStates.Background]: S.Await,
          },
        })
      ) {
        return
      }

      next.context.promptsInProgressToCompleted.forEach(
        (promptId: Prompt['id']) => {
          const prompt = next.context.promptsPool.get(promptId)
          if (prompt === undefined) return
          if (prompt.status === 'failed') return
          const promptMeta = next.context.promptsMeta.get(prompt.id)
          if (promptMeta === undefined) {
            console.warn('No metadata for this prompt - ignoring.')
            return
          }

          fn(prompt, promptMeta)
        }
      )

      // TODO: Move elsewhere eventually, decouple from SystemIOActor
      billingActor.send({
        type: BillingTransition.Update,
        apiToken: token,
      })
    })

    let lastId: number | undefined = undefined
    const subscription2 = mlEphantManagerActor2.subscribe((next) => {
      if (next.context.lastMessageId === lastId) return
      const exchanges = (next.context.conversation?.exchanges ?? [])
      const lastExchange = exchanges[exchanges.length - 1]
      if (lastExchange === undefined) return
      const lastResponse = (lastExchange.responses ?? [])[0] ?? {}
      if (!('tool_output' in lastResponse)) return

      fn2(lastResponse.tool_output.result)
    })

    return () => {
      subscription.unsubscribe()
      subscription2.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])
}

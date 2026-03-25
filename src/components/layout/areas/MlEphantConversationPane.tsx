import { reportRejection } from '@src/lib/trap'
import { NIL as uuidNIL } from 'uuid'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { KclManager } from '@src/lang/KclManager'
import { useEffect, useState, useRef, useCallback } from 'react'
import {
  type SystemIOActor,
  SystemIOMachineEvents,
} from '@src/machines/systemIO/utils'
import {
  MlEphantConversation,
  type QueuedMessage,
} from '@src/components/MlEphantConversation'
import type { MlEphantManagerActor } from '@src/machines/mlEphantManagerMachine'
import {
  MlEphantManagerStates,
  MlEphantManagerTransitions,
} from '@src/machines/mlEphantManagerMachine'
import { collectProjectFiles } from '@src/machines/systemIO/utils'
import { S } from '@src/machines/utils'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'
import type { FileEntry, Project } from '@src/lib/project'
import { useSelector } from '@xstate/react'
import type { MlCopilotMode } from '@kittycad/lib'
import { useSearchParams } from 'react-router-dom'
import { SEARCH_PARAM_ML_PROMPT_KEY } from '@src/lib/constants'
import { type useModelingContext } from '@src/hooks/useModelingContext'
import type { SnapshotFrom } from 'xstate'

type MlEphantConversationPaneUser = {
  block_message?: string
  image?: string
}

// Defined outside of React o prevent rerenders
const awaitingResponseSelector = (
  snapshot: SnapshotFrom<MlEphantManagerActor>
) => snapshot.context.awaitingResponse

export const MlEphantConversationPane = (props: {
  mlEphantManagerActor: MlEphantManagerActor
  systemIOActor: SystemIOActor
  kclManager: KclManager
  theProject: Project | undefined
  contextModeling: ModelingMachineContext
  sendModeling: ReturnType<typeof useModelingContext>['send']
  sendBillingUpdate: () => void
  loaderFile: FileEntry | undefined
  settings: SettingsType
  user?: MlEphantConversationPaneUser
  onMlCopilotModeChange?: (mode: MlCopilotMode) => void
}) => {
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const timeoutReconnect = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const isSubmittingFromQueue = useRef(false)
  const steeredId = useRef<string | null>(null)

  let conversation = useSelector(props.mlEphantManagerActor, (actor) => {
    return actor.context.conversation
  })

  const abruptlyClosed = useSelector(props.mlEphantManagerActor, (actor) => {
    return actor.context.abruptlyClosed
  })

  const isPromptRunning = useSelector(
    props.mlEphantManagerActor,
    awaitingResponseSelector
  )

  if (
    props.mlEphantManagerActor.getSnapshot().matches(S.Await) &&
    !abruptlyClosed
  ) {
    conversation = undefined
  }

  const onProcess = async (
    request: string,
    mode: MlCopilotMode,
    attachments: File[]
  ) => {
    if (props.theProject === undefined) {
      console.warn('theProject is `undefined` - should not be possible')
      return
    }
    if (props.loaderFile === undefined) {
      console.warn('loaderFile is `undefined` - should not be possible')
      return
    }

    let project: Project = props.theProject

    const projectFiles = await collectProjectFiles({
      selectedFileContents: props.kclManager.code,
      fileNames: props.kclManager.execState.filenames,
      projectContext: project,
    })

    // Only on initial project creation do we call the create endpoint, which
    // has more data for initial creations. Improvements to the TTC service
    // will close this gap in performance.
    props.mlEphantManagerActor.send({
      type: MlEphantManagerTransitions.MessageSend,
      prompt: request,
      projectForPromptOutput: project,
      applicationProjectDirectory: props.settings.app.projectDirectory.current,
      fileSelectedDuringPrompting: {
        entry: props.loaderFile,
        content: props.kclManager.code,
      },
      projectFiles,
      selections: props.contextModeling.selectionRanges,
      artifactGraph: props.kclManager.artifactGraph,
      mode,
      sketch_solve: props.settings.modeling.useSketchSolveMode?.current,
      additionalFiles: attachments,
    })

    props.sendBillingUpdate()
  }

  const needsReconnect = abruptlyClosed

  const onReconnect = () => {
    props.mlEphantManagerActor.send({
      type: MlEphantManagerTransitions.CacheSetupAndConnect,
      refParentSend: props.mlEphantManagerActor.send,
      conversationId:
        props.mlEphantManagerActor.getSnapshot().context.conversationId,
    })
  }

  const onCancel = () => {
    props.sendBillingUpdate()
    props.mlEphantManagerActor.send({
      type: MlEphantManagerTransitions.Cancel,
    })
  }

  const onProcessOrQueue = (
    request: string,
    mode: MlCopilotMode,
    attachments: File[]
  ) => {
    if (isPromptRunning || isSubmittingFromQueue.current) {
      setQueue((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          text: request,
          mode,
          attachments,
        },
      ])
      return
    }
    onProcess(request, mode, attachments).catch(reportRejection)
  }

  const onRemoveFromQueue = useCallback((id: string) => {
    if (steeredId.current === id) {
      steeredId.current = null
    }
    setQueue((prev) => prev.filter((msg) => msg.id !== id))
  }, [])

  const { sendBillingUpdate, mlEphantManagerActor } = props
  const onSteer = useCallback(
    (id: string) => {
      // Mark the message to be processed next without reordering the queue.
      // The queue will be updated when Zookeeper finishes the current message
      // and the auto-submit effect picks up the steered message.
      steeredId.current = id
      // Interrupt the current prompt; when the response completes,
      // the auto-submit effect sends the steered message.
      sendBillingUpdate()
      mlEphantManagerActor.send({
        type: MlEphantManagerTransitions.Interrupt,
      })
    },
    [mlEphantManagerActor, sendBillingUpdate]
  )

  // Auto-submit the next queued message when current processing completes.
  // If a message was steered, it takes priority over the default FIFO order.
  useEffect(() => {
    if (
      !isPromptRunning &&
      queue.length > 0 &&
      !isSubmittingFromQueue.current
    ) {
      isSubmittingFromQueue.current = true
      let next: QueuedMessage
      if (steeredId.current !== null) {
        const id = steeredId.current
        steeredId.current = null
        const index = queue.findIndex((msg) => msg.id === id)
        if (index !== -1) {
          next = queue[index]
          setQueue((prev) => prev.filter((msg) => msg.id !== id))
        } else {
          // Steered message was removed from queue; fall back to FIFO
          next = queue[0]
          setQueue((prev) => prev.slice(1))
        }
      } else {
        next = queue[0]
        setQueue((prev) => prev.slice(1))
      }
      onProcess(next.text, next.mode, next.attachments)
        .catch(reportRejection)
        .finally(() => {
          isSubmittingFromQueue.current = false
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPromptRunning, queue])

  if (needsReconnect && timeoutReconnect.current === undefined) {
    timeoutReconnect.current = setTimeout(() => {
      onReconnect()
      timeoutReconnect.current = undefined
    }, 3000)
  }

  const onClickClearChat = () => {
    steeredId.current = null
    setQueue([])
    props.mlEphantManagerActor.send({
      type: MlEphantManagerTransitions.ConversationClose,
    })
    const sub = props.mlEphantManagerActor.subscribe((next) => {
      if (!next.matches(S.Await)) {
        return
      }

      props.mlEphantManagerActor.send({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        refParentSend: props.mlEphantManagerActor.send,
        conversationId: undefined,
      })
      sub.unsubscribe()
    })
  }

  const tryToGetExchanges = () => {
    const mlEphantConversations =
      props.systemIOActor.getSnapshot().context.mlEphantConversations

    // Not ready yet.
    if (mlEphantConversations === undefined) {
      return
    }
    if (props.settings.meta.id.current === uuidNIL) {
      return
    }

    const conversationId = mlEphantConversations.get(
      props.settings.meta.id.current
    )

    if (conversationId === uuidNIL) {
      return
    }

    // We can now reliably use the mlConversations data.
    // THIS IS WHERE PROJECT IDS ARE MAPPED TO CONVERSATION IDS.
    if (
      props.theProject !== undefined &&
      props.mlEphantManagerActor.getSnapshot().context.abruptlyClosed === false
    ) {
      props.mlEphantManagerActor.send({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        refParentSend: props.mlEphantManagerActor.send,
        conversationId,
      })
    }
  }

  useEffect(() => {
    const subscriptionSystemIOActor = props.systemIOActor.subscribe(
      (systemIOActorSnapshot) => {
        if (systemIOActorSnapshot.value !== 'idle') {
          return
        }
        if (props.settings.meta.id.current === uuidNIL) {
          return
        }
        if (systemIOActorSnapshot.context.mlEphantConversations === undefined) {
          props.systemIOActor.send({
            type: SystemIOMachineEvents.getMlEphantConversations,
          })
          return
        }

        const { context } = props.mlEphantManagerActor.getSnapshot()

        if (context.conversation !== undefined) {
          return
        }

        tryToGetExchanges()
      }
    )

    const subscriptionMlEphantManagerActor =
      props.mlEphantManagerActor.subscribe((mlEphantManagerActorSnapshot) => {
        const isProcessing =
          (mlEphantManagerActorSnapshot.matches({
            [MlEphantManagerStates.Ready]: {
              [MlEphantManagerStates.Request]: S.Await,
            },
          }) || mlEphantManagerActorSnapshot.value === S.Await) === false

        const { context } = mlEphantManagerActorSnapshot

        if (
          mlEphantManagerActorSnapshot.matches(
            MlEphantManagerStates.WaitForContinueCheck
          ) &&
          props.theProject !== undefined
        ) {
          let project: Project = props.theProject

          void collectProjectFiles({
            selectedFileContents: props.kclManager.code,
            fileNames: props.kclManager.execState.filenames,
            projectContext: project,
          }).then((projectFiles) => {
            props.mlEphantManagerActor.send({
              type: MlEphantManagerStates.ContinueCheck,
              projectName: project.name,
              projectFiles,
            })
          })
          return
        }

        if (isProcessing) {
          return
        }

        // End of processing, trigger a billing update
        props.sendBillingUpdate()

        if (context.conversation !== undefined) {
          return
        }

        tryToGetExchanges()
      })

    props.systemIOActor.send({
      type: SystemIOMachineEvents.getMlEphantConversations,
    })

    tryToGetExchanges()

    return () => {
      subscriptionSystemIOActor.unsubscribe()
      subscriptionMlEphantManagerActor.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [props.settings.meta.id.current])

  // We watch the URL for a query parameter to set the defaultPrompt
  // for the conversation.
  useEffect(() => {
    const ttcPromptParam = searchParams.get(SEARCH_PARAM_ML_PROMPT_KEY)
    if (ttcPromptParam) {
      setDefaultPrompt(ttcPromptParam)

      // Now clear that param
      const newSearchParams = new URLSearchParams(searchParams)
      newSearchParams.delete(SEARCH_PARAM_ML_PROMPT_KEY)
      setSearchParams(newSearchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const userBlockedOnPaymentReason = props.user?.block_message

  return (
    <MlEphantConversation
      isLoading={conversation === undefined}
      contexts={[
        { type: 'selections', data: props.contextModeling.selectionRanges },
      ]}
      conversation={conversation}
      onProcess={(
        request: string,
        mode: MlCopilotMode,
        attachments: File[]
      ) => {
        onProcessOrQueue(request, mode, attachments)
      }}
      onClickClearChat={onClickClearChat}
      onReconnect={onReconnect}
      onCancel={onCancel}
      disabled={needsReconnect}
      needsReconnect={needsReconnect}
      hasPromptCompleted={!isPromptRunning}
      isProcessing={isPromptRunning}
      queue={queue}
      onRemoveFromQueue={onRemoveFromQueue}
      onSteer={onSteer}
      userAvatarSrc={props.user?.image}
      blockedReason={userBlockedOnPaymentReason}
      defaultPrompt={defaultPrompt}
      initialMlCopilotMode={props.settings.app.zookeeperMode.current}
      onMlCopilotModeChange={props.onMlCopilotModeChange}
    />
  )
}

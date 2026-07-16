import {
  ZookeeperConversation,
  type QueuedMessage,
} from '@src/lib/zookeeper/components/ZookeeperConversation'
import { ZookeeperConversationWelcome } from '@src/lib/zookeeper/components/ZookeeperConversationWelcome'
import type { useModelingContext } from '@src/hooks/useModelingContext'
import type { KclManager } from '@src/lang/KclManager'
import {
  LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
  SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
} from '@src/lib/constants'
import type { FileEntry, Project } from '@src/lib/project'
import { activeFileRelativeToProject } from '@src/lib/promptToEdit'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { reportRejection } from '@src/lib/trap'
import type { ZookeeperConversationStore } from '@src/lib/zookeeper/zookeeperConversationStore'
import type { ZookeeperManagerActor } from '@src/lib/zookeeper/zookeeperManagerMachine'
import {
  ZookeeperManagerStates,
  ZookeeperManagerTransitions,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import type { MlCopilotModeId } from '@src/lib/zookeeper/zookeeperManagerMachine'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'
import { collectProjectFiles } from '@src/machines/systemIO/utils'
import { S } from '@src/machines/utils'
import { useSelector } from '@xstate/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { NIL as uuidNIL } from 'uuid'
import type { SnapshotFrom } from 'xstate'

type ZookeeperConversationPaneUser = {
  block_message?: string
  image?: string
}

// Defined outside of React o prevent rerenders
const awaitingResponseSelector = (
  snapshot: SnapshotFrom<ZookeeperManagerActor>
) => snapshot.context.awaitingResponse

export const ZookeeperConversationPane = (props: {
  zookeeperManagerActor: ZookeeperManagerActor
  conversationStore: ZookeeperConversationStore
  kclManager: KclManager
  theProject: Project | undefined
  contextModeling: ModelingMachineContext
  sendModeling: ReturnType<typeof useModelingContext>['send']
  sendBillingUpdate: () => void
  sendBillingUsageStarted: () => void
  sendBillingUsageEnded: () => void
  loaderFile: FileEntry | undefined
  settings: SettingsType
  user?: ZookeeperConversationPaneUser
  showMakeathonAnnouncement?: boolean
  onMlCopilotModeChange?: (mode: MlCopilotModeId | undefined) => void
}) => {
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const timeoutReconnect = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const isSubmittingFromQueue = useRef(false)
  const isClearingChat = useRef(false)
  const steeredId = useRef<string | null>(null)
  const savedProjectConversationLookupLoaded = useRef(false)
  const savedProjectConversationId = useRef<string | undefined>(undefined)
  const loaderFileRef = useRef(props.loaderFile)
  useEffect(() => {
    loaderFileRef.current = props.loaderFile
  })

  let conversation = useSelector(props.zookeeperManagerActor, (actor) => {
    return actor.context.conversation
  })

  const abruptlyClosed = useSelector(props.zookeeperManagerActor, (actor) => {
    return actor.context.abruptlyClosed
  })

  const isPromptRunning = useSelector(
    props.zookeeperManagerActor,
    awaitingResponseSelector
  )
  const modeOptions = useSelector(props.zookeeperManagerActor, (actor) => {
    return actor.context.modeOptions
  })
  const attachmentsLoadedForCurrentPrompt = useSelector(
    props.zookeeperManagerActor,
    (actor) => actor.context.attachmentsLoadedForCurrentPrompt
  )
  const defaultMode = useSelector(props.zookeeperManagerActor, (actor) => {
    return actor.context.defaultMode
  })
  const initialMlCopilotMode =
    props.settings.app.zookeeperMode.project ??
    props.settings.app.zookeeperMode.user ??
    defaultMode

  if (
    props.zookeeperManagerActor.getSnapshot().matches(S.Await) &&
    !abruptlyClosed
  ) {
    conversation = undefined
  }

  const onProcess = async (
    request: string,
    mode: MlCopilotModeId | undefined,
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

    const project: Project = props.theProject

    const projectFiles = await collectProjectFiles({
      selectedFileContents: props.kclManager.code,
      selectedFilePath: props.kclManager.path,
      fileNames: props.kclManager.execState.filenames,
      projectContext: project,
    })

    // Only on initial project creation do we call the create endpoint, which
    // has more data for initial creations. Improvements to the Zookeeper service
    // will close this gap in performance.
    props.zookeeperManagerActor.send({
      type: ZookeeperManagerTransitions.MessageSend,
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
      additionalFiles: attachments,
    })
  }

  const needsReconnect = abruptlyClosed

  const onReconnect = () => {
    props.zookeeperManagerActor.send({
      type: ZookeeperManagerTransitions.CacheSetupAndConnect,
      refParentSend: props.zookeeperManagerActor.send,
      conversationId:
        props.zookeeperManagerActor.getSnapshot().context.conversationId,
    })
  }

  const onCancel = () => {
    props.zookeeperManagerActor.send({
      type: ZookeeperManagerTransitions.Cancel,
    })
  }

  const onProcessOrQueue = (
    request: string,
    mode: MlCopilotModeId | undefined,
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

  const {
    sendBillingUpdate,
    sendBillingUsageEnded,
    sendBillingUsageStarted,
    zookeeperManagerActor,
  } = props
  const onSteer = useCallback(
    (id: string) => {
      // Mark the message to be processed next without reordering the queue.
      // The queue will be updated when Zookeeper finishes the current message
      // and the auto-submit effect picks up the steered message.
      steeredId.current = id
      // Interrupt the current prompt; when the response completes,
      // the auto-submit effect sends the steered message.
      zookeeperManagerActor.send({
        type: ZookeeperManagerTransitions.Interrupt,
      })
    },
    [zookeeperManagerActor]
  )

  // Auto-submit the next queued message when current processing completes.
  // If a message was steered, it takes priority over the default FIFO order.
  // biome-ignore lint/correctness/useExhaustiveDependencies: queue processing intentionally uses the queued prompt state captured by this effect.
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
    let closedConversation = props.zookeeperManagerActor
      .getSnapshot()
      .matches(S.Await)
    let clearedConversationMapping = true
    let startedFreshConversation = false
    // biome-ignore lint/style/useConst: cleanup can run through actor callbacks before subscription assignment completes.
    let sub:
      | ReturnType<typeof props.zookeeperManagerActor.subscribe>
      | undefined

    const cleanupSubscriptions = () => {
      sub?.unsubscribe()
    }

    const startFreshConversation = () => {
      if (startedFreshConversation) {
        return
      }
      startedFreshConversation = true
      props.zookeeperManagerActor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: props.zookeeperManagerActor.send,
        conversationId: undefined,
      })
      cleanupSubscriptions()
    }

    const maybeStartFreshConversation = () => {
      if (!closedConversation || !clearedConversationMapping) {
        return
      }
      startFreshConversation()
    }

    isClearingChat.current = true
    steeredId.current = null
    setQueue([])
    const projectId = props.settings.meta.id.current
    if (projectId !== undefined && projectId !== uuidNIL) {
      clearedConversationMapping = false
      void props.conversationStore
        .deleteProjectConversationId(projectId)
        .catch(reportRejection)
        .finally(() => {
          savedProjectConversationLookupLoaded.current = true
          savedProjectConversationId.current = undefined
          clearedConversationMapping = true
          maybeStartFreshConversation()
        })
    }
    sub = props.zookeeperManagerActor.subscribe((next) => {
      if (!next.matches(S.Await)) {
        return
      }

      closedConversation = true
      maybeStartFreshConversation()
    })
    props.zookeeperManagerActor.send({
      type: ZookeeperManagerTransitions.ConversationClose,
    })

    if (props.zookeeperManagerActor.getSnapshot().matches(S.Await)) {
      closedConversation = true
      maybeStartFreshConversation()
    }
  }

  const tryToGetExchanges = () => {
    if (isClearingChat.current) {
      return
    }

    if (!savedProjectConversationLookupLoaded.current) {
      return
    }
    if (props.settings.meta.id.current === uuidNIL) {
      return
    }

    const conversationId = savedProjectConversationId.current

    if (conversationId === uuidNIL) {
      return
    }

    // We can now reliably use the saved project conversation lookup.
    // THIS IS WHERE PROJECT IDS ARE MAPPED TO CONVERSATION IDS.
    if (
      props.theProject !== undefined &&
      props.zookeeperManagerActor.getSnapshot().context.abruptlyClosed === false
    ) {
      props.zookeeperManagerActor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: props.zookeeperManagerActor.send,
        conversationId,
      })
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: this actor coordination effect intentionally tracks project identity, matching the existing eslint suppression below.
  useEffect(() => {
    const subscriptionZookeeperManagerActor =
      props.zookeeperManagerActor.subscribe((zookeeperManagerActorSnapshot) => {
        const isProcessing =
          (zookeeperManagerActorSnapshot.matches({
            [ZookeeperManagerStates.Ready]: {
              [ZookeeperManagerStates.Request]: S.Await,
            },
          }) || zookeeperManagerActorSnapshot.value === S.Await) === false

        const { context } = zookeeperManagerActorSnapshot

        if (
          isClearingChat.current &&
          context.conversationId !== undefined &&
          context.conversation !== undefined
        ) {
          isClearingChat.current = false
        }

        if (
          zookeeperManagerActorSnapshot.matches(
            ZookeeperManagerStates.WaitForContinueCheck
          ) &&
          props.theProject !== undefined
        ) {
          const project: Project = props.theProject

          const currentLoaderFile = loaderFileRef.current
          void collectProjectFiles({
            selectedFileContents: props.kclManager.code,
            selectedFilePath: props.kclManager.path,
            fileNames: props.kclManager.execState.filenames,
            projectContext: project,
          }).then((projectFiles) => {
            props.zookeeperManagerActor.send({
              type: ZookeeperManagerStates.ContinueCheck,
              projectName: project.name,
              projectFiles,
              activeFile: currentLoaderFile
                ? activeFileRelativeToProject({
                    currentFileEntry: currentLoaderFile,
                    applicationProjectDirectory:
                      props.settings.app.projectDirectory.current,
                  })
                : undefined,
            })
          })
          return
        }

        if (isProcessing) {
          return
        }

        if (context.conversation !== undefined) {
          return
        }

        tryToGetExchanges()
      })

    savedProjectConversationLookupLoaded.current = false
    savedProjectConversationId.current = undefined
    const projectId = props.settings.meta.id.current
    let canceled = false
    if (projectId === undefined) {
      savedProjectConversationLookupLoaded.current = true
      tryToGetExchanges()
    } else if (projectId !== uuidNIL) {
      void props.conversationStore
        .getProjectConversationId(projectId)
        .then((conversationId) => {
          if (canceled) {
            return
          }
          savedProjectConversationLookupLoaded.current = true
          savedProjectConversationId.current = conversationId
          tryToGetExchanges()
        })
        .catch((error: unknown) => {
          if (canceled) {
            return
          }
          savedProjectConversationLookupLoaded.current = true
          savedProjectConversationId.current = undefined
          reportRejection(error)
          tryToGetExchanges()
        })
    }

    tryToGetExchanges()

    return () => {
      canceled = true
      subscriptionZookeeperManagerActor.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [props.settings.meta.id.current, props.theProject?.path])

  // We watch the URL for a query parameter to set the defaultPrompt
  // for the conversation.
  useEffect(() => {
    const zookeeperPromptParam =
      searchParams.get(SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY) ??
      searchParams.get(LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY)
    if (zookeeperPromptParam) {
      setDefaultPrompt(zookeeperPromptParam)

      // Now clear that param
      const newSearchParams = new URLSearchParams(searchParams)
      newSearchParams.delete(SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY)
      newSearchParams.delete(LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY)
      setSearchParams(newSearchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const userBlockedOnPaymentReason = props.user?.block_message
  const isLoadingAttachments =
    !attachmentsLoadedForCurrentPrompt && conversation !== undefined
  const wasPromptRunningRef = useRef(false)

  useEffect(() => {
    if (isPromptRunning === wasPromptRunningRef.current) {
      return
    }

    wasPromptRunningRef.current = isPromptRunning

    if (isPromptRunning) {
      sendBillingUsageStarted()
      return
    }

    sendBillingUsageEnded()
    sendBillingUpdate()
  }, [
    isPromptRunning,
    sendBillingUpdate,
    sendBillingUsageEnded,
    sendBillingUsageStarted,
  ])

  return (
    <ZookeeperConversation
      isLoading={conversation === undefined}
      isLoadingAttachments={isLoadingAttachments}
      contexts={[
        { type: 'selections', data: props.contextModeling.selectionRanges },
      ]}
      conversation={conversation}
      welcomeMessage={
        // Replace this local component with a remote-authored content source
        // later. `ZookeeperConversation` already handles placement and ordering.
        <ZookeeperConversationWelcome />
      }
      onProcess={(
        request: string,
        mode: MlCopilotModeId | undefined,
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
      showMakeathonAnnouncement={props.showMakeathonAnnouncement}
      blockedReason={userBlockedOnPaymentReason}
      defaultPrompt={defaultPrompt}
      initialMlCopilotMode={initialMlCopilotMode}
      onMlCopilotModeChange={props.onMlCopilotModeChange}
      modeOptions={modeOptions}
      modeScopeKey={props.theProject?.path}
    />
  )
}

import {
  ZookeeperConversation,
  type QueuedMessage,
} from '@src/lib/zookeeper/components/ZookeeperConversation'
import { ZookeeperConversationWelcome } from '@src/lib/zookeeper/components/ZookeeperConversationWelcome'
import { useOnWindowOnlineOffline } from '@src/hooks/network/useOnWindowOnlineOffline'
import type { useModelingContext } from '@src/hooks/useModelingContext'
import type { KclManager } from '@src/lang/KclManager'
import {
  LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
  SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
} from '@src/lib/constants'
import { getParentAbsolutePath } from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { reportRejection, trap } from '@src/lib/trap'
import { activeFileRelativeToProject } from '@src/lib/zookeeper/zookeeperPromptRequest'
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const isSubmittingFromQueue = useRef(false)
  const isClearingChat = useRef(false)
  const [isClearingChatPending, setIsClearingChatPending] = useState(false)
  const [showManualConnect, setShowManualConnect] = useState(
    typeof navigator !== 'undefined' && navigator.onLine === false
  )
  const steeredId = useRef<string | null>(null)
  const savedProjectConversationLookupLoaded = useRef(false)
  const savedProjectConversationId = useRef<string | undefined>(undefined)
  const savedProjectConversationLookupPath = useRef(props.theProject?.path)
  const actorConversationProjectPath = useRef(props.theProject?.path)
  const reconnectAfterSavedConversationLookup = useRef(false)
  const clearChatOperationGeneration = useRef(0)
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
  const setupFailed = useSelector(props.zookeeperManagerActor, (actor) => {
    return actor.context.setupFailed
  })
  const closeReason = useSelector(props.zookeeperManagerActor, (actor) => {
    return actor.context.closeReason
  })
  const conversationId = useSelector(props.zookeeperManagerActor, (actor) => {
    return actor.context.conversationId
  })
  const isSettingUp = useSelector(props.zookeeperManagerActor, (actor) => {
    return actor.matches(ZookeeperManagerStates.Setup)
  })
  const isReady = useSelector(props.zookeeperManagerActor, (actor) => {
    return actor.matches(ZookeeperManagerStates.Ready)
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
      applicationProjectDirectory: getParentAbsolutePath(project.path),
      fileSelectedDuringPrompting: {
        entry: props.loaderFile,
        content: props.kclManager.code,
      },
      projectFiles,
      selections: props.contextModeling.selectionRanges,
      artifactGraph: props.kclManager.artifactGraph,
      kclManager: props.kclManager,
      engineCommandManager: props.contextModeling.engineCommandManager,
      wasmInstance: props.contextModeling.wasmInstance,
      mode,
      additionalFiles: attachments,
    })
  }

  const needsReconnect = abruptlyClosed || showManualConnect

  const reconnect = useCallback(() => {
    if (isClearingChat.current) {
      return
    }

    const currentProjectPath = props.theProject?.path
    const actorConversationId =
      props.zookeeperManagerActor.getSnapshot().context.conversationId
    const actorConversationMatchesCurrentProject =
      actorConversationProjectPath.current === currentProjectPath
    const savedProjectConversationLookupIsCurrent =
      savedProjectConversationLookupPath.current === currentProjectPath &&
      savedProjectConversationLookupLoaded.current

    if (
      (!actorConversationMatchesCurrentProject ||
        actorConversationId === undefined) &&
      !savedProjectConversationLookupIsCurrent
    ) {
      reconnectAfterSavedConversationLookup.current = true
      return
    }

    reconnectAfterSavedConversationLookup.current = false
    actorConversationProjectPath.current = currentProjectPath
    props.zookeeperManagerActor.send({
      type: ZookeeperManagerTransitions.CacheSetupAndConnect,
      refParentSend: props.zookeeperManagerActor.send,
      conversationId:
        actorConversationMatchesCurrentProject &&
        actorConversationId !== undefined
          ? actorConversationId
          : savedProjectConversationId.current,
    })
  }, [props.zookeeperManagerActor, props.theProject?.path])

  const onReconnect = useCallback(() => {
    setShowManualConnect(false)
    reconnect()
  }, [reconnect])

  const onWindowOnlineOfflineParams = useMemo(
    () => ({
      close: () => {
        reconnectAfterSavedConversationLookup.current = false
        setShowManualConnect(true)
        props.zookeeperManagerActor.send({
          type: ZookeeperManagerTransitions.NetworkOffline,
        })
      },
      connect: onReconnect,
    }),
    [onReconnect, props.zookeeperManagerActor]
  )
  useOnWindowOnlineOffline(onWindowOnlineOfflineParams)

  useEffect(() => {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      return
    }
    props.zookeeperManagerActor.send({
      type: ZookeeperManagerTransitions.NetworkOffline,
    })
  }, [props.zookeeperManagerActor])

  useEffect(() => {
    if (
      !needsReconnect ||
      setupFailed ||
      showManualConnect ||
      isClearingChatPending
    ) {
      return
    }

    const timeoutReconnect = setTimeout(reconnect, 3000)
    return () => {
      clearTimeout(timeoutReconnect)
    }
  }, [
    isClearingChatPending,
    needsReconnect,
    reconnect,
    setupFailed,
    showManualConnect,
  ])

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
    if (isClearingChat.current) {
      return
    }
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
    if (!isReady || isClearingChatPending || isClearingChat.current) {
      return
    }
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
  }, [isClearingChatPending, isPromptRunning, isReady, queue])

  const onClickClearChat = async () => {
    if (isClearingChat.current) {
      return
    }

    isClearingChat.current = true
    reconnectAfterSavedConversationLookup.current = false
    setIsClearingChatPending(true)
    const clearOperationGeneration = clearChatOperationGeneration.current + 1
    clearChatOperationGeneration.current = clearOperationGeneration
    const isCurrentClearOperation = () =>
      clearChatOperationGeneration.current === clearOperationGeneration

    const projectId = props.settings.meta.id.current
    try {
      if (projectId !== undefined && projectId !== uuidNIL) {
        await props.conversationStore.deleteProjectConversationId(projectId)
      }
    } catch (error: unknown) {
      if (!isCurrentClearOperation()) {
        return
      }
      isClearingChat.current = false
      setIsClearingChatPending(false)
      trap(error instanceof Error ? error : new Error(String(error)), {
        altErr: new Error('Could not clear chat. Please try again.'),
      })
      return
    }

    if (!isCurrentClearOperation()) {
      return
    }

    steeredId.current = null
    setQueue([])
    savedProjectConversationLookupLoaded.current = true
    savedProjectConversationId.current = undefined

    let sub:
      | ReturnType<typeof props.zookeeperManagerActor.subscribe>
      | undefined
    const startFreshConversation = () => {
      sub?.unsubscribe()
      if (!isCurrentClearOperation() || !isClearingChat.current) {
        return
      }

      actorConversationProjectPath.current = props.theProject?.path
      props.zookeeperManagerActor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: props.zookeeperManagerActor.send,
        conversationId: undefined,
      })
      isClearingChat.current = false
      setIsClearingChatPending(false)
    }

    sub = props.zookeeperManagerActor.subscribe((next) => {
      if (next.matches(S.Await)) {
        startFreshConversation()
      }
    })
    props.zookeeperManagerActor.send({
      type: ZookeeperManagerTransitions.ConversationClose,
    })

    if (props.zookeeperManagerActor.getSnapshot().matches(S.Await)) {
      startFreshConversation()
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
      actorConversationProjectPath.current = props.theProject.path
      props.zookeeperManagerActor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: props.zookeeperManagerActor.send,
        conversationId,
      })
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: this actor coordination effect intentionally tracks project identity, matching the existing eslint suppression below.
  useEffect(() => {
    clearChatOperationGeneration.current += 1
    isClearingChat.current = false
    setIsClearingChatPending(false)

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
          setIsClearingChatPending(false)
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
              engineApiCallId:
                props.contextModeling.engineCommandManager.apiCallId,
              activeFile: currentLoaderFile
                ? activeFileRelativeToProject({
                    currentFileEntry: currentLoaderFile,
                    applicationProjectDirectory: getParentAbsolutePath(
                      project.path
                    ),
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

        // This avoids getting into an infinite loop when setup is requested
        // without an API token. The machine caches setup and stays in Await,
        // which wakes this subscriber while there is still no conversation.
        // Without this return, we would send the same setup event over and over.
        // Setup is already queued and will resume when a token arrives.
        if (context.cachedSetup !== undefined) {
          return
        }

        tryToGetExchanges()
      })

    savedProjectConversationLookupPath.current = props.theProject?.path
    savedProjectConversationLookupLoaded.current = false
    savedProjectConversationId.current = undefined
    const projectId = props.settings.meta.id.current
    let canceled = false
    const continueAfterSavedConversationLookup = () => {
      if (reconnectAfterSavedConversationLookup.current) {
        reconnect()
        return
      }
      tryToGetExchanges()
    }

    if (projectId === undefined) {
      savedProjectConversationLookupLoaded.current = true
      continueAfterSavedConversationLookup()
    } else if (projectId !== uuidNIL) {
      void props.conversationStore
        .getProjectConversationId(projectId)
        .then((conversationId) => {
          if (canceled || savedProjectConversationLookupLoaded.current) {
            return
          }
          savedProjectConversationLookupLoaded.current = true
          savedProjectConversationId.current = conversationId
          continueAfterSavedConversationLookup()
        })
        .catch((error: unknown) => {
          if (canceled || savedProjectConversationLookupLoaded.current) {
            return
          }
          savedProjectConversationLookupLoaded.current = true
          savedProjectConversationId.current = undefined
          reportRejection(error)
          continueAfterSavedConversationLookup()
        })
    } else {
      savedProjectConversationLookupLoaded.current = true
      continueAfterSavedConversationLookup()
    }

    tryToGetExchanges()

    return () => {
      canceled = true
      clearChatOperationGeneration.current += 1
      isClearingChat.current = false
      reconnectAfterSavedConversationLookup.current = false
      subscriptionZookeeperManagerActor.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [props.settings.meta.id.current, props.theProject?.path])

  // We watch the URL for a query parameter to set the defaultPrompt
  // for the conversation.
  useEffect(() => {
    const promptParam =
      searchParams.get(SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY) ??
      searchParams.get(LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY)
    if (promptParam) {
      setDefaultPrompt(promptParam)

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
      onClickClearChat={() => {
        void onClickClearChat()
      }}
      onReconnect={onReconnect}
      connectionError={
        showManualConnect ? 'No internet connection.' : closeReason
      }
      connectionFailed={setupFailed}
      showManualConnect={showManualConnect}
      canClearChat={setupFailed && conversationId !== undefined}
      isClearingChat={isClearingChatPending}
      loadingMessage={
        isSettingUp
          ? 'Connecting to Zookeeper...'
          : needsReconnect
            ? 'Reconnecting...'
            : undefined
      }
      onCancel={onCancel}
      disabled={needsReconnect || isClearingChatPending}
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

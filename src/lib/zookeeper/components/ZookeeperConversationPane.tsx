import { useSignals } from '@preact/signals-react/runtime'
import {
  LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
  SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
} from '@src/lib/constants'
import type { Project } from '@src/lib/project'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { ZookeeperConversation } from '@src/lib/zookeeper/components/ZookeeperConversation'
import { ZookeeperConversationWelcome } from '@src/lib/zookeeper/components/ZookeeperConversationWelcome'
import type { ZookeeperSessionController } from '@src/lib/zookeeper/registry/controller'
import type { MlCopilotModeId } from '@src/lib/zookeeper/zookeeperManagerMachine'
import {
  hasBeenInterruptedOnLast,
  ZookeeperManagerStates,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'
import { S } from '@src/machines/utils'
import { useSelector } from '@xstate/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

type ZookeeperConversationPaneUser = {
  image?: string
}

export const ZookeeperConversationPane = (props: {
  controller: ZookeeperSessionController
  contextModeling: ModelingMachineContext
  settings: SettingsType
  theProject: Project
  user?: ZookeeperConversationPaneUser
  showMakeathonAnnouncement?: boolean
  onMlCopilotModeChange?: (mode: MlCopilotModeId | undefined) => void
}) => {
  useSignals()
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const controller = props.controller
  const actor = controller.actor

  let conversation = useSelector(actor, (snapshot) => {
    return snapshot.context.conversation
  })
  const abruptlyClosed = useSelector(actor, (snapshot) => {
    return snapshot.context.abruptlyClosed
  })
  const setupFailed = useSelector(actor, (snapshot) => {
    return snapshot.context.setupFailed
  })
  const closeReason = useSelector(actor, (snapshot) => {
    return snapshot.context.closeReason
  })
  const accessDeniedCode = useSelector(actor, (snapshot) => {
    return snapshot.context.accessDeniedCode
  })
  const conversationId = useSelector(actor, (snapshot) => {
    return snapshot.context.conversationId
  })
  const isSettingUp = useSelector(actor, (snapshot) => {
    return snapshot.matches(ZookeeperManagerStates.Setup)
  })
  const isReady = useSelector(actor, (snapshot) => {
    return snapshot.matches(ZookeeperManagerStates.Ready)
  })
  const isAwaitingConnection = useSelector(actor, (snapshot) => {
    return snapshot.matches(S.Await)
  })
  const isPromptRunning = useSelector(actor, (snapshot) => {
    return snapshot.context.awaitingResponse
  })
  const interruptedTurnAwaitingResume = useSelector(
    actor,
    (snapshot) =>
      snapshot.matches(ZookeeperManagerStates.WaitForContinueCheck) &&
      hasBeenInterruptedOnLast(snapshot.context.conversation?.exchanges ?? [])
  )
  const modeOptions = useSelector(actor, (snapshot) => {
    return snapshot.context.modeOptions
  })
  const attachmentsLoadedForCurrentPrompt = useSelector(
    actor,
    (snapshot) => snapshot.context.attachmentsLoadedForCurrentPrompt
  )
  const defaultMode = useSelector(actor, (snapshot) => {
    return snapshot.context.defaultMode
  })

  if (isAwaitingConnection && !abruptlyClosed) {
    conversation = undefined
  }

  const checkBillingWhenFocused = useRef(false)
  const checkBillingAccess = useCallback(() => {
    controller.checkBillingAccess()
  }, [controller])
  const onOpenBilling = useCallback(() => {
    checkBillingWhenFocused.current = true
  }, [])

  useEffect(() => {
    if (!setupFailed || accessDeniedCode === undefined) {
      checkBillingWhenFocused.current = false
      return
    }

    const checkAfterBilling = () => {
      if (
        !checkBillingWhenFocused.current ||
        (typeof document !== 'undefined' &&
          document.visibilityState === 'hidden')
      ) {
        return
      }

      checkBillingWhenFocused.current = false
      checkBillingAccess()
    }

    window.addEventListener('focus', checkAfterBilling)
    document.addEventListener('visibilitychange', checkAfterBilling)
    return () => {
      window.removeEventListener('focus', checkAfterBilling)
      document.removeEventListener('visibilitychange', checkAfterBilling)
    }
  }, [accessDeniedCode, checkBillingAccess, setupFailed])

  useEffect(() => {
    const promptParam =
      searchParams.get(SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY) ??
      searchParams.get(LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY)
    if (!promptParam) {
      return
    }

    setDefaultPrompt(promptParam)
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete(SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY)
    nextSearchParams.delete(LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY)
    setSearchParams(nextSearchParams, { replace: true })
  }, [searchParams, setSearchParams])

  const showManualConnect = controller.showManualConnect.value
  const isClearingChat = controller.isClearingChat.value
  const isResumingInterruptedTurn = controller.isResumingInterruptedTurn.value
  const needsReconnect = abruptlyClosed || showManualConnect
  const isLoadingAttachments =
    !attachmentsLoadedForCurrentPrompt && conversation !== undefined
  const initialMlCopilotMode =
    props.settings.app.zookeeperMode.project ??
    props.settings.app.zookeeperMode.user ??
    defaultMode

  return (
    <ZookeeperConversation
      isLoading={conversation === undefined}
      isLoadingAttachments={isLoadingAttachments}
      contexts={[
        { type: 'selections', data: props.contextModeling.selectionRanges },
      ]}
      conversation={conversation}
      welcomeMessage={<ZookeeperConversationWelcome />}
      onProcess={(prompt, mode, attachments) => {
        controller.sendOrQueue(prompt, mode, attachments)
      }}
      onClickClearChat={() => {
        void controller.clearConversation()
      }}
      onReconnect={() => controller.reconnect()}
      onCheckBilling={checkBillingAccess}
      onOpenBilling={onOpenBilling}
      connectionError={
        showManualConnect ? 'No internet connection.' : closeReason
      }
      connectionFailed={setupFailed}
      accessDeniedCode={accessDeniedCode}
      showManualConnect={showManualConnect}
      canClearChat={setupFailed && conversationId !== undefined}
      isClearingChat={isClearingChat}
      loadingMessage={
        isSettingUp
          ? 'Connecting to Zookeeper...'
          : needsReconnect
            ? 'Reconnecting...'
            : undefined
      }
      onCancel={() => controller.cancel()}
      disabled={
        needsReconnect ||
        !isReady ||
        isClearingChat ||
        interruptedTurnAwaitingResume ||
        isResumingInterruptedTurn
      }
      needsReconnect={needsReconnect}
      hasPromptCompleted={!isPromptRunning && !interruptedTurnAwaitingResume}
      isProcessing={isPromptRunning}
      interruptedTurnAwaitingResume={interruptedTurnAwaitingResume}
      isResumingInterruptedTurn={isResumingInterruptedTurn}
      onResumeInterruptedTurn={() => controller.resumeInterruptedTurn()}
      queue={[...controller.queue.value]}
      onRemoveFromQueue={(id) => controller.removeQueued(id)}
      onSteer={(id) => controller.steer(id)}
      userAvatarSrc={props.user?.image}
      showMakeathonAnnouncement={props.showMakeathonAnnouncement}
      defaultPrompt={defaultPrompt}
      initialMlCopilotMode={initialMlCopilotMode}
      onMlCopilotModeChange={props.onMlCopilotModeChange}
      modeOptions={modeOptions}
      modeScopeKey={props.theProject.path}
    />
  )
}

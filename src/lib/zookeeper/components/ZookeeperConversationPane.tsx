import { useSignals } from '@preact/signals-react/runtime'
import {
  LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
  SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
} from '@src/lib/constants'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { ZookeeperConversation } from '@src/lib/zookeeper/components/ZookeeperConversation'
import { ZookeeperConversationWelcome } from '@src/lib/zookeeper/components/ZookeeperConversationWelcome'
import type { ZookeeperSessionController } from '@src/lib/zookeeper/registry/controller'
import type { MlCopilotModeId } from '@src/lib/zookeeper/zookeeperManagerMachine'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export const ZookeeperConversationPane = (props: {
  controller: ZookeeperSessionController
  selectionRanges: ModelingMachineContext['selectionRanges']
  zookeeperMode: SettingsType['app']['zookeeperMode']
  userAvatarSrc?: string
  onMlCopilotModeChange?: (mode: MlCopilotModeId | undefined) => void
}) => {
  useSignals()
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const controller = props.controller
  const view = controller.view.value

  const checkBillingWhenFocused = useRef(false)
  const checkBillingAccess = useCallback(() => {
    controller.checkBillingAccess()
  }, [controller])
  const onOpenBilling = useCallback(() => {
    checkBillingWhenFocused.current = true
  }, [])

  useEffect(() => {
    if (!view.connectionFailed || view.accessDeniedCode === undefined) {
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
  }, [checkBillingAccess, view.accessDeniedCode, view.connectionFailed])

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

  const initialMlCopilotMode =
    props.zookeeperMode.project ?? props.zookeeperMode.user ?? view.defaultMode

  return (
    <ZookeeperConversation
      isLoading={view.isLoading}
      isLoadingAttachments={view.isLoadingAttachments}
      contexts={[{ type: 'selections', data: props.selectionRanges }]}
      conversation={view.conversation}
      attachmentFetches={view.attachmentFetches}
      onFetchAttachment={(attachmentRef) =>
        controller.fetchAttachment(attachmentRef)
      }
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
      connectionError={view.connectionError}
      connectionFailed={view.connectionFailed}
      accessDeniedCode={view.accessDeniedCode}
      showManualConnect={view.showManualConnect}
      canClearChat={view.canClearChat}
      isClearingChat={view.isClearingChat}
      loadingMessage={view.loadingMessage}
      onCancel={() => controller.cancel()}
      disabled={view.disabled}
      needsReconnect={view.needsReconnect}
      hasPromptCompleted={view.hasPromptCompleted}
      isProcessing={view.isProcessing}
      interruptedTurnAwaitingResume={view.interruptedTurnAwaitingResume}
      isResumingInterruptedTurn={view.isResumingInterruptedTurn}
      onResumeInterruptedTurn={() => controller.resumeInterruptedTurn()}
      queue={[...view.queue]}
      onRemoveFromQueue={(id) => controller.removeQueued(id)}
      onSteer={(id) => controller.steer(id)}
      userAvatarSrc={props.userAvatarSrc}
      defaultPrompt={defaultPrompt}
      initialMlCopilotMode={initialMlCopilotMode}
      onMlCopilotModeChange={props.onMlCopilotModeChange}
      modeOptions={view.modeOptions}
      modeScopeKey={controller.projectPath}
    />
  )
}

import { Menu } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'
import { MlEphantConversationPane } from '@src/components/layout/areas/MlEphantConversationPane'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { getMillisecondsUntilEstimatedBillingBalanceIsZero } from '@src/lib/billingEstimate'
import { useApp, useSingletons } from '@src/lib/boot'
import { browserSaveFile } from '@src/lib/browserSaveFile'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import {
  BILLING_UPDATE_RATE_LIMIT_MS,
  BillingTransition,
} from '@src/machines/billingMachine'
import {
  MlEphantConversationToMarkdown,
  MlEphantManagerReactContext,
} from '@src/machines/mlEphantManagerMachine'
import {
  useProjectIdToConversationId,
  useWatchForNewFileRequestsFromMlEphant,
} from '@src/machines/systemIO/hooks'
import {
  SystemIOMachineEvents,
  prepareMlEphantNewFileRequest,
} from '@src/machines/systemIO/utils'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'
import { useCallback, useEffect, useRef } from 'react'
// Yea, feels bad, but literally every other pane is doing this.
// TODO: Don't use CSS module for this? More generic module?
import styles from './KclEditorMenu.module.css'

const MAX_SET_TIMEOUT_MS = 2_147_483_647

export function MlEphantConversationPaneWrapper(props: AreaTypeComponentProps) {
  const { auth } = useApp()
  const token = auth.useToken()

  return (
    <MlEphantManagerReactContext.Provider
      options={{
        input: {
          apiToken: token,
        },
      }}
    >
      <MlEphantConversationPaneInner {...props} />
    </MlEphantManagerReactContext.Provider>
  )
}

function MlEphantConversationPaneInner(props: AreaTypeComponentProps) {
  useSignals()
  const app = useApp()
  const { auth, billing, settings, project, systemIOActor } = app
  const { kclManager } = useSingletons()
  const settingsValues = settings.useSettings()
  const user = auth.useUser()
  const token = auth.useToken()
  const billingContext = billing.useContext()
  const hasSentZeroBalanceBillingUpdate = useRef(false)
  const zeroBalanceBillingUpdateLastFetch = useRef<number | undefined>(
    undefined
  )
  const {
    context: contextModeling,
    send: sendModeling,
    theProject,
  } = useModelingContext()
  const loaderFile = project?.executingFileEntry.value
  const mlEphantManagerActor = MlEphantManagerReactContext.useActorRef()

  useEffect(() => {
    if (!IS_STAGING_OR_DEBUG) return

    app.debug.mlEphantManagerActor = mlEphantManagerActor

    return () => {
      if (app.debug.mlEphantManagerActor === mlEphantManagerActor) {
        delete app.debug.mlEphantManagerActor
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run on mount
  }, [])

  useWatchForNewFileRequestsFromMlEphant(
    mlEphantManagerActor,
    billing.actor,
    token,
    kclManager.engineCommandManager,
    (requestProps) => {
      const payload = prepareMlEphantNewFileRequest(requestProps)

      if (payload) {
        kclManager.mlEphantManagerMachineBulkManipulatingFileSystem = true
        systemIOActor.send({
          type: SystemIOMachineEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile,
          data: {
            files: payload.files,
            filesToDelete: payload.filesToDelete,
            override: true,
            requestedProjectName: payload.requestedProjectName,
            requestedFileNameWithExtension:
              payload.requestedFileNameWithExtension ?? '',
          },
        })
      }
    }
  )

  // Save the conversation id for the project id if necessary.
  useProjectIdToConversationId(
    mlEphantManagerActor,
    systemIOActor,
    settingsValues
  )

  const sendBillingUpdate = useCallback(() => {
    billing.send({
      type: BillingTransition.Update,
      apiToken: token,
    })
  }, [billing, token])
  const sendBillingUsageStarted = useCallback(() => {
    billing.send({
      type: BillingTransition.UsageStarted,
    })
  }, [billing])
  const sendBillingUsageEnded = useCallback(() => {
    billing.send({
      type: BillingTransition.UsageEnded,
    })
  }, [billing])

  useEffect(() => {
    if (billingContext.usageStartedAt === undefined) {
      hasSentZeroBalanceBillingUpdate.current = false
      zeroBalanceBillingUpdateLastFetch.current = undefined
      return
    }

    const lastFetchTime = billingContext.lastFetch?.getTime()

    if (hasSentZeroBalanceBillingUpdate.current) {
      if (
        typeof billingContext.balance === 'number' &&
        billingContext.balance > 0 &&
        lastFetchTime !== zeroBalanceBillingUpdateLastFetch.current
      ) {
        hasSentZeroBalanceBillingUpdate.current = false
        zeroBalanceBillingUpdateLastFetch.current = undefined
      } else {
        return
      }
    }

    const millisecondsUntilZero =
      getMillisecondsUntilEstimatedBillingBalanceIsZero(billingContext)

    if (millisecondsUntilZero === undefined) {
      return
    }

    const billingUpdateRateLimitRemainingMs =
      billingContext.lastFetch === undefined
        ? 0
        : Math.max(
            0,
            BILLING_UPDATE_RATE_LIMIT_MS -
              (Date.now() - billingContext.lastFetch.getTime())
          )
    const millisecondsUntilBillingUpdateRateLimitEnds =
      billingUpdateRateLimitRemainingMs === 0
        ? 0
        : billingUpdateRateLimitRemainingMs + 1
    const delay = Math.min(
      Math.max(
        millisecondsUntilZero,
        millisecondsUntilBillingUpdateRateLimitEnds
      ),
      MAX_SET_TIMEOUT_MS
    )
    const timeout = setTimeout(() => {
      hasSentZeroBalanceBillingUpdate.current = true
      zeroBalanceBillingUpdateLastFetch.current = lastFetchTime
      sendBillingUpdate()
    }, delay)

    return () => {
      clearTimeout(timeout)
    }
  }, [billingContext, sendBillingUpdate])

  // During the makethon, this was set to the following:
  // !isPlaywright() &&
  // !location.pathname.includes(String(PATHS.ONBOARDING)) &&
  // !billingContext.isOrg
  const showMakeathonAnnouncement = false

  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="sparkles"
        title="Zookeeper"
        onClose={props.onClose}
        Menu={MlEphantConversationMenu}
      />
      <MlEphantConversationPane
        {...{
          mlEphantManagerActor: mlEphantManagerActor,
          systemIOActor,
          kclManager,
          contextModeling,
          sendModeling,
          sendBillingUpdate,
          sendBillingUsageStarted,
          sendBillingUsageEnded,
          theProject: theProject.current,
          loaderFile,
          settings: settingsValues,
          user,
          showMakeathonAnnouncement,
          onMlCopilotModeChange: (mode) => {
            settings.actor.send({
              type: 'set.app.zookeeperMode',
              data: { level: 'project', value: mode },
            })
          },
        }}
      />
    </LayoutPanel>
  )
}

export const MlEphantConversationMenu = () => {
  const mlEphantManagerActor = MlEphantManagerReactContext.useActorRef()

  return (
    <HeaderMenu>
      <Menu.Item>
        <button
          type="button"
          onClick={() => {
            const context = mlEphantManagerActor.getSnapshot().context
            const md = MlEphantConversationToMarkdown(context.conversation)
            const blob = new Blob([new TextEncoder().encode(md)], {
              type: 'text/markdown',
            })
            void browserSaveFile(
              blob,
              `${context.conversationId ?? new Date().toISOString()}.md`,
              ''
            )
          }}
          className={styles.button}
        >
          <span>Export conversation</span>
        </button>
      </Menu.Item>
    </HeaderMenu>
  )
}

import { Menu } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'
import { MlEphantConversationPane } from '@src/components/layout/areas/MlEphantConversationPane'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useApp, useSingletons } from '@src/lib/boot'
import { browserSaveFile } from '@src/lib/browserSaveFile'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { BillingTransition } from '@src/machines/billingMachine'
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
import { useEffect } from 'react'
// Yea, feels bad, but literally every other pane is doing this.
// TODO: Don't use CSS module for this? More generic module?
import styles from './KclEditorMenu.module.css'

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

  const sendBillingUpdate = () => {
    billing.send({
      type: BillingTransition.Update,
      apiToken: token,
    })
  }
  const sendBillingUsageStarted = () => {
    billing.send({
      type: BillingTransition.UsageStarted,
    })
  }
  const sendBillingUsageEnded = () => {
    billing.send({
      type: BillingTransition.UsageEnded,
    })
  }

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
